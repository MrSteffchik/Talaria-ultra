// Модуль корзины и оформления заказов для Talaria
let cart = JSON.parse(localStorage.getItem('talaria_cart') || '[]');

function getDeliveryConfig() {
  const d = (typeof CONFIG !== 'undefined' && CONFIG.DELIVERY) ? CONFIG.DELIVERY : {};
  return {
    pickupAddress: d.pickupAddress || 'Ташкент, ул. Мирзо Улугбека, 99',
    pickupHours: d.pickupHours || 'Пн–Сб 9:00–20:00, Вс 10:00–18:00',
    pickupPhone: d.pickupPhone || '+998 90 825-73-37',
    courierPrice: d.courierPrice ?? 40000,
    courierTitle: d.courierTitle || 'Курьер по Ташкенту с примеркой',
    courierDescription: d.courierDescription || 'Привезём до 3 пар на выбор. Примерьте дома и оставьте подходящее.',
  };
}

function getDeliveryPrice() {
  return getDeliveryConfig().courierPrice;
}

// Совместимая очистка эмодзи (без \\p{}, чтобы cart.js работал в старых WebView)
function stripEmoji(text) {
  if (!text) return '';
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\u2000-\u3300\u2600-\u27BF]/g, '')
    .trim();
}

const LEADING_JUNK_RE = /^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s•:.,*#]+/;

// Умная очистка размеров (убирает сердечки, стрелочки и оставляет только числа)
function cleanSizes(sizesStr) {
  if (!sizesStr) return '';
  const stripped = stripEmoji(String(sizesStr)).replace(/[^\d,\s\-.]/g, '');
  const matches = stripped.match(/\b(3[4-9]|4[0-9]|5[0-2])\b/g);
  if (matches) {
    return [...new Set(matches)].sort().join(', ');
  }
  return '';
}

// Умная очистка названий (убирает эмодзи, мусор, цифры размеров)
function cleanTitle(titleStr, descStr) {
  if (!titleStr && !descStr) return 'Элегантная модель';

  const text = (descStr || '').toLowerCase();
  const titleText = (titleStr || '').toLowerCase();
  const combined = `${titleText} ${text}`;
  
  // === ШАГ 1: Определяем тип обуви ===
  let shoeType = '';
  
  // Приоритет описанию (там больше деталей)
  if (text.includes('кроссовк') || text.includes('кед') || text.includes('спортивн') || text.includes('на шнурк')) {
    shoeType = 'Кроссовки';
  } else if (text.includes('туфли') || text.includes('лодочк') || text.includes('на каблок') || text.includes('каблук')) {
    shoeType = 'Туфли';
  } else if (text.includes('босонож') || text.includes('сандал') || text.includes('открыт')) {
    shoeType = 'Босоножки';
  } else if (text.includes('сабо') || text.includes('слипон') || text.includes('без шнурк')) {
    shoeType = 'Сабо';
  } else if (text.includes('балетк')) {
    shoeType = 'Балетки';
  } else if (text.includes('мокасин')) {
    shoeType = 'Мокасины';
  } else if (text.includes('ботинок') || text.includes('ботильон') || text.includes('зимн') || text.includes('осен')) {
    shoeType = 'Ботинки';
  } else if (text.includes('полуботинок')) {
    shoeType = 'Полуботинки';
  } else if (text.includes('вьетнамк') || text.includes('шлёпанц') || text.includes('пляж')) {
    shoeType = 'Вьетнамки';
  } else if (text.includes('лофер')) {
    shoeType = 'Лоферы';
  }
  
  // Если не определили по описанию — смотрим title
  if (!shoeType) {
    if (titleText.includes('кроссовк') || titleText.includes('кед')) shoeType = 'Кроссовки';
    else if (titleText.includes('туфли') || titleText.includes('лодочк')) shoeType = 'Туфли';
    else if (titleText.includes('босонож') || titleText.includes('сандал')) shoeType = 'Босоножки';
    else if (titleText.includes('сабо') || titleText.includes('слипон')) shoeType = 'Сабо';
    else if (titleText.includes('балетк')) shoeType = 'Балетки';
    else if (titleText.includes('мокасин')) shoeType = 'Мокасины';
    else if (titleText.includes('ботинок')) shoeType = 'Ботинки';
  }
  
  // === ШАГ 2: Определяем цвет ===
  let color = '';
  
  if (combined.includes('бел') && !combined.includes('белоснеж') && !combined.includes('не бел')) color = 'белые';
  else if (combined.includes('чёрн') || combined.includes('черн') || combined.includes('black')) color = 'чёрные';
  else if (combined.includes('бежев') || combined.includes('нюд') || combined.includes('телесн')) color = 'бежевые';
  else if (combined.includes('коричнев') || combined.includes('шоколад')) color = 'коричневые';
  else if (combined.includes('сер') && !combined.includes('серебр')) color = 'серые';
  else if (combined.includes('серебр') || combined.includes('металл')) color = 'серебристые';
  else if (combined.includes('красн') || combined.includes('бордо') || combined.includes('винн')) color = 'красные';
  else if (combined.includes('розов')) color = 'розовые';
  else if (combined.includes('син') && !combined.includes('бирюз')) color = 'синие';
  else if (combined.includes('голуб') || combined.includes('бирюз')) color = 'голубые';
  else if (combined.includes('зелён') || combined.includes('зелен') || combined.includes('хаки') || combined.includes('оливк')) color = 'зелёные';
  else if (combined.includes('золот') || combined.includes('золотист')) color = 'золотистые';
  else if (combined.includes('леопард') || combined.includes('пятн')) color = 'леопардовые';
  else if (combined.includes('зебр') || combined.includes('полосат')) color = 'в полоску';
  else if (combined.includes('принт') || combined.includes('узор')) color = 'с принтом';
  else if (combined.includes('разноцвет') || combined.includes('мульти')) color = 'разноцветные';
  
  // === ШАГ 3: Формируем красивое название ===
  if (shoeType && color) return `${shoeType} ${color}`;
  if (shoeType) return shoeType;
  if (color) return `Туфли ${color}`;
  
  // === ШАГ 4: Если ничего не определили — чистим исходное название ===
  if (titleStr) {
    let clean = stripEmoji(titleStr);
    clean = clean.replace(LEADING_JUNK_RE, '').trim();
    clean = clean.replace(/\b(3[5-9]|4[0-6])\b/g, '').trim(); // убираем размеры
    clean = clean.replace(/[\s-]+/g, ' ').trim();
    
    // Проверяем на мусор
    const badTitles = ['размер в размер', 'женская обувь', 'обувь talaria', 'talaria', 'новый завоз', 'новинка', 'женская обувь talaria'];
    const cleanLower = clean.toLowerCase();
    
    if (clean.length >= 3 && !badTitles.some(bad => cleanLower.includes(bad))) {
      return clean;
    }
  }
  
  // Дефолтное название
  return shoeType || 'Женская обувь';
}

// Умная очистка описания от эмодзи и Telegram-реакций
function cleanDescription(descStr) {
  if (!descStr) return '';
  let lines = descStr.split('\n');
  let cleanedLines = lines.map(line => {
    let cleanLine = stripEmoji(line).replace(LEADING_JUNK_RE, '').trim();
    return cleanLine;
  }).filter(line => line.length > 0);
  
  return cleanedLines.join('\n');
}

// Форматирование цены на фронтенде с поддержкой зачеркнутой старой цены
function formatPriceHTML(priceStr) {
  if (!priceStr) return 'Цена по запросу';
  
  const raw = String(priceStr).trim();
  const hasDigits = /\d/.test(raw);
  if (!hasDigits) return 'Цена по запросу';
  
  // Ищем старую цену в скобках, например: "450 000 сум (было: 490 000 сум)"
  const match = raw.match(/(.*?)\s*\((?:было:\s*|было\s+)(.*?)\)\s*$/i);
  if (match) {
    let currentPrice = match[1].trim();
    let oldPrice = match[2].trim().replace(/^:\s*/, '');
    const priceAmount = (s) => parseInt((s.match(/\d+/g) || []).join(''), 10) || 0;
    if (priceAmount(currentPrice) === 0) return 'Цена по запросу';
    if (priceAmount(currentPrice) > priceAmount(oldPrice) && priceAmount(oldPrice) > 0) {
      [currentPrice, oldPrice] = [oldPrice, currentPrice];
    }
    return `${currentPrice} <span class="line-through text-xs font-light text-[#8C847A] ml-2 opacity-70">${oldPrice}</span>`;
  }
  return raw;
}

// Динамическое внедрение HTML корзины и модального окна в DOM
document.addEventListener("DOMContentLoaded", () => {
  // Внедрение оверлея
  const overlay = document.createElement("div");
  overlay.id = "cart-overlay";
  overlay.className = "fixed inset-0 bg-black/40 z-[90] backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-300";
  overlay.onclick = () => toggleCart(false);
  document.body.appendChild(overlay);

  // Внедрение выезжающей корзины
  const drawer = document.createElement("div");
  drawer.id = "cart-drawer";
  drawer.className = "fixed inset-y-0 right-0 w-full sm:w-[420px] bg-[#FAF6F0] shadow-2xl z-[100] transform translate-x-full transition-transform duration-300 ease-in-out border-l border-[#E5DCD3] flex flex-col justify-between";
  drawer.innerHTML = `
    <!-- Header -->
    <div class="px-6 py-5 border-b border-[#E5DCD3] flex items-center justify-between">
      <h3 class="text-sm font-bold tracking-[0.2em] uppercase text-[#1A1A1A]">ВАША КОРЗИНА</h3>
      <button onclick="toggleCart(false)" class="p-1 hover:text-[#D4AF37] transition">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>

    <!-- Вкладки: Корзина | Информация о заказе -->
    <div class="flex border-b border-[#E5DCD3] bg-white">
      <button type="button" id="checkout-tab-cart" onclick="switchCheckoutTab('cart')" class="flex-1 py-3 text-[10px] tracking-widest uppercase font-semibold border-b-2 border-[#1A1A1A] text-[#1A1A1A]">
        Корзина
      </button>
      <button type="button" id="checkout-tab-order" onclick="switchCheckoutTab('order')" class="flex-1 py-3 text-[10px] tracking-widest uppercase font-semibold border-b-2 border-transparent text-[#8C847A]">
        Информация о заказе
      </button>
    </div>

    <div class="flex-grow overflow-y-auto px-6 py-4" id="panel-cart">
      <div id="cart-items-container"></div>
    </div>

    <div class="hidden flex-grow overflow-y-auto px-6 py-4 space-y-4" id="panel-order">
      <div id="order-info-summary" class="bg-white border border-[#E5DCD3] p-3 space-y-2 text-xs"></div>

      <div>
        <p class="text-[10px] tracking-widest uppercase font-bold text-[#D4AF37] mb-2">Способ получения</p>
        <div class="grid grid-cols-1 gap-2">
          <button type="button" id="btn-delivery-pickup" onclick="selectDeliveryType('pickup')" class="delivery-option text-left p-3 border border-[#E5DCD3] bg-white hover:border-[#D4AF37] transition">
            <span class="block text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">Самовывоз из магазина</span>
            <span class="block text-[10px] text-[#8C847A] mt-1">Бесплатно</span>
          </button>
          <button type="button" id="btn-delivery-courier" onclick="selectDeliveryType('delivery')" class="delivery-option text-left p-3 border border-[#E5DCD3] bg-white hover:border-[#D4AF37] transition">
            <span class="block text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">Курьер по Ташкенту</span>
            <span id="courier-price-label" class="block text-[10px] text-[#8C847A] mt-1">С примеркой на дому</span>
          </button>
        </div>
      </div>

      <div id="delivery-info-panel" class="bg-[#EFE9DF]/50 border border-[#E5DCD3] p-3 text-[11px] text-[#5C544A] leading-relaxed"></div>

      <!-- Блок оплаты (показывается только для доставки) -->
      <div id="payment-section" class="space-y-3">
        <p class="text-[10px] tracking-widest uppercase font-bold text-[#D4AF37]">Способ оплаты</p>
        <select id="order-payment" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" onchange="toggleCardForm()">
          <option value="cash">Оплата наличными</option>
          <option value="click">Картой через CLICK</option>
          <option value="payme">Картой через PAYME</option>
        </select>

        <div id="card-form" class="hidden pt-2 border-t border-[#E5DCD3]">
          <p class="text-[10px] tracking-widest uppercase font-bold text-[#D4AF37] mb-2">Данные карты</p>
          <input type="text" id="order-card" placeholder="XXXX XXXX XXXX XXXX" maxlength="19" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none mb-2" inputmode="numeric" />
          <input type="text" id="order-cardholder" placeholder="ФИО держателя (как на карте)" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
          <p class="text-[8px] text-[#8C847A] mt-2">Данные карты используются только для проверки.</p>
        </div>
      </div>

      <div class="space-y-3">
        <p class="text-[10px] tracking-widest uppercase font-bold text-[#D4AF37]">Контактные данные</p>
        <input type="text" id="order-name" placeholder="Ваше имя" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        <input type="tel" id="order-phone" placeholder="Телефон (+998 XX XXX XX XX)" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        <input type="text" id="order-address" placeholder="Адрес доставки (район, улица, дом, подъезд)" class="hidden w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        <input type="text" id="order-comment" placeholder="Комментарий (время, домофон — по желанию)" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
      </div>

      <select id="order-delivery" class="hidden" aria-hidden="true">
        <option value="pickup">pickup</option>
        <option value="delivery">delivery</option>
      </select>
    </div>

    <div class="border-t border-[#E5DCD3] bg-white p-6 space-y-3">
      <div class="space-y-1.5 text-xs tracking-wider border-b border-[#FAF6F0] pb-3">
        <div class="flex justify-between text-[#8C847A]">
          <span>ТОВАРЫ:</span>
          <span id="cart-subtotal-price" class="font-semibold text-[#1A1A1A]">0 сум</span>
        </div>
        <div id="cart-delivery-row" class="hidden flex justify-between text-[#8C847A]">
          <span>ДОСТАВКА (с примеркой):</span>
          <span id="cart-delivery-price" class="font-semibold text-[#1A1A1A]">0 сум</span>
        </div>
        <div class="flex justify-between items-center font-semibold pt-1">
          <span class="text-[#8C847A] uppercase">ИТОГО К ОПЛАТЕ:</span>
          <span id="cart-total-price" class="text-sm font-bold text-[#1A1A1A]">0 сум</span>
        </div>
      </div>

      <button type="button" onclick="submitOrder()" id="btn-submit-order" class="hidden w-full bg-[#D4AF37] text-white py-3 text-xs tracking-[0.2em] uppercase font-semibold hover:bg-[#1A1A1A] transition">
        ПОДТВЕРДИТЬ ЗАКАЗ
      </button>
      <button type="button" onclick="showCheckoutForm()" id="btn-checkout-trigger" class="w-full bg-[#1A1A1A] text-white py-3.5 text-xs tracking-[0.2em] uppercase font-semibold hover:bg-[#D4AF37] transition">
        ИНФОРМАЦИЯ О ЗАКАЗЕ
      </button>
    </div>
  `;
  document.body.appendChild(drawer);

  // Внедрение модального окна оплаты
  const modal = document.createElement("div");
  modal.id = "payment-modal";
  modal.className = "hidden fixed inset-0 z-[120] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm";
  modal.innerHTML = `
    <div class="bg-[#FAF6F0] border border-[#E5DCD3] w-full max-w-md p-8 text-center shadow-2xl relative">
      <button onclick="closePaymentModal()" class="absolute top-4 right-4 text-[#8C847A] hover:text-[#1A1A1A]">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
      
      <div class="w-12 h-12 bg-[#D4AF37]/15 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg class="w-6 h-6 text-[#D4AF37]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path></svg>
      </div>
      
      <h3 class="text-lg font-serif-luxury font-bold mb-2">Заказ успешно оформлен!</h3>
      <p class="text-xs text-[#8C847A] uppercase tracking-wider mb-6">Номер заказа: #<span id="success-order-id">--</span></p>
      
      <div id="payment-details-card" class="bg-white border border-[#E5DCD3] p-5 mb-6 text-left space-y-3">
        <p class="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] border-b border-[#FAF6F0] pb-2">Инструкция к оплате:</p>
        <div class="text-xs text-[#5C544A] space-y-1 leading-relaxed">
          <p><strong>Получатель:</strong> <span id="payment-card-holder">ZEMFIRA KONTYUKOVA</span></p>
          <p><strong>Номер карты:</strong> <span id="payment-card-number" class="font-bold tracking-wider text-[#1A1A1A]">9860 1701 1472 9453</span></p>
          <p><strong>К оплате:</strong> <span id="success-total-price" class="font-bold text-red-600">0 сум</span></p>
        </div>
      </div>

      <div id="payment-important-note" class="bg-[#1A1A1A] text-[#FAF6F0] p-4 mb-6 border-2 border-[#D4AF37]">
        <p class="text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold mb-2">⚠️ ВАЖНО:</p>
        <p class="text-sm font-bold">ПОСЛЕ ОПЛАТЫ ПОЗВОНИТЕ:</p>
        <a href="tel:+998908257337" class="text-xl font-bold text-[#D4AF37] block mt-1">+998 90 825 73 37</a>
        <p class="text-[9px] text-[#8C847A] mt-2">Для подтверждения заказа менеджером</p>
      </div>
      
      <div class="space-y-2">
        <a id="btn-click-pay" href="#" target="_blank" class="hidden w-full bg-blue-500 hover:bg-blue-600 text-white text-xs tracking-wider uppercase font-semibold py-3 transition flex items-center justify-center gap-2">
          📲 ОПЛАТИТЬ ЧЕРЕЗ CLICK
        </a>
        <a id="btn-payme-pay" href="#" target="_blank" class="hidden w-full bg-teal-500 hover:bg-teal-600 text-white text-xs tracking-wider uppercase font-semibold py-3 transition flex items-center justify-center gap-2">
          📲 ОПЛАТИТЬ ЧЕРЕЗ PAYME
        </a>
        <button onclick="closePaymentModal()" class="w-full bg-[#1A1A1A] hover:bg-[#D4AF37] text-white text-xs tracking-wider uppercase font-semibold py-3 transition">
          ПОНЯТНО, СПАСИБО!
        </button>
      </div>
      
      <p class="text-[10px] text-[#8C847A] mt-4">Наш менеджер свяжется с вами в течение 15 минут для подтверждения заказа.</p>
    </div>
  `;
  document.body.appendChild(modal);

  const cfg = getDeliveryConfig();
  const priceLabel = document.getElementById('courier-price-label');
  if (priceLabel) {
    priceLabel.textContent = `+${formatSum(cfg.courierPrice)} · с примеркой на дому`;
  }
  const deliveryPriceEl = document.getElementById('cart-delivery-price');
  if (deliveryPriceEl) {
    deliveryPriceEl.textContent = formatSum(cfg.courierPrice);
  }

  updateCartBadge();
  selectDeliveryType('pickup');
});

// Функции управления корзиной
function toggleCart(open) {
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  if (drawer && overlay) {
    if (open) {
      renderCart();
      drawer.classList.remove('translate-x-full');
      overlay.classList.remove('opacity-0', 'pointer-events-none');
    } else {
      drawer.classList.add('translate-x-full');
      overlay.classList.add('opacity-0', 'pointer-events-none');
    }
  }
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (badge) {
    const count = cart.reduce((acc, item) => acc + item.quantity, 0);
    badge.textContent = count;
    if (count > 0) {
      badge.classList.remove('scale-0');
    } else {
      badge.classList.add('scale-0');
    }
  }
}

function formatSum(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " сум";
}

function renderCart() {
  const container = document.getElementById('cart-items-container');
  const subtotalEl = document.getElementById('cart-subtotal-price');
  const totalPriceEl = document.getElementById('cart-total-price');
  const deliveryRow = document.getElementById('cart-delivery-row');
  
  updateCartBadge();

  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-[#8C847A] text-center">
        <svg class="w-12 h-12 mb-3 stroke-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"></path></svg>
        <p class="text-xs uppercase tracking-widest font-semibold">Ваша корзина пуста</p>
      </div>`;
    subtotalEl.textContent = '0 сум';
    totalPriceEl.textContent = '0 сум';
    if(deliveryRow) deliveryRow.classList.add('hidden');
    document.getElementById('btn-checkout-trigger')?.classList.add('hidden');
    document.getElementById('btn-submit-order')?.classList.add('hidden');
    switchCheckoutTab('cart');
    return;
  }

  document.getElementById('btn-checkout-trigger')?.classList.remove('hidden');
  document.getElementById('btn-submit-order')?.classList.add('hidden');

  let itemsTotal = 0;
  container.innerHTML = cart.map((item, index) => {
    const numericPrice = parseInt(item.price.replace(/[^0-9]/g, '')) || 0;
    itemsTotal += numericPrice * item.quantity;

    return `
      <div class="flex items-center gap-4 py-4 border-b border-[#E5DCD3]/50">
        <img src="${item.photo}" class="w-16 h-16 object-cover border border-[#E5DCD3]" onerror="this.src='https://via.placeholder.com/300x300?text=Нет+фото'" />
        <div class="flex-grow space-y-1">
          <h4 class="text-xs font-bold uppercase tracking-wider text-[#1A1A1A] line-clamp-1">${cleanTitle(item.title)}</h4>
          <p class="text-[10px] text-[#8C847A]">Размер: <span class="font-bold text-[#1A1A1A]">${item.size}</span>${item.color ? ` · Цвет: <span class="font-bold text-[#1A1A1A]">${item.color}</span>` : ''}</p>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 border border-[#E5DCD3] px-2 py-0.5 bg-white">
              <button onclick="updateQty(${index}, -1)" class="text-xs font-bold hover:text-[#D4AF37] px-1">-</button>
              <span class="text-[11px] font-semibold">${item.quantity}</span>
              <button onclick="updateQty(${index}, 1)" class="text-xs font-bold hover:text-[#D4AF37] px-1">+</button>
            </div>
            <span class="text-xs font-bold text-[#D4AF37]">${item.price}</span>
          </div>
        </div>
        <button onclick="removeFromCart(${index})" class="text-[#8C847A] hover:text-red-500 transition p-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        </button>
      </div>`;
  }).join('');

  subtotalEl.textContent = formatSum(itemsTotal);
  
  // Расчет доставки
  const delivery = document.getElementById('order-delivery') ? document.getElementById('order-delivery').value : 'pickup';
  const deliveryFee = getDeliveryPrice();
  if (delivery === 'delivery') {
    if (deliveryRow) deliveryRow.classList.remove('hidden');
    const dp = document.getElementById('cart-delivery-price');
    if (dp) dp.textContent = formatSum(deliveryFee);
    totalPriceEl.textContent = formatSum(itemsTotal + deliveryFee);
  } else {
    if (deliveryRow) deliveryRow.classList.add('hidden');
    totalPriceEl.textContent = formatSum(itemsTotal);
  }

  if (document.getElementById('panel-order') && !document.getElementById('panel-order').classList.contains('hidden')) {
    renderOrderInfoSummary();
  }
}

function updateQty(index, change) {
  cart[index].quantity += change;
  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }
  localStorage.setItem('talaria_cart', JSON.stringify(cart));
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  localStorage.setItem('talaria_cart', JSON.stringify(cart));
  renderCart();
}

function switchCheckoutTab(tab) {
  const panelCart = document.getElementById('panel-cart');
  const panelOrder = document.getElementById('panel-order');
  const tabCart = document.getElementById('checkout-tab-cart');
  const tabOrder = document.getElementById('checkout-tab-order');
  const btnTrigger = document.getElementById('btn-checkout-trigger');
  const btnSubmit = document.getElementById('btn-submit-order');

  if (!panelCart || !panelOrder) return;

  if (tab === 'order') {
    if (cart.length === 0) return;
    panelCart.classList.add('hidden');
    panelOrder.classList.remove('hidden');
    tabCart.classList.remove('border-[#1A1A1A]', 'text-[#1A1A1A]');
    tabCart.classList.add('border-transparent', 'text-[#8C847A]');
    tabOrder.classList.add('border-[#1A1A1A]', 'text-[#1A1A1A]');
    tabOrder.classList.remove('border-transparent', 'text-[#8C847A]');
    if (btnTrigger) btnTrigger.classList.add('hidden');
    if (btnSubmit) btnSubmit.classList.remove('hidden');
    renderOrderInfoSummary();
    updateDeliveryUI();
  } else {
    panelCart.classList.remove('hidden');
    panelOrder.classList.add('hidden');
    tabOrder.classList.remove('border-[#1A1A1A]', 'text-[#1A1A1A]');
    tabOrder.classList.add('border-transparent', 'text-[#8C847A]');
    tabCart.classList.add('border-[#1A1A1A]', 'text-[#1A1A1A]');
    tabCart.classList.remove('border-transparent', 'text-[#8C847A]');
    if (btnSubmit) btnSubmit.classList.add('hidden');
    if (btnTrigger) {
      if (cart.length > 0) btnTrigger.classList.remove('hidden');
      else btnTrigger.classList.add('hidden');
    }
  }
}

function showCheckoutForm() {
  switchCheckoutTab('order');
}

function selectDeliveryType(type) {
  const select = document.getElementById('order-delivery');
  if (!select) return;
  select.value = type;
  handleDeliveryChange();
  updateDeliveryUI();
}

function updateDeliveryUI() {
  const type = document.getElementById('order-delivery')?.value || 'pickup';
  const panel = document.getElementById('delivery-info-panel');
  const addressInput = document.getElementById('order-address');
  const paymentSection = document.getElementById('payment-section');
  const btnPickup = document.getElementById('btn-delivery-pickup');
  const btnCourier = document.getElementById('btn-delivery-courier');
  const cfg = getDeliveryConfig();
  const active = 'border-[#1A1A1A] ring-1 ring-[#D4AF37] bg-[#FAF6F0]';
  const inactive = 'border-[#E5DCD3] bg-white';

  if (btnPickup) {
    btnPickup.className = `delivery-option text-left p-3 border transition ${type === 'pickup' ? active : inactive}`;
  }
  if (btnCourier) {
    btnCourier.className = `delivery-option text-left p-3 border transition ${type === 'delivery' ? active : inactive}`;
  }

  if (type === 'delivery') {
    if (addressInput) addressInput.classList.remove('hidden');
    if (paymentSection) paymentSection.classList.remove('hidden');
    if (panel) {
      panel.innerHTML = `
        <p class="font-bold uppercase tracking-wider text-[#1A1A1A] mb-2">${cfg.courierTitle}</p>
        <p>${cfg.courierDescription}</p>
        <p class="mt-2"><strong>Стоимость:</strong> ${formatSum(cfg.courierPrice)}</p>
        <p class="mt-1 text-[#8C847A]">После заказа менеджер позвонит и согласует удобное время.</p>`;
    }
  } else {
    if (addressInput) addressInput.classList.add('hidden');
    if (paymentSection) paymentSection.classList.add('hidden');
    if (panel) {
      panel.innerHTML = `
        <p class="font-bold uppercase tracking-wider text-[#1A1A1A] mb-2">Самовывоз из магазина Talaria</p>
        <p><strong>Адрес:</strong> ${cfg.pickupAddress}</p>
        <p class="mt-1"><strong>Режим работы:</strong> ${cfg.pickupHours}</p>
        <p class="mt-1"><strong>Телефон:</strong> <a href="tel:${cfg.pickupPhone.replace(/\s/g, '')}" class="text-[#D4AF37] underline">${cfg.pickupPhone}</a></p>
        <p class="mt-2 text-[#8C847A]">Доставка не оплачивается. Обувь можно примерить в магазине.</p>`;
    }
  }
}

function renderOrderInfoSummary() {
  const box = document.getElementById('order-info-summary');
  if (!box) return;

  if (cart.length === 0) {
    box.innerHTML = '<p class="text-[#8C847A]">Корзина пуста</p>';
    return;
  }

  let itemsTotal = 0;
  const lines = cart.map((item) => {
    const numericPrice = parseInt(String(item.price).replace(/[^0-9]/g, ''), 10) || 0;
    itemsTotal += numericPrice * item.quantity;
    return `<div class="flex justify-between gap-2 border-b border-[#FAF6F0] pb-1.5">
      <span class="line-clamp-1 flex-1">${cleanTitle(item.title)} · ${item.size}${item.color ? ` · ${item.color}` : ''}</span>
      <span class="whitespace-nowrap text-[#8C847A]">×${item.quantity}</span>
    </div>`;
  });

  const delivery = document.getElementById('order-delivery')?.value || 'pickup';
  const deliverySum = delivery === 'delivery' ? getDeliveryPrice() : 0;
  const total = itemsTotal + deliverySum;

  box.innerHTML = `
    <p class="text-[10px] uppercase tracking-widest font-bold text-[#D4AF37]">Состав заказа</p>
    ${lines.join('')}
    <div class="flex justify-between pt-2 font-semibold text-[#1A1A1A]">
      <span>Итого</span>
      <span>${formatSum(total)}</span>
    </div>`;
}

function handleDeliveryChange() {
  updateDeliveryUI();
  renderCart();
  renderOrderInfoSummary();
}

function toggleCardForm() {
  const payment = document.getElementById('order-payment').value;
  const cardForm = document.getElementById('card-form');
  if (payment !== 'cash') {
    cardForm.classList.remove('hidden');
    setTimeout(() => document.getElementById('order-card')?.focus(), 100);
  } else {
    cardForm.classList.add('hidden');
  }
}

function maskCardNumber(value) {
  return value.replace(/\s/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function validateCard() {
  const payment = document.getElementById('order-payment').value;
  if (payment === 'cash') return true;

  const card = document.getElementById('order-card').value.replace(/\s/g, '');
  const cardholder = document.getElementById('order-cardholder').value.trim();

  if (!card || card.length < 16) {
    alert('Пожалуйста, укажите корректный номер карты (16 цифр).');
    return false;
  }
  if (!cardholder || cardholder.length < 3) {
    alert('Пожалуйста, укажите ФИО держателя карты.');
    return false;
  }
  return true;
}

async function submitOrder() {
  console.log('🛒 Начало оформления заказа...');
  
  const name = document.getElementById('order-name').value.trim();
  const phone = document.getElementById('order-phone').value.trim();
  const delivery = document.getElementById('order-delivery').value;
  const address = document.getElementById('order-address').value.trim();
  
  // Для самовывоза всегда наличные, для доставки - выбор пользователя
  let payment = 'cash';
  if (delivery === 'delivery') {
    payment = document.getElementById('order-payment')?.value || 'cash';
  }
  
  const btn = document.getElementById('btn-submit-order');

  console.log('📝 Данные формы:', { name, phone, delivery, address, payment });

  if (!name || !phone) {
    console.warn('⚠️ Не заполнены имя или телефон');
    alert('Пожалуйста, укажите Ваше Имя и Телефон для связи.');
    return;
  }

  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleanPhone.startsWith('+998')) {
    alert('Пожалуйста, укажите номер телефона в международном формате, начиная с +998 (например, +998 90 123 45 67).');
    return;
  }
  if (cleanPhone.length !== 13 || !/^\+998\d{9}$/.test(cleanPhone)) {
    alert('Пожалуйста, введите корректный номер телефона (код страны +998 и 9 цифр номера).');
    return;
  }

  if (delivery === 'delivery' && !address) {
    console.warn('⚠️ Не указан адрес доставки');
    alert('Пожалуйста, укажите точный адрес доставки по Ташкенту.');
    return;
  }

  if (!validateCard()) {
    console.warn('⚠️ Ошибка валидации карты');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'ОФОРМЛЯЕМ...';

  let itemsTotal = 0;
  cart.forEach(item => {
    const numericPrice = parseInt(item.price.replace(/[^0-9]/g, '')) || 0;
    itemsTotal += numericPrice * item.quantity;
  });

  const cfg = getDeliveryConfig();
  const deliveryFee = getDeliveryPrice();
  const finalTotal = delivery === 'delivery' ? itemsTotal + deliveryFee : itemsTotal;
  const comment = document.getElementById('order-comment')?.value.trim() || '';

  let addressLine = address;
  if (delivery === 'pickup') {
    addressLine = `Самовывоз: ${cfg.pickupAddress}`;
  } else if (comment) {
    addressLine = `${address} (${comment})`;
  }

  try {
    const card = document.getElementById('order-card').value.replace(/\s/g, '');
    const cardLastFour = card.length >= 4 ? card.slice(-4) : '';

    const orderData = {
      customer_name: name,
      phone: phone,
      address: addressLine,
      delivery_type: delivery,
      payment_method: payment,
      card_last_four: payment !== 'cash' ? cardLastFour : null,
      items: cart.map(item => ({
        ...item,
        title: cleanTitle(item.title)
      })),
      total_price: finalTotal,
      status: 'pending'
    };

    // Проверяем, что Supabase доступен
    if (typeof supabase === 'undefined') {
      throw new Error('Библиотека Supabase не загружена. Проверьте подключение скрипта.');
    }

    // Создаем клиент Supabase напрямую из конфига
    console.log('📦 Отправка заказа в Supabase...', orderData);
    const _sbClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await _sbClient
      .from('orders')
      .insert(orderData)
      .select('id')
      .single();

    if (error) {
      console.error('❌ Ошибка Supabase:', error);
      throw error;
    }

    console.log('✅ Заказ успешно создан:', data);

    const orderId = data.id;

    // Очищаем локальную корзину
    cart = [];
    localStorage.setItem('talaria_cart', JSON.stringify([]));
    renderCart();
    toggleCart(false);

    document.getElementById('order-name').value = '';
    document.getElementById('order-phone').value = '';
    document.getElementById('order-address').value = '';
    document.getElementById('order-card').value = '';
    document.getElementById('order-cardholder').value = '';
    const commentEl = document.getElementById('order-comment');
    if (commentEl) commentEl.value = '';
    switchCheckoutTab('cart');

    openPaymentModal(orderId, name, finalTotal, payment);
  } catch (e) {
    console.error('❌ Критическая ошибка при оформлении заказа:', e);
    const errorMsg = e.message || 'Неизвестная ошибка';
    alert(`⚠️ Ошибка при отправке заказа:\n\n${errorMsg}\n\nПожалуйста, свяжитесь с нами напрямую по телефону.`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ПОДТВЕРДИТЬ ЗАКАЗ';
  }
}

function openPaymentModal(orderId, name, total, payment) {
  document.getElementById('success-order-id').textContent = orderId;
  document.getElementById('success-total-price').textContent = formatSum(total);
  document.getElementById('payment-card-number').textContent = '9860 1701 1472 9453';
  document.getElementById('payment-card-holder').textContent = 'ZEMFIRA KONTYUKOVA';

  const btnClick = document.getElementById('btn-click-pay');
  const btnPayme = document.getElementById('btn-payme-pay');
  const cardDetailsCard = document.getElementById('payment-details-card');
  const importantNote = document.getElementById('payment-important-note');

  btnClick.classList.add('hidden');
  btnPayme.classList.add('hidden');
  cardDetailsCard.classList.add('hidden');
  if (importantNote) {
    importantNote.classList.add('hidden');
  }

  if (payment === 'click' && CONFIG.PAYMENT_CARD) {
    cardDetailsCard.classList.remove('hidden');
    if (importantNote) {
      importantNote.classList.remove('hidden');
    }
    btnClick.href = `https://click.uz/clickme?card=${CONFIG.PAYMENT_CARD.replace(/\s/g, '')}&amount=${total}`;
    btnClick.classList.remove('hidden');
    // Блокировка кнопки на 5 секунд
    btnClick.disabled = true;
    btnClick.style.opacity = '0.5';
    btnClick.style.cursor = 'not-allowed';
    let countdown = 5;
    const originalText = btnClick.textContent;
    btnClick.textContent = `⏳ ОЖИДАНИЕ (${countdown} сек)`;
    
    const timer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        btnClick.textContent = `⏳ ОЖИДАНИЕ (${countdown} сек)`;
      } else {
        clearInterval(timer);
        btnClick.disabled = false;
        btnClick.style.opacity = '1';
        btnClick.style.cursor = 'pointer';
        btnClick.textContent = originalText;
      }
    }, 1000);
  } else if (payment === 'payme' && CONFIG.PAYMENT_CARD) {
    cardDetailsCard.classList.remove('hidden');
    if (importantNote) {
      importantNote.classList.remove('hidden');
    }
    btnPayme.href = `https://payme.uz/card/${CONFIG.PAYMENT_CARD.replace(/\s/g, '')}/${total}`;
    btnPayme.classList.remove('hidden');
    // Блокировка кнопки на 5 секунд
    btnPayme.disabled = true;
    btnPayme.style.opacity = '0.5';
    btnPayme.style.cursor = 'not-allowed';
    let countdown = 5;
    const originalText = btnPayme.textContent;
    btnPayme.textContent = `⏳ ОЖИДАНИЕ (${countdown} сек)`;
    
    const timer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        btnPayme.textContent = `⏳ ОЖИДАНИЕ (${countdown} сек)`;
      } else {
        clearInterval(timer);
        btnPayme.disabled = false;
        btnPayme.style.opacity = '1';
        btnPayme.style.cursor = 'pointer';
        btnPayme.textContent = originalText;
      }
    }, 1000);
  }

  document.getElementById('payment-modal').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.add('hidden');
}
