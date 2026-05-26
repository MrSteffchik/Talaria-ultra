// Модуль корзины и оформления заказов для Talaria
let cart = JSON.parse(localStorage.getItem('talaria_cart') || '[]');

// Константа стоимости доставки
const DELIVERY_PRICE = 40000;

// Умная очистка размеров (убирает сердечки, стрелочки и оставляет только числа)
function cleanSizes(sizesStr) {
  if (!sizesStr) return '';
  // Убираем любые эмодзи с помощью Unicode property escapes
  let clean = sizesStr.replace(/\p{Extended_Pictographic}/gu, '').replace(/\p{Emoji_Presentation}/gu, '').trim();
  const matches = clean.match(/\b(3[4-9]|4[0-8])\b/g);
  if (matches) {
    return [...new Set(matches)].sort().join(', ');
  }
  return clean;
}

// Умная очистка названий (убирает эмодзи, мусорные реакции из Telegram)
function cleanTitle(titleStr, descStr) {
  if (!titleStr) return 'Элегантная модель';
  
  // Использование Unicode Property Escapes для полного удаления эмодзи
  let clean = titleStr.replace(/\p{Extended_Pictographic}/gu, '').replace(/\p{Emoji_Presentation}/gu, '').trim();
  
  // Убираем оставшийся мусор и знаки
  clean = clean.replace(/^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,]+/, '').trim();
  
  if (clean.length < 2) {
    const text = (descStr || '').toLowerCase();
    if (text.includes('кроссовк') || text.includes('кед')) return 'Стильные кроссовки';
    if (text.includes('туфли') || text.includes('каблук')) return 'Элегантные туфли';
    if (text.includes('босонож') || text.includes('сандал')) return 'Премиальные босоножки';
    if (text.includes('сабо') || text.includes('слипон')) return 'Удобные сабо';
    return 'Женская обувь Talaria';
  }
  return clean;
}

// Умная очистка описания от эмодзи и Telegram-реакций
function cleanDescription(descStr) {
  if (!descStr) return '';
  let lines = descStr.split('\n');
  let cleanedLines = lines.map(line => {
    // Удаляем все эмодзи
    let cleanLine = line.replace(/\p{Extended_Pictographic}/gu, '').replace(/\p{Emoji_Presentation}/gu, '').trim();
    // Удаляем мусорные знаки в начале строки
    cleanLine = cleanLine.replace(/^[👌👍😁😀😊😂🎉🔥✨🌟💎👑🖤❤️✊🎨⭐⏳✅❌\-\s\•\:\.\,\*]+/gu, '').trim();
    return cleanLine;
  }).filter(line => line.length > 0);
  
  return cleanedLines.join('\n');
}

// Форматирование цены на фронтенде с поддержкой зачеркнутой старой цены
function formatPriceHTML(priceStr) {
  if (!priceStr) return 'Цена по запросу';
  
  // Ищем старую цену в скобках, например: "450 000 сум (было: 490 000 сум)"
  const match = priceStr.match(/(.*?)\s*\((?:было|было:)\s*(.*?)\)/i);
  if (match) {
    const currentPrice = match[1].trim();
    const oldPrice = match[2].trim();
    return `${currentPrice} <span class="line-through text-xs font-light text-[#8C847A] ml-2 opacity-70">${oldPrice}</span>`;
  }
  return priceStr;
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

    <!-- Content (Scrollable) -->
    <div class="flex-grow overflow-y-auto px-6 py-4" id="cart-items-container"></div>

    <!-- Summary & Form -->
    <div class="border-t border-[#E5DCD3] bg-white p-6 space-y-4">
      <div class="space-y-1.5 text-xs tracking-wider border-b border-[#FAF6F0] pb-3">
        <div class="flex justify-between text-[#8C847A]">
          <span>ТОВАРЫ:</span>
          <span id="cart-subtotal-price" class="font-semibold text-[#1A1A1A]">0 сум</span>
        </div>
        <div id="cart-delivery-row" class="hidden flex justify-between text-[#8C847A]">
          <span>ДОСТАВКА (с примеркой):</span>
          <span class="font-semibold text-[#1A1A1A]">40 000 сум</span>
        </div>
        <div class="flex justify-between items-center font-semibold pt-1">
          <span class="text-[#8C847A] uppercase">ИТОГО К ОПЛАТЕ:</span>
          <span id="cart-total-price" class="text-sm font-bold text-[#1A1A1A]">0 сум</span>
        </div>
      </div>

      <div id="checkout-form-container" class="hidden space-y-3 pt-2">
        <h4 class="text-[10px] tracking-widest uppercase font-bold text-[#D4AF37]">Оформление заказа</h4>
        <input type="text" id="order-name" placeholder="Ваше Имя" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        <input type="tel" id="order-phone" placeholder="Телефон (+998XXXXXXXXX)" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        
        <select id="order-delivery" onchange="handleDeliveryChange()" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none">
          <option value="pickup">Самовывоз (ул. Мирзо Улугбека, 99)</option>
          <option value="delivery">Доставка курьером (по Ташкенту, +40 000 сум)</option>
        </select>
        <input type="text" id="order-address" placeholder="Адрес доставки" class="hidden w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none" />
        
        <select id="order-payment" class="w-full bg-[#FAF6F0] text-xs px-3 py-2.5 border border-[#E5DCD3] focus:border-[#D4AF37] focus:outline-none">
          <option value="cash">Оплата наличными / при получении</option>
          <option value="click">Картой через CLICK</option>
          <option value="payme">Картой через PAYME</option>
        </select>

        <button onclick="submitOrder()" id="btn-submit-order" class="w-full bg-[#1A1A1A] text-white py-3 text-xs tracking-[0.2em] uppercase font-semibold hover:bg-[#D4AF37] transition">
          ПОДТВЕРДИТЬ ЗАКАЗ
        </button>
      </div>

      <button onclick="showCheckoutForm()" id="btn-checkout-trigger" class="w-full bg-[#1A1A1A] text-white py-3.5 text-xs tracking-[0.2em] uppercase font-semibold hover:bg-[#D4AF37] transition">
        ПЕРЕЙТИ К ОФОРМЛЕНИЮ
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
          <p><strong>Получатель:</strong> <span id="payment-card-holder">Владелец Карты</span></p>
          <p><strong>Номер карты:</strong> <span id="payment-card-number" class="font-bold tracking-wider text-[#1A1A1A]">8600 ---- ---- ----</span></p>
          <p><strong>К оплате:</strong> <span id="success-total-price" class="font-bold text-red-600">0 сум</span></p>
        </div>
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

  // Обновляем бейдж корзины при загрузке страницы
  updateCartBadge();
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
    document.getElementById('btn-checkout-trigger').classList.add('hidden');
    document.getElementById('checkout-form-container').classList.add('hidden');
    return;
  }

  document.getElementById('btn-checkout-trigger').classList.remove('hidden');

  let itemsTotal = 0;
  container.innerHTML = cart.map((item, index) => {
    const numericPrice = parseInt(item.price.replace(/[^0-9]/g, '')) || 0;
    itemsTotal += numericPrice * item.quantity;

    return `
      <div class="flex items-center gap-4 py-4 border-b border-[#E5DCD3]/50">
        <img src="${item.photo}" class="w-16 h-16 object-cover border border-[#E5DCD3]" onerror="this.src='https://via.placeholder.com/300x300?text=Нет+фото'" />
        <div class="flex-grow space-y-1">
          <h4 class="text-xs font-bold uppercase tracking-wider text-[#1A1A1A] line-clamp-1">${cleanTitle(item.title)}</h4>
          <p class="text-[10px] text-[#8C847A]">Размер: <span class="font-bold text-[#1A1A1A]">${item.size}</span></p>
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
  if (delivery === 'delivery') {
    if(deliveryRow) deliveryRow.classList.remove('hidden');
    totalPriceEl.textContent = formatSum(itemsTotal + DELIVERY_PRICE);
  } else {
    if(deliveryRow) deliveryRow.classList.add('hidden');
    totalPriceEl.textContent = formatSum(itemsTotal);
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

function showCheckoutForm() {
  document.getElementById('btn-checkout-trigger').classList.add('hidden');
  document.getElementById('checkout-form-container').classList.remove('hidden');
}

function handleDeliveryChange() {
  const delivery = document.getElementById('order-delivery').value;
  const addressInput = document.getElementById('order-address');
  if (delivery === 'delivery') {
    addressInput.classList.remove('hidden');
  } else {
    addressInput.classList.add('hidden');
  }
  renderCart(); // Пересчитываем итог с доставкой
}

async function submitOrder() {
  const name = document.getElementById('order-name').value.trim();
  const phone = document.getElementById('order-phone').value.trim();
  const delivery = document.getElementById('order-delivery').value;
  const address = document.getElementById('order-address').value.trim();
  const payment = document.getElementById('order-payment').value;
  const btn = document.getElementById('btn-submit-order');

  if (!name || !phone) {
    alert('Пожалуйста, укажите Ваше Имя и Телефон для связи.');
    return;
  }

  if (delivery === 'delivery' && !address) {
    alert('Пожалуйста, укажите точный адрес доставки по Ташкенту.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'ОФОРМЛЯЕМ...';

  let itemsTotal = 0;
  cart.forEach(item => {
    const numericPrice = parseInt(item.price.replace(/[^0-9]/g, '')) || 0;
    itemsTotal += numericPrice * item.quantity;
  });

  const finalTotal = delivery === 'delivery' ? itemsTotal + DELIVERY_PRICE : itemsTotal;

  try {
    const orderData = {
      customer_name: name,
      phone: phone,
      address: delivery === 'pickup' ? 'Самовывоз (Мирзо Улугбека, 99)' : address,
      delivery_type: delivery,
      payment_method: payment,
      items: cart.map(item => ({
        ...item,
        title: cleanTitle(item.title) // Сохраняем уже чистые названия без смайлов
      })),
      total_price: finalTotal,
      status: 'pending'
    };

    // Создаем клиент Supabase напрямую из конфига
    const _sbClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await _sbClient
      .from('orders')
      .insert(orderData)
      .select('id')
      .single();

    if (error) throw error;

    const orderId = data.id;

    // Очищаем локальную корзину
    cart = [];
    localStorage.setItem('talaria_cart', JSON.stringify([]));
    renderCart();
    toggleCart(false);

    document.getElementById('order-name').value = '';
    document.getElementById('order-phone').value = '';
    document.getElementById('order-address').value = '';

    openPaymentModal(orderId, name, finalTotal, payment);
  } catch (e) {
    console.error(e);
    alert('Произошла ошибка при отправке заказа. Пожалуйста, свяжитесь с нами напрямую по телефону.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ПОДТВЕРДИТЬ ЗАКАЗ';
  }
}

function openPaymentModal(orderId, name, total, payment) {
  document.getElementById('success-order-id').textContent = orderId;
  document.getElementById('success-total-price').textContent = formatSum(total);
  document.getElementById('payment-card-number').textContent = CONFIG.PAYMENT_CARD || 'Спросите у менеджера';
  document.getElementById('payment-card-holder').textContent = CONFIG.CARD_HOLDER || 'Владелец Карты';

  const btnClick = document.getElementById('btn-click-pay');
  const btnPayme = document.getElementById('btn-payme-pay');
  const cardDetailsCard = document.getElementById('payment-details-card');

  btnClick.classList.add('hidden');
  btnPayme.classList.add('hidden');
  cardDetailsCard.classList.add('hidden');

  if (payment === 'click' && CONFIG.PAYMENT_CARD) {
    cardDetailsCard.classList.remove('hidden');
    btnClick.href = `https://click.uz/clickme?card=${CONFIG.PAYMENT_CARD.replace(/\s/g, '')}&amount=${total}`;
    btnClick.classList.remove('hidden');
  } else if (payment === 'payme' && CONFIG.PAYMENT_CARD) {
    cardDetailsCard.classList.remove('hidden');
    btnPayme.href = `https://payme.uz/card/${CONFIG.PAYMENT_CARD.replace(/\s/g, '')}/${total}`;
    btnPayme.classList.remove('hidden');
  }

  document.getElementById('payment-modal').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.add('hidden');
}
