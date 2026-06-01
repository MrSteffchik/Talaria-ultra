import os
import re
import argparse
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def clean_emoji(text: str) -> str:
    if not text:
        return ""
    # Удаляем все эмодзи (символы из диапазона суррогатных пар и высших плоскостей Юникода)
    clean = re.sub(r'[\U00010000-\U0010ffff]', '', text)
    # Удаляем стандартные графические глифы, стрелки, сердечки и значки
    clean = re.sub(r'[\u2000-\u3300\u2600-\u27bf]', '', clean)
    return clean.strip()

def clean_text_fully(text: str) -> str:
    clean = clean_emoji(text)
    # Убираем оставшийся мусор в начале текста
    clean = re.sub(r'^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*#]+', '', clean)
    return clean.strip()

def extract_size_numbers(text: str) -> list[str]:
    if not text:
        return []
    stripped = re.sub(r"[^\d,\s\-\.]", "", clean_emoji(text))
    return sorted(set(re.findall(r"\b(3[4-9]|4[0-9]|5[0-2])\b", stripped)))


def clean_sizes(sizes_str: str) -> str:
    found = extract_size_numbers(sizes_str or "")
    return ", ".join(found) if found else ""


def price_amount(text: str) -> int:
    digits = re.sub(r"\D", "", text or "")
    return int(digits) if digits else 0


def fix_price_display(price_str: str) -> str:
    if not price_str:
        return ""
    clean = clean_emoji(price_str).strip()
    m = re.match(r"(.*?)\s*\((?:было|было:)\s*(.*?)\)\s*$", clean, re.IGNORECASE)
    if not m:
        return clean
    current, old = m.group(1).strip(), m.group(2).strip()
    current = re.sub(
        r"^(?:цена\s*(?:со\s*скидкой)?\s*:?\s*)", "", current, flags=re.IGNORECASE
    ).strip()
    old = re.sub(
        r"^(?:цена\s*(?:со\s*скидкой)?\s*:?\s*)", "", old, flags=re.IGNORECASE
    ).strip()
    if price_amount(current) > price_amount(old) and price_amount(old) > 0:
        current, old = old, current
    return f"{current} (было: {old})"

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

def clean_description(desc: str) -> str:
    if not desc:
        return ""
    lines = desc.splitlines()
    cleaned_lines = []
    for line in lines:
        cleaned_line = clean_emoji(line)
        cleaned_line = re.sub(r'^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*]+', '', cleaned_line).strip()
        if cleaned_line:
            cleaned_lines.append(cleaned_line)
    return "\n".join(cleaned_lines)

def main():
    parser = argparse.ArgumentParser(description="Очистка товаров Talaria в Supabase")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Только показать изменения, без записи в БД",
    )
    args = parser.parse_args()

    print("Получаем все товары из базы данных...")
    res = supabase.table("products").select("*").execute()
    products = res.data
    print(f"Найдено товаров: {len(products)}")
    if args.dry_run:
        print("Режим dry-run: в БД ничего не записываем.\n")

    updated_count = 0
    for p in products:
        p_id = p["id"]
        original_title = p["title"]
        original_desc = p["description"]
        original_sizes = p["sizes"]
        original_price = p["price"]

        # Чистим
        cleaned_title = clean_text_fully(original_title)
        cleaned_desc = clean_description(original_desc)
        cleaned_sizes = clean_sizes(original_sizes)

        # Если в sizes ничего не осталось, пробуем найти в описании
        if not cleaned_sizes and original_desc:
            found_sizes = extract_size_numbers(original_desc)
            if found_sizes:
                cleaned_sizes = ", ".join(found_sizes)

        if cleaned_title and extract_size_numbers(cleaned_title) and re.match(
            r"^[\d\s,\.\-]+$", cleaned_title.replace(" ", "")
        ):
            if not cleaned_sizes:
                cleaned_sizes = ", ".join(extract_size_numbers(cleaned_title))
            cleaned_title = get_fallback_title(cleaned_desc)

        # Если заголовок стал слишком коротким или пустым, даем красивое название
        if len(cleaned_title) < 2:
            cleaned_title = get_fallback_title(cleaned_desc)

        cleaned_price = fix_price_display(original_price)

        # Проверяем, изменилось ли что-то
        if (cleaned_title != original_title or 
            cleaned_desc != original_desc or 
            cleaned_sizes != original_sizes or 
            cleaned_price != original_price):
            
            print(f"Обновляем товар #{p_id}:")
            print(f"  Было:  Title: '{original_title}' | Sizes: '{original_sizes}' | Price: '{original_price}'")
            print(f"  Стало: Title: '{cleaned_title}' | Sizes: '{cleaned_sizes}' | Price: '{cleaned_price}'")

            if not args.dry_run:
                supabase.table("products").update({
                    "title": cleaned_title,
                    "description": cleaned_desc,
                    "sizes": cleaned_sizes or None,
                    "price": cleaned_price,
                }).eq("id", p_id).execute()
            updated_count += 1

    action = "будет обновлено" if args.dry_run else "обновлено"
    print(f"Готово! {action} товаров: {updated_count}")

if __name__ == "__main__":
    main()
