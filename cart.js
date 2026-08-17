(() => {
  'use strict';

  const BUILD = '20260816-v5.3-final';
  let couponCode = '';
  let couponDiscount = 0;
  let idNoticeAccepted = false;
  let idVerification = emptyVerification();

  function emptyVerification() {
    return { ok: false, token: null, account: '', desiredId: null, expiresAt: 0 };
  }

  function saveVerification() {
    try { sessionStorage.setItem('hv_id_verification', JSON.stringify(idVerification)); } catch (_) {}
  }

  function restoreVerification() {
    try {
      const raw = JSON.parse(sessionStorage.getItem('hv_id_verification') || 'null');
      if (raw && raw.ok && raw.token && Number(raw.expiresAt) > Date.now()) {
        idVerification = raw;
      } else {
        sessionStorage.removeItem('hv_id_verification');
      }
    } catch (_) {}
  }

  function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function isIdProduct(item) {
    if (!item) return false;
    const type = normalize(item.productType || item.type);
    const name = normalize(item.name);
    const badge = normalize(item.badge);
    return type === 'custom_id' ||
      type === 'id' ||
      name === 'id' ||
      name === 'id personalizado' ||
      name === 'id personalizavel' ||
      name === 'id personalizável' ||
      name.includes('id personalizado') ||
      badge.includes('id personalizado');
  }

  function cart() {
    const items = HV.cart();
    return Array.isArray(items) ? items : [];
  }

  function hasIdProduct() {
    return cart().some(isIdProduct);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function requestId(prefix = 'req') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function idField() { return document.getElementById('desiredIdField'); }
  function idInput() { return document.getElementById('desiredId'); }
  function verifyButton() { return document.getElementById('verifyDesiredId'); }
  function verifyMessage() { return document.getElementById('idVerifyMsg'); }
  function accountInput() { return document.getElementById('account'); }
  function checkoutButton() { return document.querySelector('#checkout button[type="submit"]'); }

  function setVerifyMessage(text = '', kind = '') {
    const el = verifyMessage();
    if (!el) return;
    el.className = `coupon-msg${kind ? ` ${kind}` : ''}`;
    el.textContent = text;
  }

  function resetIdVerification(message = '') {
    idVerification = emptyVerification();
    try { sessionStorage.removeItem('hv_id_verification'); } catch (_) {}
    setVerifyMessage(message, message ? 'bad' : '');
    updateCheckoutButton();
  }

  function updateCheckoutButton() {
    const btn = checkoutButton();
    if (!btn) return;
    const needsId = hasIdProduct();
    const valid = idVerification.ok && idVerification.expiresAt > Date.now();
    btn.disabled = needsId && (!idNoticeAccepted || !valid);
    btn.title = btn.disabled ? 'Feche o aviso e verifique o ID antes de finalizar.' : '';
  }

  function setIdUiVisible(visible) {
    const field = idField();
    if (field) {
      field.hidden = !visible;
      field.style.display = visible ? 'block' : 'none';
    }
    document.body.classList.toggle('has-custom-id-product', visible);
  }

  function openIdNotice() {
    if (!hasIdProduct()) {
      idNoticeAccepted = true;
      updateCheckoutButton();
      return;
    }
    const modal = document.getElementById('idNoticeModal');
    if (modal) {
      idNoticeAccepted = false;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }
    updateCheckoutButton();
  }

  function closeIdNotice() {
    const modal = document.getElementById('idNoticeModal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    idNoticeAccepted = true;
    updateCheckoutButton();
  }

  function bindIdUi() {
    const need = hasIdProduct();
    setIdUiVisible(need);

    if (!need) {
      idNoticeAccepted = true;
      idVerification = emptyVerification();
      updateCheckoutButton();
      return;
    }

    const desired = idInput();
    const account = accountInput();
    const verify = verifyButton();

    if (desired && !desired.dataset.hvV5Bound) {
      desired.addEventListener('input', () => resetIdVerification(''));
      desired.dataset.hvV5Bound = '1';
    }
    if (account && !account.dataset.hvV5Bound) {
      account.addEventListener('input', () => resetIdVerification(''));
      account.dataset.hvV5Bound = '1';
    }
    if (verify) verify.onclick = verifyDesiredId;

    updateCheckoutButton();
  }

  async function verifyDesiredId() {
    const account = accountInput()?.value.trim() || '';
    const desiredId = Number(idInput()?.value);
    const btn = verifyButton();

    resetIdVerification('');

    if (account.length < 2) {
      setVerifyMessage('Informe primeiro a conta do MTA que receberá o ID.', 'bad');
      return;
    }
    if (!Number.isInteger(desiredId) || desiredId < 1 || desiredId > 999999) {
      setVerifyMessage('Digite um ID válido entre 1 e 999999.', 'bad');
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Verificando...';
    }
    setVerifyMessage('Consultando o servidor MTA...');

    try {
      const started = await HV.request('/api/id-checks', {
        method: 'POST',
        json: { account, desiredId, clientRequestId: requestId('idcheck') },
        timeoutMs: 20000
      });
      if (!started.token) throw new Error('O backend não retornou o código da verificação.');

      let result = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        await sleep(500);
        try {
          const data = await HV.request(`/api/id-checks/${encodeURIComponent(started.token)}?v=${Date.now()}`, { timeoutMs: 10000 });
          if (data.status === 'done' || data.status === 'failed') {
            result = data;
            break;
          }
          setVerifyMessage('Consultando a database do servidor...');
        } catch (pollError) {
          // Um GET é seguro para repetir. Pequenas oscilações do Render não cancelam a compra.
          if (attempt >= 49) throw pollError;
          setVerifyMessage('Servidor respondeu devagar. Tentando novamente...');
        }
      }

      if (!result) throw new Error('O servidor MTA não respondeu à verificação. Confirme se o hv_id_shop está iniciado.');
      if (result.status === 'failed') throw new Error(result.message || 'Não foi possível verificar o ID.');
      if (!result.accountExists) throw new Error('Essa conta não foi encontrada na database do Horizon ID. Confira o login da conta.');
      if (!result.available) throw new Error(`O ID ${desiredId} não está disponível. Escolha outro ID.`);

      idVerification = {
        ok: true,
        token: started.token,
        account,
        desiredId,
        expiresAt: Date.now() + 5 * 60 * 1000
      };
      saveVerification();
      const old = result.oldId !== null && result.oldId !== undefined ? ` • ID atual: ${result.oldId}` : '';
      setVerifyMessage(`✓ ID ${desiredId} disponível. Conta encontrada${old}.`, 'ok');
      updateCheckoutButton();
    } catch (error) {
      idVerification = emptyVerification();
      setVerifyMessage(error.message || 'Falha ao verificar o ID.', 'bad');
      updateCheckoutButton();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Verificar ID';
      }
    }
  }

  function totals() {
    const subtotal = cart().reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 1), 0);
    const discount = subtotal * (couponDiscount / 100);
    const total = Math.max(0, subtotal - discount);
    document.getElementById('subtotal').textContent = HV.money(subtotal);
    document.getElementById('discount').textContent = '- ' + HV.money(discount);
    document.getElementById('total').textContent = HV.money(total);
  }

  function render() {
    const items = cart();
    const box = document.getElementById('cartItems');
    if (!box) return;

    box.innerHTML = items.length ? items.map(item => {
      const customId = isIdProduct(item);
      const qtyControls = customId
        ? '<div class="qty"><b>1</b><span class="id-cart-chip">ID PERSONALIZADO</span></div>'
        : `<div class="qty"><button data-act="minus" data-id="${item.id}">−</button><b>${item.qty}</b><button data-act="plus" data-id="${item.id}">+</button></div>`;
      return `<article class="card cart-item">
        <div class="cart-icon">${item.icon || '◆'}</div>
        <div><h3>${item.name}</h3><small>${HV.money(item.price)} cada${customId ? ' • entrega automática' : ''}</small>${qtyControls}</div>
        <div style="text-align:right"><strong>${HV.money(Number(item.price || 0) * Number(item.qty || 1))}</strong><br><button class="remove" data-act="remove" data-id="${item.id}">Remover</button></div>
      </article>`;
    }).join('') : '<div class="card empty">Seu carrinho está vazio. <a href="store.html" style="color:#7f9cff">Abrir loja →</a></div>';

    document.querySelectorAll('[data-act]').forEach(button => {
      button.onclick = () => {
        const itemsNow = cart();
        const item = itemsNow.find(x => String(x.id) === String(button.dataset.id));
        if (!item) return;
        if (button.dataset.act === 'plus' && !isIdProduct(item)) item.qty = Number(item.qty || 1) + 1;
        if (button.dataset.act === 'minus' && !isIdProduct(item)) item.qty = Math.max(1, Number(item.qty || 1) - 1);
        if (button.dataset.act === 'remove') itemsNow.splice(itemsNow.indexOf(item), 1);
        HV.save(itemsNow);
        couponCode = '';
        couponDiscount = 0;
        document.getElementById('coupon').value = '';
        document.getElementById('couponMsg').textContent = '';
        resetIdVerification('');
        render();
      };
    });

    bindIdUi();
    totals();
  }

  async function hydrateCartFromBackend() {
    try {
      const products = await HV.products({ cacheBust: true });
      const byId = new Map(products.map(p => [String(p.id), p]));
      const items = cart();
      let changed = false;

      for (const item of items) {
        const product = byId.get(String(item.id));
        const custom = product ? isIdProduct(product) : isIdProduct(item);
        const nextType = custom ? 'custom_id' : 'normal';
        if (item.productType !== nextType) { item.productType = nextType; changed = true; }
        if (product) {
          if (item.name !== product.name) { item.name = product.name; changed = true; }
          if (Number(item.price) !== Number(product.price)) { item.price = Number(product.price); changed = true; }
          if ((item.icon || '') !== (product.icon || '')) { item.icon = product.icon || '◆'; changed = true; }
        }
        if (custom && Number(item.qty) !== 1) { item.qty = 1; changed = true; }
      }
      if (changed) HV.save(items);
    } catch (error) {
      console.warn('[HorizonVille V5] Não foi possível sincronizar produtos; usando os dados do carrinho.', error);
    }
  }

  async function applyCoupon() {
    const code = document.getElementById('coupon').value.trim();
    const msg = document.getElementById('couponMsg');
    if (!code) return;
    try {
      const data = await HV.request('/api/coupons/validate', {
        method: 'POST',
        json: { code, items: cart() },
        timeoutMs: 15000
      });
      couponCode = data.code;
      couponDiscount = Number(data.discountPercent || 0);
      msg.className = 'coupon-msg ok';
      msg.textContent = `Cupom ${data.code} aplicado: ${couponDiscount}% de desconto.`;
    } catch (error) {
      couponCode = '';
      couponDiscount = 0;
      msg.className = 'coupon-msg bad';
      msg.textContent = error.message;
    }
    totals();
  }

  async function checkout(event) {
    event.preventDefault();
    const items = cart();
    if (!items.length) return HV.toast('Adicione um produto antes de finalizar.');

    const customId = hasIdProduct();
    const account = accountInput()?.value.trim() || '';
    const desiredId = Number(idInput()?.value);

    if (customId) {
      if (!idNoticeAccepted) {
        openIdNotice();
        return;
      }
      if (!idVerification.ok || idVerification.expiresAt <= Date.now() || idVerification.account !== account || idVerification.desiredId !== desiredId) {
        return HV.toast('Verifique o ID antes de finalizar a compra.');
      }
    }

    const pay = document.querySelector('input[name="pay"]:checked')?.value;
    const submit = checkoutButton();
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Criando pedido...';
    }

    try {
      const data = await HV.request('/api/checkout', {
        method: 'POST',
        json: {
          items,
          couponCode,
          account,
          email: document.getElementById('email').value,
          discord: document.getElementById('discord').value,
          paymentMethod: pay,
          desiredId: customId ? desiredId : null,
          verificationToken: customId ? idVerification.token : null,
          checkoutRequestId: requestId('checkout')
        },
        timeoutMs: 20000
      });

      HV.save([]);
      const suffix = data.order?.desiredId ? ` ID solicitado: ${data.order.desiredId}. A entrega será automática após a aprovação do pagamento.` : '';
      document.getElementById('successText').textContent = `Pedido ${data.order.id} criado. ${data.payment.message}${suffix}`;
      document.getElementById('successModal').classList.add('open');
    } catch (error) {
      const message = error.message || 'Falha ao finalizar a compra.';
      HV.toast(message);
      if (customId) {
        // Só invalida a verificação quando o backend disser que ela realmente deixou de ser válida.
        if (/verifica|expir|conta ou o id mudou|reservado/i.test(message)) resetIdVerification(message);
        else setVerifyMessage(`O ID continua verificado. Erro ao criar pedido: ${message}`, 'bad');
      }
    } finally {
      if (submit) submit.textContent = 'Finalizar compra';
      updateCheckoutButton();
    }
  }

  async function loadPaymentMode() {
    try {
      const data = await HV.request(`/api/config?v=${Date.now()}`, { timeoutMs: 10000 });
      if (data.paymentMode === 'demo') {
        document.getElementById('paymentNote').textContent = 'Modo demonstração ativo: o checkout funciona sem cobrança real. Não use em produção.';
      }
    } catch (_) {}
  }

  async function init() {
    document.documentElement.dataset.hvCartBuild = BUILD;
    restoreVerification();
    document.getElementById('closeIdNotice')?.addEventListener('click', closeIdNotice);
    document.getElementById('applyCoupon')?.addEventListener('click', applyCoupon);
    document.getElementById('checkout')?.addEventListener('submit', checkout);

    await hydrateCartFromBackend();
    render();
    await loadPaymentMode();

    if (hasIdProduct()) {
      try {
        const network = await HV.request(`/api/network-test?v=${Date.now()}`, { timeoutMs: 10000 });
        if (network.build !== 'v5.3-final') {
          setVerifyMessage('O backend ainda não está na versão final. Faça o deploy do backend V5.2.', 'bad');
        }
      } catch (e) {
        setVerifyMessage(e.message, 'bad');
      }
      // O pré-carregador inline já pode ter aberto o modal; garantimos novamente aqui.
      setTimeout(openIdNotice, 120);
    } else {
      idNoticeAccepted = true;
      updateCheckoutButton();
    }

    console.info(`[HorizonVille] Checkout de ID ${BUILD} carregado.`, { hasIdProduct: hasIdProduct(), cart: cart() });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
