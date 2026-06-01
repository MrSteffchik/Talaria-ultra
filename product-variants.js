// Группировка дублей и выбор цвета (Talaria)
const COLOR_HEX = {
  'Белый': '#f4f4f0',
  'Чёрный': '#1a1a1a',
  'Бежевый': '#c4a882',
  'Коричневый': '#6b4423',
  'Серый': '#9ca3af',
  'Красный': '#b91c1c',
  'Розовый': '#f9a8d4',
  'Синий': '#3b82f6',
  'Зелёный': '#15803d',
  'Золотой': '#d4af37',
  'Серебряный': '#c0c0c0',
};

const COLOR_PARSE = [
  [/\b(белый|белая|белые|бел)\b/i, 'Белый'],
  [/\b(чёрн|черн|black)\b/i, 'Чёрный'],
  [/\b(бежев|беж)\b/i, 'Бежевый'],
  [/\b(коричнев)\b/i, 'Коричневый'],
  [/\b(серый|серая|серые)\b/i, 'Серый'],
  [/\b(красн)\b/i, 'Красный'],
  [/\b(розов)\b/i, 'Розовый'],
  [/\b(синий|синяя|голуб)\b/i, 'Синий'],
  [/\b(зелен|зелён)\b/i, 'Зелёный'],
  [/\b(золот)\b/i, 'Золотой'],
  [/\b(серебр)\b/i, 'Серебряный'],
];

function priceAmountKey(priceStr) {
  const n = parseInt(String(priceStr || '').replace(/\D/g, ''), 10);
  return n || 0;
}

function parseColorFromText(text) {
  if (!text) return '';
  for (const [re, label] of COLOR_PARSE) {
    if (re.test(text)) return label;
  }
  return '';
}

function getProductColor(p) {
  if (p.color) return p.color;
  const blob = `${p.title || ''} ${p.description || ''}`;
  return parseColorFromText(blob);
}

function getVariantKey(p) {
  if (p.variant_key) return p.variant_key;
  const title = typeof cleanTitle === 'function'
    ? cleanTitle(p.title, p.description).toLowerCase()
    : String(p.title || '').toLowerCase();
  return `${title}|${priceAmountKey(p.price)}`;
}

/** Убирает точные дубли, группирует варианты по variant_key */
function groupCatalogProducts(products) {
  const byKey = new Map();

  for (const p of products) {
    const vk = getVariantKey(p);
    if (!byKey.has(vk)) byKey.set(vk, []);
    byKey.get(vk).push({ ...p, _color: getProductColor(p) });
  }

  const groups = [];
  for (const variants of byKey.values()) {
    const deduped = new Map();
    for (const v of variants) {
      const sizesKey = typeof cleanSizes === 'function' ? cleanSizes(v.sizes || '') : (v.sizes || '');
      const dk = `${v._color || '_'}|${sizesKey}`;
      const prev = deduped.get(dk);
      if (!prev) {
        deduped.set(dk, v);
        continue;
      }
      const prevPhotos = (prev.photos && prev.photos.length) || 0;
      const newPhotos = (v.photos && v.photos.length) || 0;
      if (newPhotos > prevPhotos || v.id > prev.id) deduped.set(dk, v);
    }
    const list = Array.from(deduped.values()).sort((a, b) => a.id - b.id);
    const primary = list[0];
    groups.push({ primary, variants: list });
  }

  groups.sort((a, b) => (b.primary.id || 0) - (a.primary.id || 0));
  return groups;
}

function mergeSizesForGroup(variants) {
  const all = new Set();
  for (const v of variants) {
    const s = typeof cleanSizes === 'function' ? cleanSizes(v.sizes || '') : (v.sizes || '');
    if (s) s.split(/,\s*/).forEach((x) => { if (x) all.add(x.trim()); });
  }
  return [...all].sort((a, b) => Number(a) - Number(b)).join(', ');
}

function colorSwatchHTML(color, active, onclickAttr) {
  const hex = COLOR_HEX[color] || '#e5dcd3';
  const border = active ? 'border-[#1A1A1A] ring-2 ring-[#D4AF37]' : 'border-[#E5DCD3]';
  const label = color ? `title="${color}"` : '';
  return `<button type="button" ${onclickAttr} class="color-chip w-8 h-8 rounded-full border-2 ${border} shrink-0" style="background:${hex}" ${label} aria-label="${color || 'цвет'}"></button>`;
}

/** Варианты одной модели (работает и без колонок color/variant_key в БД) */
async function loadVariantsForProduct(sb, current) {
  const vk = getVariantKey(current);
  if (!sb || !current) return [current];

  if (current.variant_key) {
    const { data: siblings, error } = await sb
      .from('products')
      .select('*')
      .eq('variant_key', current.variant_key)
      .eq('is_available', true);
    if (!error && siblings && siblings.length > 1) {
      const g = groupCatalogProducts(siblings);
      return g[0] ? g[0].variants : siblings;
    }
  }

  let all = null;
  let err = null;
  ({ data: all, error: err } = await sb
    .from('products')
    .select('id, title, sizes, price, photos, description, color, variant_key')
    .eq('is_available', true));
  if (err && (err.code === '42703' || String(err.message || '').includes('color'))) {
    ({ data: all, error: err } = await sb
      .from('products')
      .select('id, title, sizes, price, photos, description')
      .eq('is_available', true));
  }
  if (err || !all) return [current];

  const matches = all.filter((p) => getVariantKey(p) === vk);
  if (matches.length <= 1) return [current];
  const g = groupCatalogProducts(matches);
  return g[0] ? g[0].variants : matches;
}

function colorDotsHTML(variants, max) {
  const colors = [];
  for (const v of variants) {
    const c = v._color || getProductColor(v);
    if (c && !colors.includes(c)) colors.push(c);
  }
  if (colors.length < 2) return '';
  const show = colors.slice(0, max || 4);
  return `<div class="flex gap-1 mt-1">${show.map((c) => {
    const hex = COLOR_HEX[c] || '#e5dcd3';
    return `<span class="w-3 h-3 rounded-full border border-[#E5DCD3]" style="background:${hex}" title="${c}"></span>`;
  }).join('')}${colors.length > show.length ? `<span class="text-[9px] text-[#8C847A]">+${colors.length - show.length}</span>` : ''}</div>`;
}
