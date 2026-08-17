const HV = {
  apiBase() {
    const raw = String(window.HV_CONFIG?.API_BASE || '').trim().replace(/\/$/, '');
    return raw && !raw.includes('COLE_AQUI_') ? raw : '';
  },
  api(path) {
    const base = this.apiBase();
    if (!base) throw new Error('Backend ainda não configurado. Edite config.js e informe a URL do backend.');
    return base + (String(path).startsWith('/') ? path : '/' + path);
  },
  userToken() { return localStorage.getItem('hv_user_token') || ''; },
  panelToken(kind) { return sessionStorage.getItem(`hv_${kind}_panel_token`) || ''; },
  authHeaders(extra = {}) { const t=this.userToken(); return {...extra,...(t?{Authorization:`Bearer ${t}`}:{})}; },
  panelHeaders(kind, extra = {}) { const t=this.panelToken(kind); return {...extra,...(t?{Authorization:`Bearer ${t}`}:{})}; },
  async request(path, options = {}) {
    const url = this.api(path), method = String(options.method || 'GET').toUpperCase(), timeoutMs = Number(options.timeoutMs || 15000);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { ...(options.headers || {}) }; let body = options.body;
    if (options.auth === true && !headers.Authorization) Object.assign(headers, this.authHeaders());
    if (options.panel && !headers.Authorization) Object.assign(headers, this.panelHeaders(options.panel));
    if (options.json !== undefined) { headers['Content-Type'] = options.contentType || 'text/plain;charset=UTF-8'; body = JSON.stringify(options.json); }
    try {
      const response = await fetch(url, { method, headers, body, cache: options.cache || 'no-store', signal: controller.signal });
      const text = await response.text(); let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text }; }
      if (!response.ok) { const err = new Error(data.message || `API respondeu HTTP ${response.status}.`); err.status=response.status;err.data=data;throw err; }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('A API demorou para responder. Aguarde alguns segundos e tente novamente.');
      if (error instanceof TypeError || /failed to fetch/i.test(String(error?.message || ''))) throw new Error(`Não foi possível conectar ao backend (${this.apiBase()}).`);
      throw error;
    } finally { clearTimeout(timer); }
  },
  async me(force=false) {
    if (!this.userToken()) { this._me=null; return null; }
    if (!force && this._me) return this._me;
    try { const d=await this.request('/api/account/me',{auth:true}); this._me=d; return d; }
    catch(e){ if(e.status===401){localStorage.removeItem('hv_user_token');this._me=null;} return null; }
  },
  login(returnTo = location.pathname + location.search) {
    location.href = this.api(`/api/auth/discord/start?returnTo=${encodeURIComponent(returnTo)}`);
  },
  logout(){ localStorage.removeItem('hv_user_token');sessionStorage.removeItem('hv_admin_panel_token');sessionStorage.removeItem('hv_bot_panel_token');this._me=null;location.href='/'; },
  media(path) { const p=String(path||'');if(!p)return '';if(/^https?:\/\//i.test(p)||p.startsWith('data:'))return p;if(p.startsWith('/uploads/'))return this.apiBase()?this.apiBase()+p:p;return p; },
  cart() { try { const value=JSON.parse(localStorage.getItem('hv_cart')||'[]');return Array.isArray(value)?value:[]; } catch { return []; } },
  save(cart) { localStorage.setItem('hv_cart',JSON.stringify(Array.isArray(cart)?cart:[]));this.updateCount(); },
  isCustomIdProduct(product) { const t=String(product?.productType||product?.type||'').trim().toLowerCase(),n=String(product?.name||'').trim().toLowerCase(),b=String(product?.badge||'').trim().toLowerCase();return t==='custom_id'||t==='id'||n==='id'||n==='id personalizado'||n==='id personalizável'||n==='id personalizavel'||n.includes('id personalizado')||b.includes('id personalizado'); },
  add(product,qty=1) { if(!product)return this.toast('Não foi possível adicionar esse produto.');const items=this.cart(),custom=this.isCustomIdProduct(product),found=items.find(x=>String(x.id)===String(product.id));if(found){found.name=product.name;found.price=Number(product.price||0);found.icon=product.icon||'◆';found.badge=product.badge||'';found.productType=custom?'custom_id':'normal';found.qty=custom?1:Number(found.qty||1)+Number(qty||1);}else items.push({id:product.id,name:product.name,price:Number(product.price||0),icon:product.icon||'◆',badge:product.badge||'',productType:custom?'custom_id':'normal',qty:custom?1:Number(qty||1)});this.save(items);this.toast(`${product.name} foi adicionado ao carrinho.`); },
  money(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); },
  updateCount() { const n=this.cart().reduce((a,b)=>a+Number(b.qty||0),0);document.querySelectorAll('.cart-count').forEach(el=>el.textContent=n); },
  toast(msg) { let t=document.querySelector('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.classList.add('show');clearTimeout(window.__hvt);window.__hvt=setTimeout(()=>t.classList.remove('show'),2600); },
  async products() { const data=await this.request(`/api/products?v=${Date.now()}`);return Array.isArray(data.products)?data.products:[]; },
  async renderAccountWidget() {
    const actions=document.querySelector('.topbar .actions'); if(!actions)return;
    let holder=document.getElementById('hvAccountWidget');
    if(!holder){holder=document.createElement('div');holder.id='hvAccountWidget';holder.className='account-widget';const cart=actions.querySelector('.cart-link');actions.insertBefore(holder,cart||actions.querySelector('.menu'));}
    const me=await this.me();
    if(!me){holder.innerHTML='<button class="account-login" type="button">Conectar-se</button>';holder.querySelector('button').onclick=()=>this.login(location.pathname+location.search);return;}
    const u=me.user;holder.innerHTML=`<button class="account-user" type="button"><img src="${u.avatar}" alt=""><span>${this.escape(u.displayName||u.username)}</span><b>⌄</b></button><div class="account-menu"><a href="/perfil">Meu perfil</a><a href="/minhas-compras">Minhas compras</a><button type="button" class="account-logout">Desconectar</button></div>`;
    holder.querySelector('.account-user').onclick=()=>holder.classList.toggle('open');holder.querySelector('.account-logout').onclick=()=>this.logout();
  },
  escape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  nav() { this.updateCount();const menu=document.querySelector('.mobile-nav');document.querySelector('.menu')?.addEventListener('click',()=>menu?.classList.add('open'));document.querySelector('.close-menu')?.addEventListener('click',()=>menu?.classList.remove('open'));document.querySelectorAll('.mobile-nav a').forEach(a=>a.onclick=()=>menu?.classList.remove('open'));this.renderAccountWidget(); }
};
document.addEventListener('DOMContentLoaded',()=>HV.nav());
