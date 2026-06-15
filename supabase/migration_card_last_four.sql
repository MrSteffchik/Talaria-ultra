-- Добавление колонки card_last_four для хранения последних 4 цифр карты
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_last_four TEXT;

-- Комментарий для описания поля
COMMENT ON COLUMN orders.card_last_four IS 'Последние 4 цифры карты (для отображения в Telegram уведомлениях)';
