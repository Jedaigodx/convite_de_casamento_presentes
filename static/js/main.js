// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  gifts: [],
  selectedGift: null,
  selectedMethod: null,
  currentStep: 1,
  currentFilter: 'all',
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const catalogGrid = document.getElementById('catalogGrid');
const catalogLoading = document.getElementById('catalogLoading');
const catalogEmpty = document.getElementById('catalogEmpty');
const filterBar = document.getElementById('filterBar');

const chooseModal = document.getElementById('chooseModal');
const chooseModalClose = document.getElementById('chooseModalClose');

const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');

const modalItemName = document.getElementById('modalItemName');
const modalItemPrice = document.getElementById('modalItemPrice');
const modalItemDesc = document.getElementById('modalItemDesc');
const monetaryAmountGroup = document.getElementById('monetaryAmountGroup');
const monetaryAmount = document.getElementById('monetaryAmount');

const deliveryBtns = document.querySelectorAll('.delivery-btn');
const step1Next = document.getElementById('step1Next');
const step2Back = document.getElementById('step2Back');
const step2Confirm = document.getElementById('step2Confirm');
const step3Close = document.getElementById('step3Close');
const chooseModalCloseBtn = document.getElementById('chooseModalClose');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadGifts();
  bindEvents();
}

// ─── Load Gifts ───────────────────────────────────────────────────────────────
async function loadGifts() {
  try {
    const res = await fetch('/api/gifts');
    state.gifts = await res.json();
    renderGifts();
  } catch (e) {
    catalogLoading.innerHTML = '<p style="color:var(--text-light)">Erro ao carregar presentes. Tente novamente.</p>';
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderGifts() {
  catalogLoading.classList.add('hidden');
  const filtered = state.currentFilter === 'all'
    ? state.gifts
    : state.gifts.filter(g => g.category === state.currentFilter);

  if (filtered.length === 0) {
    catalogEmpty.classList.remove('hidden');
    catalogGrid.innerHTML = '';
    return;
  }
  catalogEmpty.classList.add('hidden');

  catalogGrid.innerHTML = filtered.map((gift, i) => buildCard(gift, i)).join('');

  catalogGrid.querySelectorAll('.gift-card:not(.gift-card--unavailable)').forEach(card => {
    card.addEventListener('click', () => openModal(+card.dataset.id));
  });
}

function buildCard(gift, index) {
  const available = gift.is_monetary || gift.is_available;
  const priceLabel = gift.is_monetary
    ? `A partir de R$ ${fmt(gift.price)}`
    : `R$ ${fmt(gift.price)}`;

  const qtyLabel = gift.is_monetary
    ? ''
    : gift.max_quantity === 1
      ? (available ? 'Disponível' : 'Já escolhido')
      : `${gift.available_quantity} de ${gift.max_quantity} disponíveis`;

  const img = gift.image_url
    ? `<img class="gift-card__image" src="${gift.image_url}" alt="${gift.name}" loading="lazy" />`
    : `<div class="gift-card__image-placeholder">♡</div>`;

  const btn = available
    ? `<button class="gift-card__choose-btn">Escolher</button>`
    : `<span class="gift-card__unavailable-tag">Esgotado</span>`;

  return `
    <div class="gift-card ${available ? '' : 'gift-card--unavailable'} ${gift.is_monetary ? 'gift-card--monetary' : ''}"
         data-id="${gift.id}"
         style="animation-delay:${index * 0.05}s">
      ${img}
      <div class="gift-card__body">
        <p class="gift-card__category">${gift.category}</p>
        <h3 class="gift-card__name">${gift.name}</h3>
        <p class="gift-card__desc">${gift.description || ''}</p>
        <div class="gift-card__footer">
          <span class="gift-card__price">${priceLabel}</span>
          ${qtyLabel ? `<span class="gift-card__qty">${qtyLabel}</span>` : ''}
        </div>
        <div style="margin-top:0.8rem;display:flex;justify-content:flex-end">${btn}</div>
      </div>
    </div>`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(id) {
  const gift = state.gifts.find(g => g.id === id);
  if (!gift) return;
  state.selectedGift = gift;
  state.selectedMethod = null;
  state.currentStep = 1;

  modalItemName.textContent = gift.name;
  modalItemPrice.textContent = gift.is_monetary
    ? `Contribuição a partir de R$ ${fmt(gift.price)}`
    : `R$ ${fmt(gift.price)}`;
  modalItemDesc.textContent = gift.description || '';

  if (gift.is_monetary) {
    monetaryAmountGroup.classList.remove('hidden');
    monetaryAmount.value = gift.price;
  } else {
    monetaryAmountGroup.classList.add('hidden');
  }

  deliveryBtns.forEach(b => b.classList.remove('selected'));
  step1Next.disabled = true;

  showStep(1);
  chooseModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  chooseModal.classList.add('hidden');
  document.body.style.overflow = '';
}

function showStep(n) {
  [step1, step2, step3].forEach(s => s.classList.add('hidden'));
  if (n === 1) step1.classList.remove('hidden');
  if (n === 2) step2.classList.remove('hidden');
  if (n === 3) step3.classList.remove('hidden');
  state.currentStep = n;
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  // Filter
  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentFilter = btn.dataset.cat;
    renderGifts();
  });

  // Close modal
  chooseModalClose.addEventListener('click', closeModal);
  chooseModal.addEventListener('click', e => {
    if (e.target === chooseModal) closeModal();
  });
  step3Close.addEventListener('click', closeModal);

  // Delivery selection
  deliveryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      deliveryBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      btn.querySelector('.delivery-icon').textContent = '';
      state.selectedMethod = btn.dataset.method;
      step1Next.disabled = false;
    });
  });

  // Step navigation
  step1Next.addEventListener('click', () => {
    document.getElementById('giverName').value = '';
    document.getElementById('giverMessage').value = '';
    showStep(2);
  });

  step2Back.addEventListener('click', () => showStep(1));

  step2Confirm.addEventListener('click', confirmGift);

  document.getElementById('copyPixKey').addEventListener('click', () => {
    const key = document.getElementById('pixKey').textContent;
    navigator.clipboard.writeText(key).catch(() => {});
    document.getElementById('copyPixKey').textContent = 'Copiado!';
    setTimeout(() => {
      document.getElementById('copyPixKey').textContent = 'Copiar chave Pix';
    }, 2000);
  });
}

// ─── Confirm ──────────────────────────────────────────────────────────────────
async function confirmGift() {
  const name = document.getElementById('giverName').value.trim();
  const message = document.getElementById('giverMessage').value.trim();

  if (!name) {
    document.getElementById('giverName').focus();
    document.getElementById('giverName').style.borderColor = '#c0392b';
    return;
  }
  document.getElementById('giverName').style.borderColor = '';

  const amount = state.selectedGift.is_monetary
    ? parseFloat(monetaryAmount.value) || state.selectedGift.price
    : state.selectedGift.price;

  step2Confirm.disabled = true;
  step2Confirm.textContent = 'Confirmando...';

  try {
    const res = await fetch('/api/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gift_item_id: state.selectedGift.id,
        giver_name: name,
        message,
        delivery_method: state.selectedMethod,
        pix_amount: amount,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');

    // Refresh catalog
    await loadGifts();

    // Show confirmation
    if (state.selectedMethod === 'wedding') {
      document.getElementById('step3Wedding').classList.remove('hidden');
      document.getElementById('step3Pix').classList.add('hidden');
      document.getElementById('confirmedName').textContent = name;
      const msgEl = document.getElementById('confirmedMessage');
      if (message) {
        msgEl.textContent = `"${message}"`;
        msgEl.classList.remove('hidden');
      } else {
        msgEl.classList.add('hidden');
      }
    } else {
      document.getElementById('step3Wedding').classList.add('hidden');
      document.getElementById('step3Pix').classList.remove('hidden');
      document.getElementById('confirmedNamePix').textContent = name;
      document.getElementById('pixAmount').textContent = `R$ ${fmt(amount)}`;
      document.getElementById('pixName').textContent = data.pix_name;
      document.getElementById('pixKey').textContent = data.pix_key;

      // Generate QR
      generateQR(amount, name);
    }

    showStep(3);
  } catch (e) {
    alert(e.message || 'Ocorreu um erro. Tente novamente.');
  } finally {
    step2Confirm.disabled = false;
    step2Confirm.textContent = 'Confirmar presente';
  }
}

async function generateQR(amount, name) {
  const qrEl = document.getElementById('pixQrCode');
  qrEl.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch('/api/pix-qrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, giver_name: name }),
    });
    const data = await res.json();
    qrEl.innerHTML = `<img src="${data.qrcode}" alt="QR Code Pix" />`;
  } catch {
    qrEl.innerHTML = '<p style="font-size:0.75rem;color:var(--text-light);text-align:center">QR indisponível</p>';
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
