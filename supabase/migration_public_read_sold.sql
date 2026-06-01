-- Выполните в Supabase SQL Editor один раз.
-- Нужно, чтобы по прямой ссылке на проданную модель показывалось «Нет в наличии»,
-- а в каталоге по-прежнему только is_available = true (фильтр на сайте).

DROP POLICY IF EXISTS "Public read" ON products;

CREATE POLICY "Public read" ON products
  FOR SELECT USING (true);
