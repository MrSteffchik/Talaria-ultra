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


def _utf16_units_before(text: str, py_index: int) -> int:
    """Сколько UTF-16 code units в text[:py_index] (как в Telegram entities)."""
    units = 0
    for ch in text[:py_index]:
        units += 2 if ord(ch) > 0xFFFF else 1
    return units


def extract_strikethrough(text: str, entities) -> set[tuple[int, int]]:
    """Диапазоны зачёркивания в UTF-16 offsets (как отдаёт Telegram API)."""
    ranges: set[tuple[int, int]] = set()
    if not entities:
        return ranges
    for e in entities:
        if e.type == "strikethrough":
            ranges.add((e.offset, e.offset + e.length))
    return ranges


def is_strikethrough_line(
    text: str, line_start_py: int, line_end_py: int, strike_ranges: set
) -> bool:
    """Строка зачёркнута, если entity strikethrough пересекает её (UTF-16 offsets)."""
    if not strike_ranges:
        return False
    line_u16_start = _utf16_units_before(text, line_start_py)
    line_u16_end = _utf16_units_before(text, line_end_py)
    for s, e in strike_ranges:
        if s < line_u16_end and e > line_u16_start:
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
    stripped = re.sub(r"[^\d,\s\-\.]", "", strip_all_emoji(text))
    found = re.findall(r"\b(3[4-9]|4[0-9]|5[0-2])\b", stripped)
    return sorted(set(found))


def strip_all_emoji(text: str) -> str:
    """Удаляет обычные и Premium/custom emoji, оставляя буквы, цифры, пунктуацию."""
    if not text:
        return ""
    clean = text
    # Суррогатные пары (большинство emoji, в т.ч. многие custom)
    clean = re.sub(r"[\uD800-\uDBFF][\uDC00-\uDFFF]", "", clean)
    # Дополнительные плоскости Unicode
    clean = re.sub(r"[\U00010000-\U0010ffff]", "", clean)
    # Символы, стрелки, dingbats, variation selectors, ZWJ
    clean = re.sub(r"[\u2000-\u3300\u2600-\u27BF\uFE00-\uFE0F\u200D]", "", clean)
    return clean.strip()


def clean_emoji(text: str) -> str:
    return strip_all_emoji(text)


_DISCOUNT_PRICE_RE = re.compile(r"скидк", re.IGNORECASE)


def resolve_prices(
    candidates: list[tuple[str, bool, bool]],
) -> tuple[str | None, str | None]:
    """
    candidates: (raw_line, is_strikethrough, has_discount_keyword)
    Возвращает (текущая_цена, старая_цена).
    """
    if not candidates:
        return None, None

    parsed: list[tuple[str, int, bool, bool]] = []
    for line, struck, discount_kw in candidates:
        amt = price_amount(line)
        if amt is None:
            continue
        parsed.append((line, amt, struck, discount_kw))

    if not parsed:
        return normalize_price_line(candidates[0][0]), None

    strike_items = [p for p in parsed if p[2]]
    regular_items = [p for p in parsed if not p[2]]

    current: str | None = None
    old: str | None = None

    if strike_items and regular_items:
        # Зачёркнутая = старая, обычная = актуальная
        old = normalize_price_line(max(strike_items, key=lambda x: x[1])[0])
        regular_sorted = sorted(regular_items, key=lambda x: x[1])
        # При нескольких обычных — приоритет строке «со скидкой», иначе меньшая сумма (актуальная)
        discount_regular = [p for p in regular_items if p[3]]
        if discount_regular:
            current = normalize_price_line(min(discount_regular, key=lambda x: x[1])[0])
        else:
            current = normalize_price_line(regular_sorted[0][0])
        # Если «старая» из strike меньше актуальной — поменять (битый entity)
        if price_amount(old) and price_amount(current) and price_amount(old) < price_amount(current):
            current, old = old, current
    elif len(parsed) == 1:
        line, amt, struck, discount_kw = parsed[0]
        norm = normalize_price_line(line)
        if struck and not discount_kw:
            return None, norm
        return norm, None
    else:
        # Несколько цен без надёжного strikethrough: меньшая = актуальная (скидка)
        parsed_sorted = sorted(parsed, key=lambda x: x[1])
        discount_items = [p for p in parsed if p[3]]
        if discount_items:
            best = min(discount_items, key=lambda x: x[1])
            current = normalize_price_line(best[0])
            others = [p for p in parsed if p != best]
            if others:
                old = normalize_price_line(max(others, key=lambda x: x[1])[0])
        elif len(parsed_sorted) >= 2:
            current = normalize_price_line(parsed_sorted[0][0])
            old = normalize_price_line(parsed_sorted[-1][0])
        else:
            current = normalize_price_line(parsed_sorted[0][0])

    if current and old and price_amount(current) and price_amount(old):
        if price_amount(current) > price_amount(old):
            current, old = old, current

    return current, old

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
    price_candidates: list[tuple[str, bool, bool]] = []
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

        if _PRICE_RE.search(line):
            struck = is_strikethrough_line(text, line_start, line_end, strike_ranges)
            discount_kw = bool(_DISCOUNT_PRICE_RE.search(line))
            price_candidates.append((line, struck, discount_kw))
            continue

        # Размеры: сначала полностью убираем emoji (включая Premium), потом только цифры 34–52
        line_for_sizes = strip_all_emoji(line)
        size_probe = _ARROW_RE.sub("", line_for_sizes).replace(",", " ").strip()
        size_nums = extract_size_numbers(line_for_sizes)
        if _ARROW_RE.search(line) or (
            size_nums
            and (
                _SIZE_ONLY.match(size_probe)
                or len(size_nums) >= 2
                or (len(size_nums) == 1 and not _PRICE_RE.search(line))
            )
        ):
            if size_nums:
                sizes_parts.append(", ".join(size_nums))
            continue

        if title is None:
            title = line
        else:
            desc_lines.append(line)

    price, old_price = resolve_prices(price_candidates)

    # Без актуальной цены — не товар
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


# ─── Снятие / возврат товара с сайта (ответ «продано» на пост) ─────────────────

_SOLD_CMD = re.compile(
    r"^(продан[аоы]?|продано|sold|снять|убрать|распродан[ао]?|нет\s+в\s+наличии)\.?!?$",
    re.IGNORECASE,
)
_AVAILABLE_CMD = re.compile(
    r"^(в\s+наличии|вернуть|доступно|available)\.?!?$",
    re.IGNORECASE,
)


def _find_product_for_reply(replied: Message) -> dict | None:
    """Находит товар по сообщению, на которое ответили."""
    rid = replied.message_id
    mgid = replied.media_group_id

    if mgid:
        res = (
            supabase.table("products")
            .select("id, title, is_available")
            .eq("telegram_media_group_id", mgid)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]

    res = (
        supabase.table("products")
        .select("id, title, is_available")
        .eq("telegram_message_id", rid)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def handle_availability_reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg: Message = update.message
    if not msg or not msg.text or not msg.reply_to_message:
        return

    text = msg.text.strip()
    mark_sold = bool(_SOLD_CMD.match(text))
    mark_available = bool(_AVAILABLE_CMD.match(text))
    if not mark_sold and not mark_available:
        return

    product = _find_product_for_reply(msg.reply_to_message)
    if not product:
        await msg.reply_text(
            "⚠️ Товар не найден. Ответьте «продано» именно на **фото с подписью**, "
            "которое бот уже добавил в каталог.",
            parse_mode="Markdown",
        )
        return

    is_avail = True if mark_available else False
    supabase.table("products").update({"is_available": is_avail}).eq("id", product["id"]).execute()

    title = product.get("title") or "Модель"
    if is_avail:
        reply = f"✅ «{title}» снова **в каталоге** на сайте."
    else:
        reply = f"✅ «{title}» **снята с сайта** (продано)."
    await msg.reply_text(reply, parse_mode="Markdown")
    log.info("Товар id=%s is_available=%s (команда: %s)", product["id"], is_avail, text)


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
                        f"💰 **Итого к оплате:** {total:,} сум\n\n"
                        f"📌 После выдачи ответьте **«продано»** на пост модели в группе — "
                        f"она исчезнет с talaria.uz."
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
    app.add_handler(MessageHandler(filters.TEXT & filters.REPLY, handle_availability_reply))
    log.info("Бот запущен — фото в каталог, ответ «продано» снимает с сайта...")
    app.run_polling(allowed_updates=["message", "channel_post"])


if __name__ == "__main__":
    main()
