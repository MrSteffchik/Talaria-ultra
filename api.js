// api.js — минимальный современный вариант для Tailwind-фронта

const CONFIG = {
  STRAPI_BASE_URL: "http://localhost:1337", // ← замени при деплое
  API_TOKEN: "", // ← при необходимости вставь свой токен
};

// Класс API для Strapi
class StrapiAPI {
  constructor() {
    this.baseURL = CONFIG.STRAPI_BASE_URL;
    this.token = CONFIG.API_TOKEN;
  }

  async makeRequest(endpoint) {
    const url = `${this.baseURL}${endpoint}`;
    const res = await fetch(url, {
      headers: this.token
        ? { Authorization: `Bearer ${this.token}` }
        : undefined,
    });

    if (!res.ok) {
      throw new Error(`Ошибка ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }

  // Получить все товары
  async fetchShoes(params = {}) {
    const query = new URLSearchParams({ populate: "*", ...params }).toString();
    const data = await this.makeRequest(`/api/shoes?${query}`);
    return data?.data || [];
  }

  // Получить конкретный товар
  async fetchShoe(id) {
    const data = await this.makeRequest(`/api/shoes/${id}?populate=*`);
    return data?.data || null;
  }
}

// Экспорт (для browser и Node)
const strapiAPI = new StrapiAPI();
if (typeof window !== "undefined") window.strapiAPI = strapiAPI;
if (typeof module !== "undefined") module.exports = { strapiAPI, StrapiAPI };
