const HV = {
  apiBase() {
    const raw = String(window.HV_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');
    return raw && !raw.includes('COLE_AQUI_') ? raw : '';
  },
  api(path) {
    const base = this.apiBase();
    if (!base) throw new Error('Backend ainda não configurado. Edite config.js e informe a URL do Render.');
    return base + (String(path).startsWith('/') ? path : '/' + path);
  },
  media(path) {
    const p = String(path || '');
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
    if (p.startsWith('/uploads/')) return this.apiBase() ? this.apiBase() + p : p;
    return p;
  },
  cart() {
    try {
      const value = JSON.parse(localStorage.getItem('hv_cart') || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  },
  save(cart) {
    localStorage.setItem('hv_cart', JSON.stringify(Array.isArray(cart) ? cart : []));
    this.updateCount();
  },
  isCustomIdProduct(product) {
    const t = String(product?.productType || product?.type || '').trim().toLowerCase();
    const n = String(product?.name || '').trim().toLowerCase();
    const b = String(product?.badge || '').trim().toLowerCase();
    return t === 'custom_id' || t === 'id' || n === 'id' || n === 'id personalizado' || n === 'id personalizável' || n === 'id personalizavel' || n.includes('id personalizado') || b.includes('id personalizado');
  },
  add(product, qty = 1) {
    if (!product) return this.toast('Não foi possível adicionar esse produto. Atualize a loja e tente novamente.');
    const items = this.cart();
    const custom = this.isCustomIdProduct(product);
    const found = items.find(x => String(x.id) === String(product.id));
    if (found) {
      found.name = product.name;
      found.price = Number(product.price || 0);
      found.icon = product.icon || '◆';
      found.badge = product.badge || '';
      found.productType = custom ? 'custom_id' : 'normal';
      found.qty = custom ? 1 : Number(found.qty || 1) + Number(qty || 1);
    } else {
      items.push({
        id: product.id,
        name: product.name,
        price: Number(product.price || 0),
        icon: product.icon || '◆',
        badge: product.badge || '',
        productType: custom ? 'custom_id' : 'normal',
        qty: custom ? 1 : Number(qty || 1)
      });
    }
    this.save(items);
    this.toast(`${product.name} foi adicionado ao carrinho.`);
  },
  money(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
  updateCount() {
    const n = this.cart().reduce((a, b) => a + Number(b.qty || 0), 0);
    document.querySelectorAll('.cart-count').forEach(el => el.textContent = n);
  },
  toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window.__hvt);
    window.__hvt = setTimeout(() => t.classList.remove('show'), 2600);
  },
  async products() {
    const url = this.api('/api/products') + `?v=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error('Não foi possível carregar a loja.');
    const data = await r.json();
    return Array.isArray(data.products) ? data.products : [];
  },
  nav() {
    this.updateCount();
    const menu = document.querySelector('.mobile-nav');
    document.querySelector('.menu')?.addEventListener('click', () => menu?.classList.add('open'));
    document.querySelector('.close-menu')?.addEventListener('click', () => menu?.classList.remove('open'));
    document.querySelectorAll('.mobile-nav a').forEach(a => a.onclick = () => menu?.classList.remove('open'));
  }
};

document.addEventListener('DOMContentLoaded', () => HV.nav());
