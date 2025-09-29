// Импорт конфигурации (если доступна)
const config =
  typeof CONFIG !== "undefined"
    ? CONFIG
    : {
        STRAPI_BASE_URL: "http://localhost:1337",
        API_TOKEN:
          "4d517983794bd6eeaf62f96682ff0003038308f3c0f22d00f5a184d0bcb69d31c41baa4c3efdc6f3321e9d5f1bac524fd0c887c257207b570f2df9e60972d9d50229a85ab541359f4b5135fd873ce73f6dace07fe0655c8b385fdbcb33218e3fb144f63cf0e1c95cbe36e5d5c4eb8ebb2d7d4aed2987d2e74d035887d58a14a8",
        API_SETTINGS: { timeout: 10000, retries: 3 },
        IMAGE_SETTINGS: {
          defaultFormat: "medium",
          fallbackText: "Изображение товара",
        },
        UI_SETTINGS: {
          loadingText: "Загрузка коллекции...",
          noProductsText: "Коллекция временно недоступна",
          errorText: "Не удалось загрузить коллекцию",
        },
      };

// Класс для работы с API Strapi
class StrapiAPI {
  constructor() {
    this.baseURL = config.STRAPI_BASE_URL;
    this.token = config.API_TOKEN;
    this.retries = config.API_SETTINGS?.retries || 3;
    this.timeout = config.API_SETTINGS?.timeout || 10000;
  }

  // Базовый метод для выполнения запросов с повторными попытками
  async makeRequest(url, options = {}) {
    const requestOptions = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    };

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...requestOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.warn(
          `Попытка ${attempt}/${this.retries} не удалась:`,
          error.message,
        );

        if (attempt === this.retries) {
          throw new Error(
            `Не удалось загрузить данные после ${this.retries} попыток: ${error.message}`,
          );
        }

        // Задержка перед следующей попыткой
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Получение всех товаров обуви
  async fetchShoes(params = {}) {
    const searchParams = new URLSearchParams({
      populate: "*",
      ...params,
    });

    const url = `${this.baseURL}/api/shoes?${searchParams}`;
    const data = await this.makeRequest(url);
    return data.data || [];
  }

  // Получение конкретного товара по ID
  async fetchShoe(id) {
    const url = `${this.baseURL}/api/shoes/${id}?populate=*`;
    const data = await this.makeRequest(url);
    return data.data;
  }
}

// Создание экземпляра API
const strapiAPI = new StrapiAPI();

// Утилиты для работы с изображениями
class ImageUtils {
  static getImageUrl(photo, format = "medium") {
    if (!photo || !Array.isArray(photo) || photo.length === 0) {
      return null;
    }

    const image = photo[0];
    const imageFormat = image.formats?.[format];
    const imageUrl = imageFormat?.url || image.url;

    return imageUrl ? `${config.STRAPI_BASE_URL}${imageUrl}` : null;
  }

  static createImageElement(src, alt, className = "shoe-image") {
    if (!src) {
      return `<div class="image-fallback">👠</div>`;
    }

    return `<img src="${src}" alt="${alt}" class="${className}" loading="lazy"
                     onerror="this.style.display='none'; this.nextElementSibling?.style.display='flex';">
                <div class="image-fallback" style="display:none;">👠</div>`;
  }
}

// Утилиты для определения брендов и характеристик
class ProductUtils {
  static getBrand(name) {
    const brands = {
      ZAZA: { name: "ZAZA", icon: "👑" },
      евромода: { name: "Евромода", icon: "✨" },
      робин: { name: "Робин", icon: "🌟" },
      марис: { name: "Мисс Марис", icon: "💎" },
      vacs: { name: "VACS", icon: "🔥" },
    };

    const lowerName = name.toLowerCase();
    for (const [key, brand] of Object.entries(brands)) {
      if (lowerName.includes(key.toLowerCase())) {
        return brand;
      }
    }

    return { name: "Premium", icon: "⭐" };
  }

  static getFeatures(name) {
    const features = [];
    const lowerName = name.toLowerCase();

    if (lowerName.includes("босоножки") || lowerName.includes("сандали")) {
      features.push("Летняя");
    }
    if (lowerName.includes("туфли")) {
      features.push("Классика");
    }
    if (lowerName.includes("сапоги") || lowerName.includes("ботинки")) {
      features.push("Зимняя");
    }
    if (lowerName.includes("кроссовки")) {
      features.push("Спорт");
    }

    // Добавляем общие характеристики
    features.push("Комфорт");
    features.push("Качество");

    return features;
  }

  static generatePrice() {
    // Генерируем случайную цену для демонстрации
    const basePrice = Math.floor(Math.random() * 500000) + 200000; // 200k - 700k сум
    const hasDiscount = Math.random() > 0.7; // 30% шанс скидки

    if (hasDiscount) {
      const discount = Math.floor(Math.random() * 30) + 10; // 10-40% скидка
      const discountPrice = Math.floor((basePrice * (100 - discount)) / 100);
      return {
        current: discountPrice,
        old: basePrice,
        discount: discount,
      };
    }

    return {
      current: basePrice,
      old: null,
      discount: null,
    };
  }

  static formatPrice(price) {
    return new Intl.NumberFormat("uz-UZ", {
      style: "decimal",
      minimumFractionDigits: 0,
    }).format(price);
  }

  static isTopSale() {
    return Math.random() > 0.8; // 20% шанс быть топ продажей
  }
}

// Компонент карточки товара
class ShoeCard {
  static create(shoe) {
    const imageUrl = ImageUtils.getImageUrl(
      shoe.photo,
      config.IMAGE_SETTINGS?.defaultFormat,
    );
    const imageElement = ImageUtils.createImageElement(imageUrl, shoe.name);
    const brand = ProductUtils.getBrand(shoe.name);
    const features = ProductUtils.getFeatures(shoe.name);
    const price = ProductUtils.generatePrice();
    const isTopSale = ProductUtils.isTopSale();
    const isNew =
      new Date(shoe.createdAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Новинка если создана менее недели назад

    return `
      <article class="shoe-card" data-shoe-id="${shoe.documentId}" onclick="goToShoeDetails('${shoe.documentId}')">
        <div class="shoe-image-container">
          ${imageElement}
          ${isTopSale ? '<div class="product-badge">Топ продаж</div>' : ""}
          ${isNew ? '<div class="product-badge" style="left: auto; right: 60px;">Новинка</div>' : ""}
          <button class="favorite-btn" onclick="event.stopPropagation(); toggleFavorite(this)">❤️</button>
        </div>

        <div class="shoe-info">
          <div class="shoe-brand">${brand.icon} ${brand.name}</div>
          <h3 class="shoe-name">${this.escapeHtml(shoe.name)}</h3>
          <p class="shoe-description">Премиальная обувь из натуральных материалов. Комфортная подошва и стильный дизайн.</p>

          <div class="shoe-features">
            ${features.map((feature) => `<span class="feature-tag">${feature}</span>`).join("")}
          </div>

          <div class="shoe-price">
            <span class="price-current">${ProductUtils.formatPrice(price.current)} сум</span>
            ${price.old ? `<span class="price-old">${ProductUtils.formatPrice(price.old)} сум</span>` : ""}
            ${price.discount ? `<span class="price-discount">-${price.discount}%</span>` : ""}
          </div>

          <div class="shoe-actions">
            <button class="btn-details" onclick="event.stopPropagation(); goToShoeDetails('${shoe.documentId}')">
              👁️ Подробнее
            </button>
            <button class="btn-cart" onclick="event.stopPropagation(); addToCart('${shoe.documentId}')">
              🛒 В корзину
            </button>
          </div>
        </div>
      </article>
    `;
  }

  static escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  static formatDate(dateString) {
    try {
      return new Date(dateString).toLocaleDateString("ru-RU");
    } catch {
      return "Недавно";
    }
  }
}

// Менеджер для управления отображением товаров
class ShoesManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.shoes = [];
    this.isLoading = false;
    this.favorites = JSON.parse(
      localStorage.getItem("talaria_favorites") || "[]",
    );
    this.cart = JSON.parse(localStorage.getItem("talaria_cart") || "[]");
  }

  showLoading() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="loading">${config.UI_SETTINGS?.loadingText}</div>`;
  }

  showError(message) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="error">
        <p>${message}</p>
        <button class="retry-btn" onclick="shoesManager.loadShoes()">
          🔄 Попробовать снова
        </button>
      </div>
    `;
  }

  showNoProducts() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="no-products">
      <p>${config.UI_SETTINGS?.noProductsText}</p>
      <p>Скоро здесь появятся новые модели!</p>
    </div>`;
  }

  async loadShoes(params = {}) {
    if (this.isLoading) return;

    try {
      this.isLoading = true;
      this.showLoading();

      this.shoes = await strapiAPI.fetchShoes(params);

      // Сортируем: сначала топ продажи, потом новинки, потом остальные
      this.shoes.sort((a, b) => {
        const aIsNew =
          new Date(a.createdAt) >
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const bIsNew =
          new Date(b.createdAt) >
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        if (aIsNew && !bIsNew) return -1;
        if (!aIsNew && bIsNew) return 1;
        return 0;
      });

      this.renderShoes();
    } catch (error) {
      console.error("Ошибка при загрузке товаров:", error);
      this.showError(error.message || config.UI_SETTINGS?.errorText);
    } finally {
      this.isLoading = false;
    }
  }

  renderShoes() {
    if (!this.container) return;

    if (this.shoes.length === 0) {
      this.showNoProducts();
      return;
    }

    const shoesHTML = this.shoes.map((shoe) => ShoeCard.create(shoe)).join("");
    this.container.innerHTML = shoesHTML;

    // Добавляем анимацию появления
    this.animateCards();

    // Обновляем избранные товары
    this.updateFavoriteButtons();
  }

  animateCards() {
    const cards = this.container.querySelectorAll(".shoe-card");
    cards.forEach((card, index) => {
      card.style.opacity = "0";
      card.style.transform = "translateY(30px)";

      setTimeout(() => {
        card.style.transition =
          "opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1), transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      }, index * 150);
    });
  }

  updateFavoriteButtons() {
    const favoriteButtons = this.container.querySelectorAll(".favorite-btn");
    favoriteButtons.forEach((button) => {
      const card = button.closest(".shoe-card");
      const shoeId = card.dataset.shoeId;
      if (this.favorites.includes(shoeId)) {
        button.innerHTML = "💖";
        button.classList.add("active");
      }
    });
  }

  // Поиск товаров
  searchShoes(query) {
    const filteredShoes = this.shoes.filter((shoe) =>
      shoe.name.toLowerCase().includes(query.toLowerCase()),
    );

    if (filteredShoes.length === 0) {
      this.showNoProducts();
      return;
    }

    const shoesHTML = filteredShoes
      .map((shoe) => ShoeCard.create(shoe))
      .join("");
    this.container.innerHTML = shoesHTML;
    this.animateCards();
    this.updateFavoriteButtons();
  }

  // Управление избранным
  toggleFavorite(shoeId) {
    const index = this.favorites.indexOf(shoeId);
    if (index > -1) {
      this.favorites.splice(index, 1);
    } else {
      this.favorites.push(shoeId);
    }
    localStorage.setItem("talaria_favorites", JSON.stringify(this.favorites));
    this.updateFavoriteButtons();
  }

  // Управление корзиной
  addToCart(shoeId) {
    if (!this.cart.includes(shoeId)) {
      this.cart.push(shoeId);
      localStorage.setItem("talaria_cart", JSON.stringify(this.cart));
      this.showNotification("Товар добавлен в корзину! 🛒");
    } else {
      this.showNotification("Товар уже в корзине! ✅");
    }
  }

  // Показать уведомление
  showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.innerHTML = `
      <div class="notification-content">
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      right: 20px;
      background: var(--gradient-gold);
      color: white;
      padding: 15px 20px;
      border-radius: 10px;
      box-shadow: var(--shadow-heavy);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Автоматически скрыть через 3 секунды
    setTimeout(() => {
      if (notification.parentElement) {
        notification.style.animation = "slideOut 0.3s ease";
        setTimeout(() => notification.remove(), 300);
      }
    }, 3000);
  }
}

// Глобальные функции
let shoesManager;

// Переход на страницу товара
function goToShoeDetails(shoeId) {
  // Создаем URL для страницы товара
  const currentUrl = new URL(window.location);
  const detailsUrl = new URL(
    "product.html",
    currentUrl.origin + currentUrl.pathname.replace("index.html", ""),
  );
  detailsUrl.searchParams.set("id", shoeId);

  // Сохраняем данные товара в sessionStorage для быстрого доступа
  const shoe = shoesManager.shoes.find((s) => s.documentId === shoeId);
  if (shoe) {
    sessionStorage.setItem("current_shoe", JSON.stringify(shoe));
  }

  // Переходим на страницу товара
  window.location.href = detailsUrl.toString();
}

// Добавить в избранное
function toggleFavorite(button) {
  const card = button.closest(".shoe-card");
  const shoeId = card.dataset.shoeId;

  if (button.innerHTML === "❤️") {
    button.innerHTML = "💖";
    button.classList.add("active");
    shoesManager.favorites.push(shoeId);
  } else {
    button.innerHTML = "❤️";
    button.classList.remove("active");
    const index = shoesManager.favorites.indexOf(shoeId);
    if (index > -1) shoesManager.favorites.splice(index, 1);
  }

  localStorage.setItem(
    "talaria_favorites",
    JSON.stringify(shoesManager.favorites),
  );

  // Анимация
  button.style.transform = "scale(1.3)";
  setTimeout(() => (button.style.transform = "scale(1)"), 200);
}

// Добавить в корзину
function addToCart(shoeId) {
  shoesManager.addToCart(shoeId);
}

// Показать детали товара (модальное окно как запасной вариант)
async function showShoeDetails(shoeId) {
  try {
    const shoe = await strapiAPI.fetchShoe(shoeId);
    const brand = ProductUtils.getBrand(shoe.name);
    const price = ProductUtils.generatePrice();

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-content">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        <h2>${brand.icon} ${shoe.name}</h2>
        <p><strong>Бренд:</strong> ${brand.name}</p>
        <p><strong>Цена:</strong> ${ProductUtils.formatPrice(price.current)} сум</p>
        <p><strong>Добавлено:</strong> ${ShoeCard.formatDate(shoe.createdAt)}</p>
        <div style="margin-top: 20px;">
          <button class="btn-details" onclick="goToShoeDetails('${shoeId}')">
            Перейти на страницу товара
          </button>
        </div>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    document.body.appendChild(modal);

    // Закрытие по клику на фон
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  } catch (error) {
    alert("Не удалось загрузить детали товара");
  }
}

// Добавляем стили для анимаций уведомлений
const notificationStyles = document.createElement("style");
notificationStyles.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }

  .notification-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .notification-content button {
    background: none;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay .modal-content {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    max-width: 500px;
    margin: 20px;
    position: relative;
  }

  .modal-close {
    position: absolute;
    top: 10px;
    right: 15px;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #999;
  }

  .favorite-btn.active {
    background: var(--accent-color);
    color: white;
  }
`;
document.head.appendChild(notificationStyles);

// Инициализация при загрузке страницы
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 Инициализация Talaria API...");

  shoesManager = new ShoesManager("shoes-container");

  if (shoesManager.container) {
    shoesManager.loadShoes();
    console.log("✅ Менеджер товаров инициализирован");
    console.log(`❤️ Избранных товаров: ${shoesManager.favorites.length}`);
    console.log(`🛒 Товаров в корзине: ${shoesManager.cart.length}`);
  } else {
    console.warn("⚠️ Контейнер для товаров не найден");
  }

  // Обновляем счетчики в шапке (если есть)
  const favoriteBtn = document.querySelector(".action-btn:first-child");
  const cartBtn = document.querySelector(".action-btn.primary");

  if (favoriteBtn && shoesManager.favorites.length > 0) {
    favoriteBtn.innerHTML = `❤️ Избранное (${shoesManager.favorites.length})`;
  }

  if (cartBtn && shoesManager.cart.length > 0) {
    cartBtn.innerHTML = `🛒 Корзина (${shoesManager.cart.length})`;
  }
});

// Экспорт для возможного использования в других модулях
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    StrapiAPI,
    ShoesManager,
    ShoeCard,
    ImageUtils,
    ProductUtils,
  };
}
