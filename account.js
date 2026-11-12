const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const authForm = document.querySelector('#auth');
const form = document.querySelector('#product');
const picker = document.querySelector('#products');
const search = document.querySelector('#search');
const remove = document.querySelector('#remove');
const status = document.querySelector('#status');
const fields = ['title', 'price', 'sizes', 'description'];
const color = form.elements.color;
const adminEmail = 'admin@talaria.uz';
let products = [];
let selectedId = '';
let busy = false;

async function run(action) {
    if (busy) return;
    busy = true;
    status.textContent = '';
    try {
        await action();
    } catch (error) {
        status.textContent = error.message;
    } finally {
        busy = false;
    }
}

function requireSuccess(result) {
    if (result.error) throw result.error;
    return result.data;
}

async function loadProducts() {
    products = requireSuccess(await client.from('products').select('*')
        .order('id', { ascending: false }));
    color.disabled = !products.some(item => Object.hasOwn(item, 'color'));
    color.closest('label').hidden = color.disabled;
    renderProducts();
}

function renderProducts() {
    const query = search.value.trim().toLowerCase().replace(/^#/, '');
    const matches = products.filter(item => String(item.id).includes(query) ||
        (item.title ?? '').toLowerCase().includes(query));
    document.querySelector('#count').textContent = `Товаров: ${matches.length}`;
    picker.replaceChildren();
    for (const item of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'product-row';
        button.setAttribute('aria-pressed', String(item.id) === selectedId);
        const name = document.createElement('strong');
        name.textContent = item.title || 'Без названия';
        const details = document.createElement('small');
        details.textContent = `#${item.id} · ${item.price || 'Без цены'} · ${item.is_available ? 'В наличии' : 'Нет в наличии'}`;
        button.append(name, details);
        button.addEventListener('click', () => selectProduct(String(item.id)));
        picker.append(button);
    }
    if (!matches.length) picker.textContent = 'Товары не найдены.';
}

function selectProduct(id) {
    selectedId = id;
    renderProducts();
    showProduct();
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showProduct() {
    form.reset();
    const product = products.find(item => String(item.id) === selectedId);
    document.querySelector('#editor-title').textContent = product ? `Редактирование #${product.id}` : 'Новый товар';
    remove.disabled = !product;
    if (!product) return;
    for (const field of fields) form.elements[field].value = product[field] ?? '';
    color.value = product.color ?? '';
    form.elements.photos.value = (product.photos ?? []).join('\n');
    form.elements.is_available.checked = Boolean(product.is_available);
}

async function renderSession(session) {
    authForm.hidden = Boolean(session);
    document.querySelector('#session').hidden = !session;
    const user = session?.user;
    const isAdmin = user?.app_metadata?.talaria_role === 'admin';
    document.querySelector('#admin').hidden = !isAdmin;
    document.querySelector('#identity').textContent = isAdmin ? 'Администратор' : user?.email ?? '';
    if (isAdmin) await loadProducts();
}

authForm.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
        const login = authForm.elements.login.value.trim().toLowerCase();
        const email = login === 'admin' ? adminEmail : login;
        const password = authForm.elements.password.value;
        const register = event.submitter?.value === 'register';
        if (register && email === adminEmail) throw new Error('Этот логин зарезервирован.');
        if (!email.includes('@')) throw new Error('Введи адрес электронной почты.');
        const data = requireSuccess(register
            ? await client.auth.signUp({ email, password })
            : await client.auth.signInWithPassword({ email, password }));
        authForm.reset();
        if (register && !data.session) status.textContent = 'Проверь почту для подтверждения регистрации.';
    });
});

document.querySelector('#logout').addEventListener('click', () => run(async () => {
    requireSuccess(await client.auth.signOut());
}));

search.addEventListener('input', renderProducts);
document.querySelector('#new').addEventListener('click', () => {
    selectProduct('');
    form.elements.title.focus();
});
form.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
        const id = selectedId;
        const product = Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
        if (!color.disabled) product.color = color.value.trim();
        if (!product.title || !product.price) throw new Error('Укажи название и цену.');
        product.photos = form.elements.photos.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
        if (product.photos.some(url => !/^https?:\/\//i.test(url))) {
            throw new Error('Ссылки на фото должны начинаться с https:// или http://.');
        }
        product.is_available = form.elements.is_available.checked;
        const mutation = id
            ? client.from('products').update(product).eq('id', id)
            : client.from('products').insert(product);
        const saved = requireSuccess(await mutation.select('id').single());
        await loadProducts();
        selectProduct(String(saved.id));
        status.textContent = 'Товар сохранён.';
    });
});

remove.addEventListener('click', () => {
    const id = selectedId;
    if (!id || !window.confirm('Удалить товар из каталога?')) return;
    run(async () => {
        requireSuccess(await client.from('products').delete().eq('id', id).select('id').single());
        await loadProducts();
        selectProduct('');
        status.textContent = 'Товар удалён.';
    });
});

client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => renderSession(session).catch(error => {
        status.textContent = error.message;
    }), 0);
});
