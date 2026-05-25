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

# Все юникод-эмодзи (вкл. fallback-символы премиум-эмодзи Telegram)
_EMOJI_RE = re.compile(
    "["
    "\U0001F1E0-\U0001F1FF"
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "☀-➿"
    "️"
    "‍"
    "]+",
    flags=re.UNICODE,
)


def _utf16_slice(text: str, offset: int, length: int) -> str:
    """Извлекает подстроку по UTF-16 offset/length (как у Telegram entities)."""
    b = text.encode("utf-16-le")
    return b[offset * 2 : (offset + length) * 2].decode("utf-16-le", errors="ignore")


def strip_custom_emoji(text: str, entities) -> str:
    """Удаляет из текста premium custom_emoji (Telegram возвращает их как
    обычные эмодзи-плейсхолдеры, что ломает парсинг названия/размеров)."""
    if not text or not entities:
        return text
    b = bytearray(text.encode("utf-16-le"))
    ranges = []
    for e in entities:
        if e.type == "custom_emoji":
            ranges.append((e.offset * 2, (e.offset + e.length) * 2))
    for s, en in sorted(ranges, reverse=True):
        del b[s:en]
    return bytes(b).decode("utf-16-le", errors="ignore")


def clean_emoji(s: str) -> str:
    """Убирает emoji-мусор из строки и обрезает по краям знаки-разделители."""
    if not s:
        return s
    cleaned = _EMOJI_RE.sub("", s)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" \t-—–|•·:.,")
    return cleaned


def parse_caption(text: str, strike_texts=None) -> dict | None:
    if not text:
        return None
    if _REVIEW_RE.search(text):
        log.info("Пропускаем: пост с отзывом")
        return None
    if _SKIP_POST_RE.search(text):
        log.info("Пропускаем: не товарный пост")
        return None

    strike_texts = strike_texts or set()

    title = None
    sizes_parts: list[str] = []
    price = None
    old_price = None
    desc_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _SKIP_RE.search(line):
            continue
        if _PHONE_RE.match(line) or _ORDER_RE.search(line):
            continue

        # Зачёркнутая строка с ценой = старая цена
        if _PRICE_RE.search(line) and any(line in s or s in line for s in strike_texts):
            old_price = clean_emoji(line)
            continue

        # Обычная строка с ценой = текущая цена
        if _PRICE_RE.search(line):
            price = clean_emoji(line)
            continue

        # Размеры: строка с цифрами 35-52, либо помечена стрелкой ➡️
        stripped = _ARROW_RE.sub("", line).strip()
        digits_only = re.findall(r"\b(3[5-9]|4[0-9]|5[0-2])\b", stripped)
        if digits_only and (_ARROW_RE.search(line) or _SIZE_ONLY.match(_EMOJI_RE.sub("", stripped).replace(",", " ").strip())):
            sizes_parts.extend(digits_only)
            continue

        if title is None:
            title = clean_emoji(line)
            if not title:
                title = None
        else:
            cleaned_line = clean_emoji(line)
            if cleaned_line:
                desc_lines.append(cleaned_line)

    # Без цены — не товар
    if not price:
        return None

    # Уникальные числовые размеры
    unique_sizes = sorted(set(sizes_parts), key=int) if sizes_parts else []
    sizes = ", ".join(unique_sizes) if unique_sizes else None

    # Показываем цену красиво: если есть скидка
    display_price = price or ""
    if old_price and price:
        display_price = f"{price} (было: {old_price})"

    return {
        "title":       title or "Товар",
        "sizes":       sizes,
        "price":       display_price,
        "description": "\n".join(desc_lines) or None,
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

    # Убираем premium custom_emoji из текста и собираем тексты зачёркнутых фрагментов
    clean_caption = strip_custom_emoji(caption, entities)
    strike_texts = {
        _utf16_slice(caption, e.offset, e.length)
        for e in entities if e.type == "strikethrough"
    }

    parsed = parse_caption(clean_caption, strike_texts)
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

    supabase.table("products").insert(parsed).execute()
    log.info("Сохранён товар: %s | %s", parsed["title"], parsed["price"])


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
