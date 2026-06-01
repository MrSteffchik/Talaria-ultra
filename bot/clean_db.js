const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach((line) => {
  const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
});

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Ошибка: не удалось прочитать SUPABASE_URL или SUPABASE_SERVICE_KEY из .env');
  process.exit(1);
}

function cleanEmoji(text) {
  if (!text) return '';
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\u2000-\u3300\u2600-\u27BF]/g, '')
    .trim();
}

function cleanTextFully(text) {
  const clean = cleanEmoji(text);
  return clean.replace(/^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s•:.,*#]+/, '').trim();
}

function extractSizeNumbers(text) {
  if (!text) return [];
  const stripped = cleanEmoji(text).replace(/[^\d,\s\-.]/g, '');
  const found = stripped.match(/\b(3[4-9]|4[0-9]|5[0-2])\b/g) || [];
  return [...new Set(found)].sort();
}

function cleanSizes(sizesStr) {
  const found = extractSizeNumbers(sizesStr || '');
  return found.length ? found.join(', ') : '';
}

function priceAmount(text) {
  const digits = (text || '').replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function fixPriceDisplay(priceStr) {
  if (!priceStr) return '';
  const clean = cleanEmoji(priceStr).trim();
  const m = clean.match(/(.*?)\s*\((?:было|было:)\s*(.*?)\)\s*$/i);
  if (!m) return clean;
  let current = m[1].trim().replace(/^(?:цена\s*(?:со\s*скидкой)?\s*:?\s*)/i, '').replace(/^:\s*/, '').trim();
  let old = m[2].trim().replace(/^(?:цена\s*(?:со\s*скидкой)?\s*:?\s*)/i, '').replace(/^:\s*/, '').trim();
  if (priceAmount(current) > priceAmount(old) && priceAmount(old) > 0) {
    [current, old] = [old, current];
  }
  return `${current} (было: ${old})`;
}

function getFallbackTitle(desc) {
  const text = (desc || '').toLowerCase();
  if (text.includes('кроссовк') || text.includes('кед')) return 'Стильные кроссовки';
  if (text.includes('туфли') || text.includes('каблук')) return 'Элегантные туфли';
  if (text.includes('босонож') || text.includes('сандал')) return 'Премиальные босоножки';
  if (text.includes('сабо') || text.includes('слипон')) return 'Удобные сабо';
  return 'Женская обувь Talaria';
}

function cleanDescription(desc) {
  if (!desc) return '';
  return desc
    .split('\n')
    .map((line) => cleanTextFully(line))
    .filter((line) => line.length > 0)
    .join('\n');
}

const COLOR_PARSE = [
  [/\b(белый|белая|белые|бел)\b/i, 'Белый'],
  [/\b(чёрн|черн|black)\b/i, 'Чёрный'],
  [/\b(бежев|беж)\b/i, 'Бежевый'],
  [/\b(коричнев)\b/i, 'Коричневый'],
  [/\b(серый|серая)\b/i, 'Серый'],
];

function parseColor(text) {
  if (!text) return '';
  for (const [re, label] of COLOR_PARSE) {
    if (re.test(text)) return label;
  }
  return '';
}

function makeVariantKey(title, price) {
  const t = cleanTextFully(title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${t}|${priceAmount(price)}`;
}

function isSizeOnlyTitle(title) {
  if (!title) return false;
  const nums = extractSizeNumbers(title);
  if (!nums.length) return false;
  return /^[\d\s,.\-]+$/.test(title.replace(/\s/g, ''));
}

async function patchProduct(id, headers, payload) {
  let res = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
  if (!res.ok && (payload.color !== undefined || payload.variant_key !== undefined)) {
    const { color, variant_key, ...rest } = payload;
    res = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rest),
    });
  }
  return res;
}

async function run() {
  console.log('Получаем список всех товаров...');
  if (DRY_RUN) console.log('Режим dry-run: в БД ничего не записываем.\n');

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };

  const probe = await fetch(`${SUPABASE_URL}/rest/v1/products?select=color,variant_key&limit=1`, { headers });
  const hasVariantColumns = probe.ok;
  if (!hasVariantColumns) {
    console.warn(
      '\n⚠️  Колонки color / variant_key ещё нет. Выполните в Supabase SQL:\n' +
        '    supabase/migration_color_variants.sql\n' +
        '    Затем снова: node clean_db.js\n'
    );
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, { headers });
  if (!res.ok) {
    throw new Error(`Ошибка загрузки: ${res.statusText} (${res.status})`);
  }

  const products = await res.json();
  console.log(`Найдено товаров: ${products.length}`);

  let updatedCount = 0;

  for (const p of products) {
    const id = p.id;
    const originalTitle = p.title || '';
    const originalDesc = p.description || '';
    const originalSizes = p.sizes || '';
    const originalPrice = p.price || '';

    let cleanedTitle = cleanTextFully(originalTitle);
    let cleanedDesc = cleanDescription(originalDesc);
    let cleanedSizes = cleanSizes(originalSizes);

    if (!cleanedSizes && originalDesc) {
      const found = extractSizeNumbers(originalDesc);
      if (found.length) cleanedSizes = found.join(', ');
    }

    if (isSizeOnlyTitle(cleanedTitle)) {
      if (!cleanedSizes) cleanedSizes = extractSizeNumbers(cleanedTitle).join(', ');
      cleanedTitle = getFallbackTitle(cleanedDesc);
    }

    if (cleanedTitle.length < 2) {
      cleanedTitle = getFallbackTitle(cleanedDesc);
    }

    const cleanedPrice = fixPriceDisplay(originalPrice);
    const blob = `${originalTitle} ${originalDesc}`;
    const productColor = parseColor(blob) || p.color || null;
    const variantKey = makeVariantKey(cleanedTitle, cleanedPrice);

    if (
      cleanedTitle !== originalTitle ||
      cleanedDesc !== originalDesc ||
      cleanedSizes !== originalSizes ||
      cleanedPrice !== originalPrice ||
      productColor !== (p.color || null) ||
      variantKey !== (p.variant_key || null)
    ) {
      console.log(`Обновляем товар #${id}:`);
      console.log(`  Было:  Title: "${originalTitle}" | Sizes: "${originalSizes}" | Price: "${originalPrice}"`);
      console.log(`  Стало: Title: "${cleanedTitle}" | Sizes: "${cleanedSizes}" | Price: "${cleanedPrice}"`);

      if (!DRY_RUN) {
        const payload = {
          title: cleanedTitle,
          description: cleanedDesc || null,
          sizes: cleanedSizes || null,
          price: cleanedPrice,
        };
        if (hasVariantColumns) {
          payload.color = productColor || null;
          payload.variant_key = variantKey;
        }
        const updateRes = await patchProduct(id, headers, payload);
        if (!updateRes.ok) {
          console.error(`Ошибка при обновлении #${id}:`, updateRes.statusText);
          continue;
        }
      }
      updatedCount++;
    }
  }

  const action = DRY_RUN ? 'будет обновлено' : 'обновлено';
  console.log(`\nГотово! ${action} товаров: ${updatedCount}`);
}

run().catch((err) => {
  console.error('Произошла критическая ошибка:', err);
  process.exit(1);
});
