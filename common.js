const HV={
  isCustomIdProduct(product){const p=product||{};if(p.productType==='custom_id')return true;const text=`${p.name||''} ${p.badge||''} ${p.description||''}`.toLowerCase();return /(^|\b)id\s*personalizad[oa](\b|$)/i.test(text)||/compra\s+de\s+id/i.test(text);},
  apiBase(){
    const raw=String(window.HV_CONFIG?.API_BASE||'').trim().replace(/\/$/,'');
    return raw && !raw.includes('COLE_AQUI_') ? raw : '';
  },
  api(path){
    const base=this.apiBase();
    if(!base) throw new Error('Backend ainda não configurado. Edite config.js e informe a URL do Render.');
    return base + (String(path).startsWith('/') ? path : '/'+path);
  },
  media(path){
    const p=String(path||'');
    if(!p) return '';
    if(/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
    if(p.startsWith('/uploads/')){ const base=this.apiBase(); return base ? base+p : p; }
    return p;
  },
  cart(){try{return JSON.parse(localStorage.getItem('hv_cart')||'[]')}catch{return[]}},
  save(cart){localStorage.setItem('hv_cart',JSON.stringify(cart));this.updateCount()},
  add(product,qty=1){const cart=this.cart();const custom=this.isCustomIdProduct(product);const found=cart.find(x=>x.id===product.id);if(found){found.productType=custom?'custom_id':'normal';found.qty=custom?1:found.qty+qty;}else cart.push({id:product.id,name:product.name,price:product.price,icon:product.icon,badge:product.badge||'',description:product.description||'',productType:custom?'custom_id':'normal',qty:custom?1:qty});this.save(cart);this.toast(`${product.name} foi adicionado ao carrinho.`)},
  money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})},
  updateCount(){const n=this.cart().reduce((a,b)=>a+b.qty,0);document.querySelectorAll('.cart-count').forEach(el=>el.textContent=n)},
  toast(msg){let t=document.querySelector('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');clearTimeout(window.__hvt);window.__hvt=setTimeout(()=>t.classList.remove('show'),2300)},
  async products(){const r=await fetch(this.api('/api/products'));if(!r.ok)throw new Error('Não foi possível carregar a loja.');return (await r.json()).products},
  nav(){this.updateCount();const menu=document.querySelector('.mobile-nav');document.querySelector('.menu')?.addEventListener('click',()=>menu?.classList.add('open'));document.querySelector('.close-menu')?.addEventListener('click',()=>menu?.classList.remove('open'));document.querySelectorAll('.mobile-nav a').forEach(a=>a.onclick=()=>menu?.classList.remove('open'))}
};document.addEventListener('DOMContentLoaded',()=>HV.nav());
