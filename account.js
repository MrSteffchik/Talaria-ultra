const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const authForm = document.querySelector('#auth');
const form = document.querySelector('#product');
const picker = document.querySelector('#products');
const remove = document.querySelector('#remove');
const status = document.querySelector('#status');
const fields = ['title', 'price', 'sizes', 'color', 'description'];
const adminEmail = 'admin@talaria.uz';
let products = [];
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
    products = requireSuccess(await client.from('products').select(
        'id,title,price,sizes,color,description,photos,is_available'
    ).order('id', { ascending: false }));
    picker.replaceChildren(new Option('Новый товар', ''));
    for (const product of products) {
        picker.add(new Option(`#${product.id} — ${product.title || 'Без названия'}`, product.id));
    }
    showProduct();
}

function showProduct() {
    form.reset();
    const product = products.find(item => String(item.id) === picker.value);
    remove.disabled = !product;
    if (!product) return;
    for (const field of fields) form.elements[field].value = product[field] ?? '';
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

picker.addEventListener('change', showProduct);
form.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
        const id = picker.value;
        const product = Object.fromEntries(fields.map(field => [field, form.elements[field].value.trim()]));
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
        picker.value = String(saved.id);
        showProduct();
        status.textContent = 'Товар сохранён.';
    });
});

remove.addEventListener('click', () => {
    const id = picker.value;
    if (!id || !window.confirm('Удалить товар из каталога?')) return;
    run(async () => {
        requireSuccess(await client.from('products').delete().eq('id', id).select('id').single());
        await loadProducts();
        status.textContent = 'Товар удалён.';
    });
});

client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => renderSession(session).catch(error => {
        status.textContent = error.message;
    }), 0);
});
