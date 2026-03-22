// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  items: [],
  selected: null,
  amount: 0,
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const catalogGrid    = document.getElementById('catalogGrid');
const catalogLoading = document.getElementById('catalogLoading');
const catalogEmpty   = document.getElementById('catalogEmpty');
const modal          = document.getElementById('modal');
const modalClose     = document.getElementById('modalClose');

const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadItems();
  bindEvents();
}

// ─── Load ─────────────────────────────────────────────────────────────────────
async function loadItems() {
  try {
    const res   = await fetch('/api/items');
    state.items = await res.json();
    renderAll();
  } catch {
    catalogLoading.innerHTML = '<p style="color:var(--text-light)">Erro ao carregar. Tente novamente.</p>';
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  catalogLoading.classList.add('hidden');
  updateBanner();

  if (!state.items.length) {
    catalogEmpty.classList.remove('hidden');
    return;
  }

  catalogGrid.innerHTML = state.items.map((item, i) => buildCard(item, i)).join('');
  catalogGrid.querySelectorAll('.travel-card:not(.travel-card--complete)').forEach(card => {
    card.addEventListener('click', () => openModal(+card.dataset.id));
  });
}

function updateBanner() {
  const totalGoal   = state.items.reduce((s, i) => s + i.goal_amount, 0);
  const totalRaised = state.items.reduce((s, i) => s + i.raised_amount, 0);
  const pct         = totalGoal > 0 ? Math.min(100, (totalRaised / totalGoal * 100).toFixed(1)) : 0;

  document.getElementById('bannerValues').textContent =
    `R$ ${fmt(totalRaised)} de R$ ${fmt(totalGoal)}`;
  document.getElementById('bannerFill').style.width  = pct + '%';
  document.getElementById('bannerPct').textContent   = pct + '%';
}

function buildCard(item, index) {
  const pct = item.progress_pct;
  const img = item.image_url
    ? `<img class="travel-card__img" src="${item.image_url}" alt="${item.name}" loading="lazy" />`
    : `<div class="travel-card__img-placeholder">✈</div>`;

  const completeBadge = item.is_complete
    ? `<span class="travel-card__complete-badge">Meta atingida</span>` : '';
  const btn = item.is_complete
    ? `<button class="travel-card__btn travel-card__btn--complete" disabled>Meta atingida</button>`
    : `<button class="travel-card__btn">Contribuir</button>`;

  return `
    <div class="travel-card ${item.is_complete ? 'travel-card--complete' : ''}"
         data-id="${item.id}" style="animation-delay:${index * 0.07}s">
      <div class="travel-card__img-wrap">
        ${img}
        <span class="travel-card__category-badge">${item.category}</span>
        ${completeBadge}
      </div>
      <div class="travel-card__body">
        <h3 class="travel-card__name">${item.name}</h3>
        <p class="travel-card__desc">${item.description || ''}</p>
        <div class="card-progress">
          <div class="card-progress__header">
            <span class="card-progress__raised">R$ ${fmt(item.raised_amount)}</span>
            <span class="card-progress__goal">meta R$ ${fmt(item.goal_amount)}</span>
          </div>
          <div class="card-progress__track">
            <div class="card-progress__fill" style="width:${pct}%"></div>
          </div>
          <p class="card-progress__pct">${pct}% arrecadado</p>
        </div>
        ${btn}
      </div>
    </div>`;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  state.selected = item;
  state.amount   = 0;

  // Step 1 setup
  document.getElementById('s1Name').textContent = item.name;

  const fill = document.getElementById('s1Fill');
  fill.style.width = item.progress_pct + '%';
  document.getElementById('s1ProgressText').textContent =
    `R$ ${fmt(item.raised_amount)} arrecadado de R$ ${fmt(item.goal_amount)} (${item.progress_pct}%)`;

  // Suggestion chips based on goal
  buildChips(item.goal_amount);

  // Reset
  document.getElementById('amountInput').value = '';
  document.getElementById('step1Next').disabled = true;
  document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));

  showStep(1);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function buildChips(goal) {
  const suggestions = getSuggestions(goal);
  const wrap = document.getElementById('amountSuggestions');
  wrap.innerHTML = suggestions.map(v =>
    `<button class="amount-chip" data-value="${v}">R$ ${fmt(v)}</button>`
  ).join('');
  wrap.querySelectorAll('.amount-chip').forEach(btn => {
    btn.addEventListener('click', () => selectChip(btn, +btn.dataset.value));
  });
}

function getSuggestions(goal) {
  if (goal <= 100)  return [10, 20, 50, goal];
  if (goal <= 300)  return [20, 50, 100, goal];
  if (goal <= 600)  return [50, 100, 200, goal];
  if (goal <= 1000) return [50, 100, 250, goal];
  return [100, 200, 500, goal];
}

function selectChip(btn, value) {
  document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('amountInput').value = '';
  state.amount = value;
  document.getElementById('step1Next').disabled = false;
}

function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function showStep(n) {
  [step1, step2, step3].forEach(s => s.classList.add('hidden'));
  [step1, step2, step3][n - 1].classList.remove('hidden');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.getElementById('step3Close').addEventListener('click', closeModal);

  // Amount input
  document.getElementById('amountInput').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
    if (v >= 1) {
      state.amount = v;
      document.getElementById('step1Next').disabled = false;
    } else {
      state.amount = 0;
      document.getElementById('step1Next').disabled = true;
    }
  });

  document.getElementById('step1Next').addEventListener('click', () => {
    document.getElementById('giverName').value    = '';
    document.getElementById('giverMessage').value = '';
    document.getElementById('giverName').style.borderColor = '';
    showStep(2);
  });

  document.getElementById('step2Back').addEventListener('click', () => showStep(1));
  document.getElementById('step2Confirm').addEventListener('click', confirm);

  document.getElementById('copyPixKey').addEventListener('click', () => {
    const key = document.getElementById('s3PixKey').textContent;
    navigator.clipboard.writeText(key).catch(() => {});
    const btn = document.getElementById('copyPixKey');
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar chave Pix'; }, 2000);
  });
}

// ─── Confirm ──────────────────────────────────────────────────────────────────
async function confirm() {
  const name    = document.getElementById('giverName').value.trim();
  const message = document.getElementById('giverMessage').value.trim();

  if (!name) {
    document.getElementById('giverName').focus();
    document.getElementById('giverName').style.borderColor = '#c0392b';
    return;
  }
  document.getElementById('giverName').style.borderColor = '';

  const btn = document.getElementById('step2Confirm');
  btn.disabled    = true;
  btn.textContent = 'Confirmando...';

  try {
    const res  = await fetch('/api/contribute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        travel_item_id: state.selected.id,
        giver_name:     name,
        message,
        amount:         state.amount,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');

    // Reload items in background to update progress bars
    loadItems();

    // Step 3
    document.getElementById('s3Name').textContent    = name;
    document.getElementById('s3Amount').textContent  = `R$ ${fmt(state.amount)}`;
    document.getElementById('s3PixName').textContent = data.pix_name;
    document.getElementById('s3PixKey').textContent  = data.pix_key;

    if (message) {
      document.getElementById('s3Message').textContent = `"${message}"`;
      document.getElementById('s3MessageWrap').classList.remove('hidden');
    } else {
      document.getElementById('s3MessageWrap').classList.add('hidden');
    }

    generateQR(state.amount);
    showStep(3);
  } catch (e) {
    alert(e.message || 'Ocorreu um erro. Tente novamente.');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Confirmar';
  }
}

async function generateQR(amount) {
  const qrEl = document.getElementById('pixQr');
  qrEl.innerHTML = '<div class="spinner"></div>';
  try {
    const res  = await fetch('/api/pix-qrcode', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount }),
    });
    const data = await res.json();
    qrEl.innerHTML = `<img src="${data.qrcode}" alt="QR Code Pix" />`;
  } catch {
    qrEl.innerHTML = '<p style="font-size:.75rem;color:var(--text-light);text-align:center">QR indisponível</p>';
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
