const fs = require('fs');
const path = require('path');

// Читаем .env файл вручную
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
});

const SUPABASE_URL = env['SUPABASE_URL'];
const SUPABASE_KEY = env['SUPABASE_SERVICE_KEY'];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Ошибка: не удалось прочитать SUPABASE_URL или SUPABASE_SERVICE_KEY из .env");
  process.exit(1);
}

// Умная очистка от эмодзи и Telegram Premium реакций с помощью регулярных выражений Unicode
function cleanEmoji(text) {
  if (!text) return '';
  // Удаляем все эмодзи с помощью Unicode Property Escapes
  let clean = text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\p{Emoji_Presentation}/gu, '').trim();
  // Дополнительно вычищаем значки и стрелки
  clean = clean.replace(/[\u2000-\u3300\u2600-\u27bf]/g, '').trim();
  return clean;
}

function cleanTextFully(text) {
  const clean = cleanEmoji(text);
  // Убираем оставшийся мусор в начале
  return clean.replace(/^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*#]+/, '').trim();
}

function cleanSizes(sizesStr) {
  if (!sizesStr) return '';
  const clean = cleanEmoji(sizesStr);
  const matches = clean.match(/\b(3[4-9]|4[0-8])\b/g);
  if (matches) {
    return [...new Set(matches)].sort().join(', ');
  }
  return clean;
}

function cleanDescription(desc) {
  if (!desc) return '';
  const lines = desc.split('\n');
  const cleanedLines = lines.map(line => {
    let cleanLine = cleanEmoji(line);
    cleanLine = cleanLine.replace(/^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*]+/, '').trim();
    return cleanLine;
  }).filter(line => line.length > 0);
  
  return cleanedLines.join('\n');
}

function getFallbackTitle(desc) {
  const text = (desc || "").toLowerCase();
  if (text.includes('кроссовк') || text.includes('кед')) return 'Стильные кроссовки';
  if (text.includes('туфли') || text.includes('каблук')) return 'Элегантные туфли';
  if (text.includes('босонож') || text.includes('сандал')) return 'Премиальные босоножки';
  if (text.includes('сабо') || text.includes('слипон')) return 'Удобные сабо';
  return 'Женская обувь Talaria';
}

async function run() {
  console.log("Получаем список всех товаров...");
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, { headers });
    if (!res.ok) {
      throw new Error(`Ошибка загрузки: ${res.statusText} (${res.status})`);
    }
    const products = await res.json();
    console.log(`Успешно получено товаров: ${products.length}`);

    let updatedCount = 0;

    for (const p of products) {
      const id = p.id;
      const originalTitle = p.title || '';
      const originalDesc = p.description || '';
      const originalSizes = p.sizes || '';
      const originalPrice = p.price || '';

      // Чистим поля
      let cleanedTitle = cleanTextFully(originalTitle);
      let cleanedDesc = cleanDescription(originalDesc);
      let cleanedSizes = cleanSizes(originalSizes);

      // Умный поиск размеров в описании, если они пусты
      if (!cleanedSizes && originalDesc) {
        const found = originalDesc.match(/\b(3[5-9]|4[0-6])\b/g);
        if (found) {
          cleanedSizes = [...new Set(found)].sort().join(', ');
        }
      }

      // Название фолбек, если стало пустым
      if (cleanedTitle.length < 2) {
        cleanedTitle = getFallbackTitle(cleanedDesc);
      }

      // Чистим цену
      const cleanedPrice = cleanEmoji(originalPrice).trim();

      // Проверяем изменения
      if (
        cleanedTitle !== originalTitle ||
        cleanedDesc !== originalDesc ||
        cleanedSizes !== originalSizes ||
        cleanedPrice !== originalPrice
      ) {
        console.log(`Обновляем товар #${id}:`);
        console.log(`  Было:  Title: "${originalTitle}" | Sizes: "${originalSizes}"`);
        console.log(`  Стало: Title: "${cleanedTitle}" | Sizes: "${cleanedSizes}"`);

        const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: cleanedTitle,
            description: cleanedDesc,
            sizes: cleanedSizes,
            price: cleanedPrice
          })
        });

        if (!updateRes.ok) {
          console.error(`Ошибка при обновлении #${id}:`, updateRes.statusText);
        } else {
          updatedCount++;
        }
      }
    }

    console.log(`\nУспешно очищено и обновлено товаров в базе данных Supabase: ${updatedCount}`);
  } catch (err) {
    console.error("Произошла критическая ошибка:", err);
  }
}

run();
