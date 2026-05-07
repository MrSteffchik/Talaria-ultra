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


def is_strikethrough(line: str, text: str, strike_ranges: set) -> bool:
    """Проверяет, является ли строка полностью зачёркнутой."""
    if not strike_ranges:
        return False
    try:
        start = text.index(line)
        end = start + len(line)
        for (s, e) in strike_ranges:
            if s <= start and end <= e:
                return True
    except ValueError:
        pass
    return False


def parse_caption(text: str, entities=None) -> dict | None:
    if not text:
        return None
    if _REVIEW_RE.search(text):
        log.info("Пропускаем: пост с отзывом")
        return None

    strike_ranges = extract_strikethrough(text, entities)

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
        if _PRICE_RE.search(line) and is_strikethrough(line, text, strike_ranges):
            old_price = line
            continue

        # Обычная строка с ценой = текущая цена
        if _PRICE_RE.search(line):
            price = line
            continue

        # Строка только из цифр (размеры) или содержит ➡️
        if _ARROW_RE.search(line) or (_SIZE_NUM.search(line) and _SIZE_ONLY.match(_ARROW_RE.sub("", line).replace(",", " ").strip())):
            cleaned = _ARROW_RE.sub("", line).strip()
            sizes_parts.append(cleaned)
            continue

        if title is None:
            title = line
        else:
            desc_lines.append(line)

    if not title and not price:
        return None

    sizes = ", ".join(sizes_parts) if sizes_parts else None

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

    supabase.table("products").insert(parsed).execute()
    log.info("Сохранён товар: %s | %s", parsed["title"], parsed["price"])


# ─── Запуск ───────────────────────────────────────────────────────────────────

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(MessageHandler(filters.PHOTO, handle_message))
    log.info("Бот запущен — слушаем группу...")
    app.run_polling(allowed_updates=["message", "channel_post"])


if __name__ == "__main__":
    main()
