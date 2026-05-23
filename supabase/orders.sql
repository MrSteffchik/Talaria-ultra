-- Talaria: таблица заказов (orders)
CREATE TABLE IF NOT EXISTS orders (
  id              SERIAL PRIMARY KEY,
  customer_name   TEXT NOT NULL,
  phone           TEXT NOT NULL,
  address         TEXT,
  delivery_type   TEXT NOT NULL, -- 'pickup' или 'delivery'
  payment_method  TEXT NOT NULL, -- 'cash', 'click' или 'payme'
  items           JSONB NOT NULL, -- массив товаров с размерами, ценами и фото
  total_price     BIGINT NOT NULL,
  status          TEXT DEFAULT 'pending', -- 'pending' (ожидает оплаты/подтверждения), 'paid' (оплачен), 'completed' (выполнен)
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для быстрой выборки заказов
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- Включение Row Level Security (RLS)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Политика: любой публичный пользователь (сайт) может вставить заказ
CREATE POLICY "Public insert orders" ON orders
  FOR INSERT WITH CHECK (true);

-- Политика: только администратор (сервисная роль бота) может читать и управлять заказами
CREATE POLICY "Service manage orders" ON orders
  FOR ALL USING (auth.role() = 'service_role');
