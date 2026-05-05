-- Talaria: таблица товаров
CREATE TABLE products (
  id                      SERIAL PRIMARY KEY,
  telegram_message_id     BIGINT UNIQUE,
  telegram_media_group_id TEXT,
  title                   TEXT,
  sizes                   TEXT,
  description             TEXT,
  price                   TEXT,
  photos                  TEXT[] DEFAULT '{}',
  is_available            BOOLEAN DEFAULT true,
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для быстрой выборки
CREATE INDEX idx_products_available ON products(is_available);
CREATE INDEX idx_products_media_group ON products(telegram_media_group_id);
CREATE INDEX idx_products_created ON products(created_at DESC);

-- Разрешить публичное чтение (анонимный ключ сайта)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON products
  FOR SELECT USING (is_available = true);

-- Только сервисный ключ бота может писать
CREATE POLICY "Service write" ON products
  FOR ALL USING (auth.role() = 'service_role');

-- Бакет для фотографий товаров
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT DO NOTHING;

-- Публичный доступ к фото
CREATE POLICY "Public photo read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-photos');

CREATE POLICY "Service photo write" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-photos' AND auth.role() = 'service_role');
