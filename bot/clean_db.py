import os
import re
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

def clean_sizes(sizes_str: str) -> str:
    if not sizes_str:
        return ""
    clean = clean_emoji(sizes_str)
    # Оставляем только числа размеров
    matches = re.findall(r'\b(3[4-9]|4[0-8])\b', clean)
    if matches:
        return ", ".join(sorted(list(set(matches))))
    return clean

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
    print("Получаем все товары из базы данных...")
    res = supabase.table("products").select("*").execute()
    products = res.data
    print(f"Найдено товаров: {len(products)}")

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
            found_sizes = re.findall(r'\b(3[5-9]|4[0-6])\b', original_desc)
            if found_sizes:
                cleaned_sizes = ", ".join(sorted(list(set(found_sizes))))

        # Если заголовок стал слишком коротким или пустым, даем красивое название
        if len(cleaned_title) < 2:
            cleaned_title = get_fallback_title(cleaned_desc)

        # Очищаем цену от застрявших эмодзи, если есть
        cleaned_price = clean_emoji(original_price).strip()

        # Проверяем, изменилось ли что-то
        if (cleaned_title != original_title or 
            cleaned_desc != original_desc or 
            cleaned_sizes != original_sizes or 
            cleaned_price != original_price):
            
            print(f"Обновляем товар #{p_id}:")
            print(f"  Было:  Title: '{original_title}' | Sizes: '{original_sizes}'")
            print(f"  Стало: Title: '{cleaned_title}' | Sizes: '{cleaned_sizes}'")
            
            supabase.table("products").update({
                "title": cleaned_title,
                "description": cleaned_desc,
                "sizes": cleaned_sizes,
                "price": cleaned_price
            }).eq("id", p_id).execute()
            updated_count += 1

    print(f"Готово! Успешно очищено и обновлено товаров в БД: {updated_count}")

if __name__ == "__main__":
    main()
