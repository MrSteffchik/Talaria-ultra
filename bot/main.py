import os
import re
import logging
from telegram import Update, Message
from telegram.ext import Application, MessageHandler, filters, ContextTypes
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO
)
log = logging.getLogger(__name__)

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]
BUCKET         = "product-photos"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── Парсер подписи ───────────────────────────────────────────────────────────

_SKIP_RE   = re.compile(
    r"(t\.me/|instagram|инстаграм|@nala|ссылка на|наш магазин|вещи|одежда"
    r"|для заказа|908257337|\+998)",
    re.IGNORECASE,
)
# Целые посты которые надо пропускать полностью
_SKIP_POST_RE = re.compile(
    r"(сертификат|акция|розыгрыш|конкурс|поздравля|открыт|закрыт|выходн)",
    re.IGNORECASE,
)
_PRICE_RE  = re.compile(r"сум", re.IGNORECASE)
# Размер: строка содержит только числа 35-52 (через запятую, пробел или перенос)
_SIZE_ONLY = re.compile(r"^[\d\s,\-\.]+$")
_SIZE_NUM  = re.compile(r"\b(3[5-9]|4[0-9]|5[0-2])\b")
_ARROW_RE  = re.compile(r"[➡️➡]")
_PHONE_RE  = re.compile(r"^[\d\s\-\+\(\)]{6,}$")
_ORDER_RE  = re.compile(r"(заказ|@\w+)", re.IGNORECASE)
_REVIEW_RE = re.compile(r"#отзыв|отзывклиент", re.IGNORECASE)


def extract_strikethrough(text: str, entities) -> set[tuple[int,int]]:
    """Возвращает множество (start, end) зачёркнутых фрагментов."""
    ranges = set()
    if not entities:
        return ranges
    for e in entities:
        if e.type == "strikethrough":
            ranges.add((e.offset, e.offset + e.length))
    return ranges


def is_strikethrough(line_start: int, line_end: int, strike_ranges: set) -> bool:
    """Строка зачёркнута, если диапазон entity пересекается с текстом строки."""
    if not strike_ranges:
        return False
    for (s, e) in strike_ranges:
        if s < line_end and e > line_start:
            return True
    return False


def price_amount(text: str) -> int | None:
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    return int(digits) if digits else None


def normalize_price_line(line: str) -> str:
    clean = clean_emoji(line).strip()
    clean = re.sub(
        r"^(?:цена\s*(?:со\s*скидкой)?\s*:?\s*)",
        "",
        clean,
        flags=re.IGNORECASE,
    ).strip()
    return re.sub(r"^:\s*", "", clean).strip()


def extract_size_numbers(text: str) -> list[str]:
    if not text:
        return []
    stripped = re.sub(r"[^\d,\s\-\.]", "", clean_emoji(text))
    found = re.findall(r"\b(3[4-9]|4[0-9]|5[0-2])\b", stripped)
    return sorted(set(found))


def clean_emoji(text: str) -> str:
    if not text:
        return ""
    # Удаляем 4-байтовые символы эмодзи (диапазоны суррогатных пар и высших плоскостей)
    clean = re.sub(r'[\U00010000-\U0010ffff]', '', text)
    # Удаляем графические символы, стрелки, сердечки и значки
    clean = re.sub(r'[\u2000-\u3300\u2600-\u27bf]', '', clean)
    return clean.strip()

def clean_text_fully(text: str) -> str:
    clean = clean_emoji(text)
    # Удаляем мусорные реакции в начале строки
    clean = re.sub(r'^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*#]+', '', clean)
    return clean.strip()

def get_fallback_title(desc: str) -> str:
    text = (desc or "").lower()
    if 'кроссовк' in text or 'кед' in text:
        return 'Стильные кроссовки'
    if 'туфли' in text or 'каблук' in text:
        return 'Элегантные туфли'
    if 'босонож' in text or 'сандал' in text:
        return 'Премиальные босоножки'
    if 'сабо' in text or 'слипон' in text:
        return 'Удобные сабо'
    return 'Женская обувь Talaria'

def clean_description(desc_lines: list[str]) -> str:
    cleaned = []
    for line in desc_lines:
        clean = clean_emoji(line)
        clean = re.sub(r'^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*]+', '', clean).strip()
        if clean:
            cleaned.append(clean)
    return "\n".join(cleaned)

def parse_caption(text: str, entities=None) -> dict | None:
    if not text:
        return None
    if _REVIEW_RE.search(text):
        log.info("Пропускаем: пост с отзывом")
        return None
    if _SKIP_POST_RE.search(text):
        log.info("Пропускаем: не товарный пост")
        return None

    strike_ranges = extract_strikethrough(text, entities)

    title = None
    sizes_parts: list[str] = []
    price = None
    old_price = None
    desc_lines: list[str] = []

    search_from = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line_start = text.find(line, search_from)
        if line_start < 0:
            line_start = search_from
        line_end = line_start + len(line)
        search_from = line_end

        if _SKIP_RE.search(line):
            continue
        if _PHONE_RE.match(line) or _ORDER_RE.search(line):
            continue

        # Зачёркнутая строка с ценой = старая цена
        if _PRICE_RE.search(line) and is_strikethrough(line_start, line_end, strike_ranges):
            old_price = line
            continue

        # Обычная строка с ценой = текущая цена
        if _PRICE_RE.search(line):
            price = line
            continue

        size_nums = extract_size_numbers(line)
        size_probe = _ARROW_RE.sub("", line).replace(",", " ").strip()
        # Размеры: цифры 35–52, допускаем Premium-эмодзи (вырезаются в extract_size_numbers)
        if _ARROW_RE.search(line) or (
            size_nums
            and (
                _SIZE_ONLY.match(size_probe)
                or len(size_nums) >= 2
                or (len(size_nums) == 1 and not _PRICE_RE.search(line))
            )
        ):
            sizes_parts.append(", ".join(size_nums) if size_nums else _ARROW_RE.sub("", line).strip())
            continue

        if title is None:
            title = line
        else:
            desc_lines.append(line)

    # Без цены — не товар
    if not price:
        return None

    # Очищаем
    cleaned_title = clean_text_fully(title)
    cleaned_desc = clean_description(desc_lines)
    
    # Собираем и очищаем размеры
    raw_sizes = ", ".join(sizes_parts) if sizes_parts else None
    cleaned_sizes = ""
    if raw_sizes:
        found = extract_size_numbers(raw_sizes)
        if found:
            cleaned_sizes = ", ".join(found)

    # Если размеры не найдены, пробуем вытащить их из описания
    if not cleaned_sizes and cleaned_desc:
        found_sizes = extract_size_numbers(cleaned_desc)
        if found_sizes:
            cleaned_sizes = ", ".join(found_sizes)

    # Заголовок ошибочно стал строкой размеров (43,44 и т.п.)
    if cleaned_title and extract_size_numbers(cleaned_title) and re.match(
        r"^[\d\s,\.\-]+$", cleaned_title.replace(" ", "")
    ):
        if not cleaned_sizes:
            cleaned_sizes = ", ".join(extract_size_numbers(cleaned_title))
        cleaned_title = get_fallback_title(cleaned_desc)

    # Если заголовок пустой или мусорный, даем красивый фолбек
    if len(cleaned_title) < 2:
        cleaned_title = get_fallback_title(cleaned_desc)

    # Нормализуем цены; если текущая выше старой — меняем местами
    if price:
        price = normalize_price_line(price)
    if old_price:
        old_price = normalize_price_line(old_price)
    p_amt, o_amt = price_amount(price or ""), price_amount(old_price or "")
    if p_amt and o_amt and p_amt > o_amt:
        price, old_price = old_price, price

    display_price = price or ""
    if old_price and price:
        display_price = f"{price} (было: {old_price})"

    return {
        "title":       cleaned_title,
        "sizes":       cleaned_sizes or None,
        "price":       display_price,
        "description": cleaned_desc or None,
    }


# ─── Загрузка фото ────────────────────────────────────────────────────────────

async def upload_photo(data: bytes, filename: str) -> str | None:
    try:
        supabase.storage.from_(BUCKET).upload(
            path=filename,
            file=data,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return supabase.storage.from_(BUCKET).get_public_url(filename)
    except Exception as exc:
        log.error("Ошибка загрузки фото %s: %s", filename, exc)
        return None


# ─── Обработчик сообщений ─────────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg: Message = update.message or update.channel_post
    if not msg or not msg.photo:
        return

    caption        = msg.caption or ""
    entities       = msg.caption_entities or []
    media_group_id = msg.media_group_id
    message_id     = msg.message_id

    # Загружаем лучшее фото
    best = msg.photo[-1]
    tg_file = await context.bot.get_file(best.file_id)
    photo_bytes = bytes(await tg_file.download_as_bytearray())
    filename = f"{message_id}_{best.file_unique_id}.jpg"
    photo_url = await upload_photo(photo_bytes, filename)

    # Часть медиагруппы — добавляем фото к существующему товару
    if media_group_id:
        existing = (
            supabase.table("products")
            .select("id, photos")
            .eq("telegram_media_group_id", media_group_id)
            .execute()
        )
        if existing.data:
            product = existing.data[0]
            photos = list(product.get("photos") or [])
            if photo_url and photo_url not in photos:
                photos.append(photo_url)
                supabase.table("products").update({"photos": photos}).eq("id", product["id"]).execute()
                log.info("Добавлено фото к группе %s", media_group_id)
            return

    if not caption:
        return

    parsed = parse_caption(caption, entities)
    if not parsed:
        return

    # Дедупликация
    dup = (
        supabase.table("products")
        .select("id")
        .eq("telegram_message_id", message_id)
        .execute()
    )
    if dup.data:
        return

    parsed["telegram_message_id"]     = message_id
    parsed["telegram_media_group_id"] = media_group_id
    parsed["photos"]                  = [photo_url] if photo_url else []

    try:
        supabase.table("products").insert(parsed).execute()
        log.info("Сохранён товар: %s | %s", parsed["title"], parsed["price"])
    except Exception as exc:
        log.error("Ошибка сохранения товара: %s", exc)


# ─── Мониторинг заказов ────────────────────────────────────────────────────────

async def order_checker_loop(app: Application):
    import asyncio
    log.info("Фоновый цикл проверки заказов запущен...")
    
    admin_chat_id = os.environ.get("ADMIN_CHAT_ID")
    if not admin_chat_id:
        log.warning("⚠️ ВНИМАНИЕ: Переменная окружения ADMIN_CHAT_ID не установлена! Уведомления о заказах не будут отправляться.")
        return
        
    while True:
        try:
            # Выбираем заказы со статусом 'pending' (новые)
            res = (
                supabase.table("orders")
                .select("*")
                .eq("status", "pending")
                .execute()
            )
            
            if res.data:
                for order in res.data:
                    order_id = order["id"]
                    name = order["customer_name"]
                    phone = order["phone"]
                    delivery = order["delivery_type"]
                    address = order["address"] or "Не указан"
                    payment = order["payment_method"]
                    total = order["total_price"]
                    items = order["items"] or []
                    
                    # Форматируем состав заказа
                    items_list = []
                    for idx, item in enumerate(items, 1):
                        title = item.get("title", "Товар")
                        size = item.get("size", "Без размера")
                        qty = item.get("quantity", 1)
                        price = item.get("price", "")
                        items_list.append(f"{idx}. {title} (Размер: {size}) — {qty} шт. | {price}")
                    
                    items_str = "\n".join(items_list)
                    
                    # Форматируем доставку и оплату
                    deliv_str = "🚚 Доставка курьером" if delivery == "delivery" else "🏪 Самовывоз (Мирзо Улугбека 99)"
                    
                    pay_str = "💵 Наличными / При получении"
                    if payment == "click":
                        pay_str = "📲 CLICK"
                    elif payment == "payme":
                        pay_str = "📲 PAYME"
                        
                    msg_text = (
                        f"🔔 **НОВЫЙ ЗАКАЗ #{order_id}!**\n\n"
                        f"👤 **Покупатель:** {name}\n"
                        f"📞 **Телефон:** `{phone}`\n"
                        f"📦 **Тип получения:** {deliv_str}\n"
                        f"📍 **Адрес:** {address}\n"
                        f"💳 **Оплата:** {pay_str}\n\n"
                        f"🛍️ **Состав заказа:**\n{items_str}\n\n"
                        f"💰 **Итого к оплате:** {total:,} сум\n"
                    ).replace(",", " ")
                    
                    # Отправляем уведомление администратору
                    await app.bot.send_message(
                        chat_id=admin_chat_id,
                        text=msg_text,
                        parse_mode="Markdown"
                    )
                    log.info("Отправлено уведомление о заказе #%s администратору", order_id)
                    
                    # Обновляем статус заказа, чтобы не слать повторно
                    supabase.table("orders").update({"status": "notified"}).eq("id", order_id).execute()
                    
            await asyncio.sleep(20) # Проверяем каждые 20 секунд
        except Exception as exc:
            log.error("Ошибка в фоновом цикле заказов: %s", exc)
            await asyncio.sleep(30)


async def post_init(application: Application) -> None:
    import asyncio
    # Запускаем фоновую задачу проверки заказов в цикле событий asyncio
    asyncio.create_task(order_checker_loop(application))


# ─── Запуск ───────────────────────────────────────────────────────────────────

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).post_init(post_init).build()
    app.add_handler(MessageHandler(filters.PHOTO, handle_message))
    log.info("Бот запущен — слушаем группу...")
    app.run_polling(allowed_updates=["message", "channel_post"])


if __name__ == "__main__":
    main()
