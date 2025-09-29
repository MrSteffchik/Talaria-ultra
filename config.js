// Конфигурация API для Talaria
const CONFIG = {
    // URL Strapi сервера
    STRAPI_BASE_URL: 'http://localhost:1337',

    // API токен для авторизации
    // В продакшене этот токен должен храниться в переменных окружения
    API_TOKEN: '4d517983794bd6eeaf62f96682ff0003038308f3c0f22d00f5a184d0bcb69d31c41baa4c3efdc6f3321e9d5f1bac524fd0c887c257207b570f2df9e60972d9d50229a85ab541359f4b5135fd873ce73f6dace07fe0655c8b385fdbcb33218e3fb144f63cf0e1c95cbe36e5d5c4eb8ebb2d7d4aed2987d2e74d035887d58a14a8',

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
