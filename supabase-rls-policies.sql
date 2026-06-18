-- ============================================================
-- RLS POLICIES для Supabase Talaria
-- ============================================================

-- ВКЛЮЧАЕМ Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- ПОЛИТИКА 1: Публичный READ (каталог)
-- Любой может читать товары
DROP POLICY IF EXISTS "public can view products" ON products;
CREATE POLICY "public can view products" ON products
  FOR SELECT
  USING (is_available = true);

-- ПОЛИТИКА 2: Публичный INSERT (бот добавляет товары)
-- Используем service_key для бота
DROP POLICY IF EXISTS "bot can insert products" ON products;
CREATE POLICY "bot can insert products" ON products
  FOR INSERT
  WITH CHECK (true);

-- ПОЛИТИКА 3: Публичный UPDATE (бот обновляет товары)
DROP POLICY IF EXISTS "bot can update products" ON products;
CREATE POLICY "bot can update products" ON products
  FOR UPDATE
  USING (true);

-- ПОЛИТИКА 4: Публичный DELETE (бот удаляет товары)
DROP POLICY IF EXISTS "bot can delete products" ON products;
CREATE POLICY "bot can delete products" ON products
  FOR DELETE
  USING (true);

-- ============================================================
-- RLS POLICIES для orders
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ПОЛИТИКА 1: Публичный INSERT (клиент создаёт заказ)
DROP POLICY IF EXISTS "public can create orders" ON orders;
CREATE POLICY "public can create orders" ON orders
  FOR INSERT
  WITH CHECK (true);

-- ПОЛИТИКА 2: Публичный READ (админы видят заказы)
DROP POLICY IF EXISTS "public can view orders" ON orders;
CREATE POLICY "public can view orders" ON orders
  FOR SELECT
  USING (true);

-- ПОЛИТИКА 3: Публичный UPDATE (админы меняют статус)
DROP POLICY IF EXISTS "public can update orders" ON orders;
CREATE POLICY "public can update orders" ON orders
  FOR UPDATE
  USING (true);

-- ПОЛИТИКА 4: Публичный DELETE (очистка истории)
DROP POLICY IF EXISTS "public can delete orders" ON orders;
CREATE POLICY "public can delete orders" ON orders
  FOR DELETE
  USING (true);
