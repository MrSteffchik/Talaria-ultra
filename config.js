// Конфигурация API для Talaria
const CONFIG = {
    // ── Supabase ────────────────────────────────────────────────────────────
    SUPABASE_URL: 'https://yzhmgbjjbvcdhpjsnjla.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6aG1nYmpqYnZjZGhwanNuamxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTA5MTcsImV4cCI6MjA5MzU2NjkxN30.1QhYCGMVDWAs7l7TpFYPcAAzDl63GsU-V2oVudl4XD0',

    // Настройки для API запросов
    API_SETTINGS: {
        timeout: 10000, // 10 секунд
        retries: 3,
        headers: {
            'Content-Type': 'application/json'
        }
    },

    // Настройки для изображений
    IMAGE_SETTINGS: {
        defaultFormat: 'medium', // thumbnail, small, medium, large
        fallbackText: 'Изображение товара',
        loadingPlaceholder: '/uploads/loading-placeholder.jpg'
    },

    // Настройки интерфейса
    UI_SETTINGS: {
        loadingText: 'Загрузка товаров...',
        noProductsText: 'Товары временно отсутствуют',
        errorText: 'Произошла ошибка при загрузке товаров',
        retryButtonText: 'Попробовать снова'
    },

    // Настройки для SEO и метаданных
    SEO_SETTINGS: {
        defaultDescription: 'Стильная и удобная обувь',
        brandName: 'Talaria'
    }
};

// Экспортируем конфигурацию для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
