// Конфигурация API для Talaria
const CONFIG = {
    // URL Strapi сервера
    STRAPI_BASE_URL: 'http://localhost:1337',

    // API токен для авторизации
    // В продакшене этот токен должен храниться в переменных окружения
    API_TOKEN: '26f6c9bed0cceb2a588e3a4661374dc08180f5a7fe9ece066e2119cf9e737127bcf4dae8c2ee7653982c18ca540adfc9d4fe7eabe41ec98c19ad99eaf2074d2eea0a162b87aadee635f878009d3d4b428eea1a1b8f541bdc7389466e46b43b5b16dc4382c3afeb9c74aa0d82674ce6257ae0fffa092655aae27fbb9ac7bf740f',

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
