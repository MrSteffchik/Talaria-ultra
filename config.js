// Конфигурация API для Talaria
const CONFIG = {
    // ── Supabase ────────────────────────────────────────────────────────────
    SUPABASE_URL: 'https://yzhmgbjjbvcdhpjsnjla.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6aG1nYmpqYnZjZGhwanNuamxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTA5MTcsImV4cCI6MjA5MzU2NjkxN30.1QhYCGMVDWAs7l7TpFYPcAAzDl63GsU-V2oVudl4XD0',

    // Реквизиты для оплаты (Click / Payme)
    PAYMENT_CARD: '8600000000000000', // Номер Uzcard/Humo карты для оплаты
    CARD_HOLDER: 'ИМЯ ВЛАДЕЛЬЦА КАРТЫ', // Имя получателя перевода

    // Настройки интерфейса
    UI_SETTINGS: {
        loadingText: 'Загрузка товаров...',
        noProductsText: 'Товары временно отсутствуют',
        errorText: 'Произошла ошибка при загрузке товаров',
        retryButtonText: 'Попробовать снова'
    },

    SEO_SETTINGS: {
        defaultDescription: 'Стильная и удобная обувь',
        brandName: 'Talaria'
    }
};
