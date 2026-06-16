import os
import re
import logging
from telegram import Update, Message, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import Application, MessageHandler, filters, ContextTypes, CallbackQueryHandler, CommandHandler
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

# Парсим список ID админов из переменной окружения
ADMIN_IDS_STR = os.environ.get("ADMIN_IDS", "")
ADMIN_IDS = set(int(id.strip()) for id in ADMIN_IDS_STR.split(",") if id.strip())

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

_COLOR_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(белый|белая|белые|бел)\b", re.I), "Белый"),
    (re.compile(r"\b(чёрн|черн|black)\b", re.I), "Чёрный"),
    (re.compile(r"\b(бежев|беж)\b", re.I), "Бежевый"),
    (re.compile(r"\b(коричнев)\b", re.I), "Коричневый"),
    (re.compile(r"\b(серый|серая|серые)\b", re.I), "Серый"),
    (re.compile(r"\b(красн)\b", re.I), "Красный"),
    (re.compile(r"\b(розов)\b", re.I), "Розовый"),
    (re.compile(r"\b(синий|синяя|голуб)\b", re.I), "Синий"),
    (re.compile(r"\b(зелен|зелён)\b", re.I), "Зелёный"),
    (re.compile(r"\b(золот)\b", re.I), "Золотой"),
    (re.compile(r"\b(серебр)\b", re.I), "Серебряный"),
]


def extract_color(text: str) -> str | None:
    if not text:
        return None
    for pattern, label in _COLOR_RULES:
        if pattern.search(text):
            return label
    return None


def make_variant_key(title: str, price: str) -> str:
    t = clean_text_fully(title or "").lower()
    t = re.sub(r"\s+", " ", t).strip()[:100]
    base_price = re.sub(r"\s*\(.*", "", price or "")
    amt = price_amount(base_price) or 0
    return f"{t}|{amt}"


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

    color_blob = " ".join(filter(None, [text, cleaned_title, cleaned_desc]))
    product_color = extract_color(color_blob)
    vkey = make_variant_key(cleaned_title, display_price)

    return {
        "title":       cleaned_title,
        "sizes":       cleaned_sizes or None,
        "price":       display_price,
        "description": cleaned_desc or None,
        "color":       product_color,
        "variant_key": vkey,
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


# ─── Снятие / возврат товара с сайта (ответ «продано» / «продано 42») ────────

_SOLD_CMD = re.compile(
    r"^(продан[аоы]?|продано|sold|снять|убрать|распродан[ао]?|нет\s+в\s+наличии)"
    r"(?:\s+(.+))?\s*\.?!?$",
    re.IGNORECASE,
)
_AVAILABLE_CMD = re.compile(
    r"^(в\s+наличии|вернуть|доступно|available)(?:\s+(.+))?\s*\.?!?$",
    re.IGNORECASE,
)


def parse_sizes_field(sizes_str: str | None) -> list[str]:
    return extract_size_numbers(sizes_str or "")


def format_sizes_field(sizes: list[str]) -> str | None:
    return ", ".join(sizes) if sizes else None


def parse_availability_command(text: str) -> tuple[str | None, list[str]]:
    """('sold' | 'available' | None, размеры). Пустой список размеров = вся модель."""
    text = (text or "").strip()
    m = _SOLD_CMD.match(text)
    if m:
        rest = (m.group(2) or "").strip()
        return "sold", extract_size_numbers(rest) if rest else []
    m = _AVAILABLE_CMD.match(text)
    if m:
        rest = (m.group(2) or "").strip()
        return "available", extract_size_numbers(rest) if rest else []
    return None, []


def _find_product_for_reply(replied: Message) -> dict | None:
    """Находит товар по сообщению, на которое ответили."""
    rid = replied.message_id
    mgid = replied.media_group_id
    fields = "id, title, sizes, is_available"

    if mgid:
        res = (
            supabase.table("products")
            .select(fields)
            .eq("telegram_media_group_id", mgid)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]

    res = (
        supabase.table("products")
        .select(fields)
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
    action, size_nums = parse_availability_command(text)
    if not action:
        return

    product = _find_product_for_reply(msg.reply_to_message)
    if not product:
        await msg.reply_text(
            "⚠️ Товар не найден. Ответьте на **фото с подписью**, "
            "которое бот уже добавил в каталог.\n"
            "Примеры: `продано`, `продано 42`, `в наличии 41`",
            parse_mode="Markdown",
        )
        return

    pid = product["id"]
    title = product.get("title") or "Модель"
    current_sizes = parse_sizes_field(product.get("sizes"))

    if action == "sold" and size_nums:
        if not current_sizes:
            await msg.reply_text(
                f"⚠️ У «{title}» в каталоге **не указаны размеры**.\n"
                "Напишите просто **продано** — снимется вся модель.",
                parse_mode="Markdown",
            )
            return

        to_remove = [s for s in size_nums if s in current_sizes]
        if not to_remove:
            have = format_sizes_field(current_sizes) or "—"
            ask = ", ".join(size_nums)
            await msg.reply_text(
                f"⚠️ Размер(ы) **{ask}** не найдены.\nВ каталоге сейчас: {have}",
                parse_mode="Markdown",
            )
            return

        remaining = [s for s in current_sizes if s not in to_remove]
        update: dict = {"sizes": format_sizes_field(remaining)}
        if not remaining:
            update["is_available"] = False
        supabase.table("products").update(update).eq("id", pid).execute()

        removed = ", ".join(to_remove)
        if remaining:
            left = format_sizes_field(remaining)
            reply = f"✅ «{title}»: снят размер **{removed}**.\nОстались: {left}"
        else:
            reply = f"✅ «{title}»: размер **{removed}** продан.\nВся модель **снята с сайта**."
        await msg.reply_text(reply, parse_mode="Markdown")
        log.info("Товар id=%s сняты размеры %s, осталось %s", pid, removed, remaining)
        return

    if action == "available" and size_nums:
        merged = sorted(set(current_sizes) | set(size_nums), key=int)
        supabase.table("products").update({
            "sizes": format_sizes_field(merged),
            "is_available": True,
        }).eq("id", pid).execute()
        added = ", ".join(size_nums)
        all_sizes = format_sizes_field(merged)
        reply = f"✅ «{title}»: размер **{added}** снова в наличии.\nРазмеры: {all_sizes}"
        await msg.reply_text(reply, parse_mode="Markdown")
        log.info("Товар id=%s возвращены размеры %s", pid, added)
        return

    # Вся модель
    is_avail = action == "available"
    supabase.table("products").update({"is_available": is_avail}).eq("id", pid).execute()
    if is_avail:
        reply = f"✅ «{title}» снова **в каталоге** на сайте."
    else:
        reply = f"✅ «{title}» **снята с сайта** (продано)."
    await msg.reply_text(reply, parse_mode="Markdown")
    log.info("Товар id=%s is_available=%s (команда: %s)", pid, is_avail, text)


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

    # Тот же товар повторно в группе (два поста с одной подписью) — дополняем фото
    vk = parsed.get("variant_key")
    pcolor = parsed.get("color")
    dup_q = supabase.table("products").select("id, photos").eq("variant_key", vk)
    if pcolor:
        dup_q = dup_q.eq("color", pcolor)
    else:
        dup_q = dup_q.is_("color", "null")
    dup_variant = dup_q.limit(1).execute()
    if dup_variant.data:
        row = dup_variant.data[0]
        photos = list(row.get("photos") or [])
        if photo_url and photo_url not in photos:
            photos.append(photo_url)
            supabase.table("products").update({"photos": photos}).eq("id", row["id"]).execute()
            log.info("Дубликат объединён с id=%s (variant_key=%s)", row["id"], vk)
        return

    try:
        supabase.table("products").insert(parsed).execute()
        log.info("Сохранён товар: %s | %s | %s", parsed["title"], parsed.get("color"), parsed["price"])
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

                    # Добавляем последние 4 цифры карты если есть
                    card_last_four = order.get("card_last_four", "")
                    card_info = f"\n💳 **Карта:** {card_last_four}" if card_last_four else ""

                    # Генерируем ссылку на Яндекс.Карты для адреса
                    yandex_maps_link = ""
                    if delivery == "delivery" and address and address != "Не указан":
                        # Кодируем адрес для URL (добавляем Ташкент если нет)
                        import urllib.parse
                        address_for_map = address if "ташкент" in address.lower() else f"Ташкент {address}"
                        encoded_address = urllib.parse.quote(address_for_map)
                        yandex_maps_link = f"\n\n🗺️ [📍 Открыть адрес на Яндекс.Картах](https://yandex.uz/maps/?text={encoded_address})"

                    msg_text = (
                        f"🔔 **НОВЫЙ ЗАКАЗ #{order_id}!**\n\n"
                        f"👤 **Покупатель:** {name}\n"
                        f"📞 **Телефон:** [`{phone}`](tel:{phone.replace(' ', '')})\n"
                        f"📦 **Тип получения:** {deliv_str}\n"
                        f"📍 **Адрес:** {address}{yandex_maps_link}\n"
                        f"💳 **Оплата:** {pay_str}{card_info}\n\n"
                        f"🛍️ **Состав заказа:**\n{items_str}\n\n"
                        f"💰 **Итого к оплате:** {total:,} сум\n\n"
                        f"📌 После выдачи: **«продано»** (вся модель) или **«продано 42»** "
                        f"(только размер) на пост в группе."
                    ).replace(",", " ")

                    # Создаем inline кнопки для подтверждения/отклонения
                    keyboard = InlineKeyboardMarkup([
                        [
                            InlineKeyboardButton("✅ Подтвердить", callback_data=f"order_confirm_{order_id}"),
                            InlineKeyboardButton("❌ Отклонить", callback_data=f"order_reject_{order_id}")
                        ]
                    ])

                    # Отправляем уведомление администратору с кнопками
                    await app.bot.send_message(
                        chat_id=admin_chat_id,
                        text=msg_text,
                        parse_mode="Markdown",
                        reply_markup=keyboard
                    )
                    log.info("Отправлено уведомление о заказе #%s администратору", order_id)
                    
                    # Обновляем статус заказа, чтобы не слать повторно
                    supabase.table("orders").update({"status": "notified"}).eq("id", order_id).execute()
                    
            await asyncio.sleep(20) # Проверяем каждые 20 секунд
        except Exception as exc:
            log.error("Ошибка в фоновом цикле заказов: %s", exc)
            await asyncio.sleep(30)


def is_admin(user_id: int) -> bool:
    """Проверяет что пользователь админ"""
    log.info("Проверка админа: user_id=%s, ADMIN_IDS=%s", user_id, ADMIN_IDS)
    result = user_id in ADMIN_IDS
    log.info("Результат: %s", result)
    return result


async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик команды /start (только для админов)"""
    user = update.message.from_user
    user_id = user.id

    if not is_admin(user_id):
        await update.message.reply_text(
            f"❌ Вы не админ.\n"
            f"ID: `{user_id}`",
            parse_mode="Markdown"
        )
        log.warning("Попытка доступа: ID %s", user_id)
        return

    stats_text = (
        f"👋 **Добро пожаловать, {user.first_name}!**\n\n"
        f"📊 **Доступные команды:**\n"
        f"• `/stats` — статистика заказов и заработки\n\n"
        f"🛍️ **Управление заказами:**\n"
        f"• Нажимай кнопки **✅ Подтвердить** / **❌ Отклонить** в уведомлениях\n\n"
        f"📝 **Управление товарами:**\n"
        f"• Отправь фото с названием, ценой и размерами\n"
        f"• Ответь **«продано»** чтобы снять товар\n"
        f"• Ответь **«продано 42»** чтобы снять размер"
    )
    await update.message.reply_text(stats_text, parse_mode="Markdown")
    log.info("Админ %s (%s) авторизован", user_id, user.first_name)


async def handle_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Показывает статистику заказов и заработки (только для админов)"""
    user_id = update.message.from_user.id

    if not is_admin(user_id):
        await update.message.reply_text(
            f"❌ Вы не админ.\n"
            f"ID: `{user_id}`",
            parse_mode="Markdown"
        )
        return

    try:
        from datetime import datetime, timedelta
        
        # Получаем все подтвержденные заказы
        res = supabase.table("orders").select("*").eq("status", "confirmed").execute()
        confirmed_orders = res.data or []

        # Получаем все отклоненные заказы
        res = supabase.table("orders").select("*").eq("status", "rejected").execute()
        rejected_orders = res.data or []

        # Получаем все заказы со статусом pending/notified
        res = supabase.table("orders").select("*").in_("status", ["pending", "notified"]).execute()
        pending_orders = res.data or []

        # Считаем общую статистику
        confirmed_count = len(confirmed_orders)
        confirmed_sum = sum(order.get("total_price", 0) for order in confirmed_orders)

        rejected_count = len(rejected_orders)
        pending_count = len(pending_orders)

        # Статистика за СЕГОДНЯ
        today = datetime.now().strftime("%Y-%m-%d")
        today_orders = [o for o in confirmed_orders if o.get("created_at", "").startswith(today)]
        today_count = len(today_orders)
        today_sum = sum(o.get("total_price", 0) for o in today_orders)

        # Разделение по типу доставки (за все время)
        pickup_orders = [o for o in confirmed_orders if o.get("delivery_type") == "pickup"]
        delivery_orders = [o for o in confirmed_orders if o.get("delivery_type") == "delivery"]
        
        pickup_count = len(pickup_orders)
        delivery_count = len(delivery_orders)
        pickup_sum = sum(o.get("total_price", 0) for o in pickup_orders)
        delivery_sum = sum(o.get("total_price", 0) for o in delivery_orders)

        # Разделение по типу доставки за СЕГОДНЯ
        today_pickup = [o for o in today_orders if o.get("delivery_type") == "pickup"]
        today_delivery = [o for o in today_orders if o.get("delivery_type") == "delivery"]
        today_pickup_count = len(today_pickup)
        today_delivery_count = len(today_delivery)

        total_orders = confirmed_count + rejected_count + pending_count

        stats_text = (
            f"📊 **СТАТИСТИКА ЗАКАЗОВ**\n\n"
            f"📅 **ЗА СЕГОДНЯ** ({today}):\n"
            f"✅ Подтверждено: {today_count} заказов\n"
            f"   • Самовывоз: {today_pickup_count}\n"
            f"   • Доставка: {today_delivery_count}\n"
            f"💰 Заработано: {today_sum:,} сум\n\n"
            f"📈 **ВСЕГО**:\n"
            f"✅ Подтверждено: {confirmed_count} заказов\n"
            f"   • Самовывоз: {pickup_count} ({pickup_sum:,} сум)\n"
            f"   • Доставка: {delivery_count} ({delivery_sum:,} сум)\n"
            f"💰 Заработано: {confirmed_sum:,} сум\n\n"
            f"⏳ В ожидании: {pending_count}\n"
            f"❌ Отклонено: {rejected_count}\n\n"
            f"📌 **Всего заказов:** {total_orders}"
        ).replace(",", " ")

        await update.message.reply_text(stats_text, parse_mode="Markdown")
        log.info("Показана статистика заказов")

    except Exception as exc:
        log.error("Ошибка при получении статистики: %s", exc)
        await update.message.reply_text("❌ Ошибка при получении статистики")


async def handle_order_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Обработчик callback кнопок для подтверждения/отклонения заказов"""
    query = update.callback_query
    await query.answer()  # Убираем "загрузку" на кнопке

    callback_data = query.data

    if not callback_data.startswith("order_"):
        return

    action, order_id = callback_data.rsplit("_", 1)
    try:
        order_id = int(order_id)
    except ValueError:
        await query.answer("❌ Ошибка: неверный ID заказа", show_alert=True)
        return

    try:
        # Получаем текущий заказ
        res = supabase.table("orders").select("*").eq("id", order_id).single().execute()
        order = res.data

        if not order:
            await query.answer("❌ Заказ не найден", show_alert=True)
            return

        # Проверяем, не обработан ли уже заказ
        if order.get("status") in ["confirmed", "rejected"]:
            await query.answer("⚠️ Этот заказ уже обработан", show_alert=True)
            return

        if action == "order_confirm":
            # Подтверждаем заказ
            supabase.table("orders").update({"status": "confirmed"}).eq("id", order_id).execute()
            new_text = (
                f"✅ **Заказ #{order_id} подтвержден!**\n\n"
                f"👤 **Покупатель:** {order['customer_name']}\n"
                f"📞 **Телефон:** [`{order['phone']}`](tel:{order['phone'].replace(' ', '')})\n"
                f"💰 **Сумма:** {order['total_price']:,} сум".replace(",", " ")
            )
            try:
                await query.edit_message_text(text=new_text, parse_mode="Markdown")
            except Exception as e:
                if "message is not modified" in str(e).lower():
                    log.info("Сообщение уже изменено, пропускаем")
                else:
                    raise
            log.info("✅ Заказ #%s подтвержден", order_id)

        elif action == "order_reject":
            # Отклоняем заказ
            supabase.table("orders").update({"status": "rejected"}).eq("id", order_id).execute()
            new_text = (
                f"❌ **Заказ #{order_id} отклонен**\n\n"
                f"Статус: Отклонено"
            )
            try:
                await query.edit_message_text(text=new_text, parse_mode="Markdown")
            except Exception as e:
                if "message is not modified" in str(e).lower():
                    log.info("Сообщение уже изменено, пропускаем")
                else:
                    raise
            log.info("❌ Заказ #%s отклонен", order_id)

    except Exception as exc:
        log.error("Ошибка при обработке callback заказа: %s", exc)
        await query.answer(f"❌ Ошибка: {str(exc)}", show_alert=True)


async def post_init(application: Application) -> None:
    import asyncio
    # Запускаем фоновую задачу проверки заказов в цикле событий asyncio
    asyncio.create_task(order_checker_loop(application))


# ─── Запуск ───────────────────────────────────────────────────────────────────

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", handle_start))
    app.add_handler(CommandHandler("stats", handle_stats))
    app.add_handler(MessageHandler(filters.PHOTO, handle_message))
    app.add_handler(MessageHandler(filters.TEXT & filters.REPLY, handle_availability_reply))
    app.add_handler(CallbackQueryHandler(handle_order_callback))
    log.info("Бот запущен — каталог из фото, «продано» / «продано 42» снимает с сайта...")
    app.run_polling(allowed_updates=["message", "channel_post", "callback_query"])


if __name__ == "__main__":
    main()
