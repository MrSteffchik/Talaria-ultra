-- Цвет и группа вариантов (одна карточка в каталоге — несколько цветов)
ALTER TABLE products ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_key TEXT;

CREATE INDEX IF NOT EXISTS idx_products_variant_key ON products(variant_key);
