// ─── State ────────────────────────────────────────────────────────────────────
const state = { items: [], selected: null, amount: 0 };

// ─── Safe text helpers (no XSS) ──────────────────────────────────────────────
function setText(el, text) {
  el.textContent = text;
}
function setHTML(el, html) {
  // Only used for structure we build ourselves — never for user-supplied strings
  el.innerHTML = html;
}
// Safely set user-supplied text content into an element
function safeNode(tag, text, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadItems();
  bindEvents();
}

async function loadItems() {
  try {
    const res   = await fetch('/api/items');
    if (!res.ok) throw new Error('network');
    state.items = await res.json();
    if (!Array.isArray(state.items)) state.items = [];
    render();
  } catch {
    document.getElementById('catalogLoading').innerHTML =
      '<p style="color:var(--text-light)">Erro ao carregar. Recarregue a página.</p>';
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const loading = document.getElementById('catalogLoading');
  const root    = document.getElementById('catalogRoot');
  const empty   = document.getElementById('catalogEmpty');

  loading.classList.add('hidden');
  root.innerHTML = '';

  if (!state.items.length) {
    empty.classList.remove('hidden');
    return;
  }

  state.items.forEach((item, idx) => {
    if (idx > 0) root.appendChild(document.createElement('hr')).className = 'catalog-separator';
    root.appendChild(buildRootSection(item, idx));
  });
}

// ─── Featured root card ───────────────────────────────────────────────────────
function buildRootSection(item, idx) {
  const section = document.createElement('section');
  section.className = 'featured-section';

  // Card
  const card = document.createElement('div');
  card.className = `featured-card${item.is_complete ? ' featured-card--complete' : ''}`;
  card.style.animationDelay = `${idx * 0.1}s`;
  if (!item.is_complete) {
    card.addEventListener('click', () => openModal(item.id));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
  }

  // Image side
  const imgWrap = document.createElement('div');
  imgWrap.className = 'featured-card__img-wrap';
  if (item.image_url) {
    const img = document.createElement('img');
    img.className = 'featured-card__img';
    img.src       = item.image_url;
    img.alt       = item.name;
    img.loading   = 'lazy';
    imgWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'featured-card__img-placeholder';
    ph.textContent = '✈';
    imgWrap.appendChild(ph);
  }
  const badge = safeNode('span', 'Destino Principal', 'featured-card__badge');
  imgWrap.appendChild(badge);
  card.appendChild(imgWrap);

  // Body side
  const body = document.createElement('div');
  body.className = 'featured-card__body';

  body.appendChild(safeNode('p', item.category, 'featured-card__eyebrow'));
  body.appendChild(safeNode('h3', item.name, 'featured-card__name'));
  if (item.description) body.appendChild(safeNode('p', item.description, 'featured-card__desc'));

  // Progress
  const prog = buildFeaturedProgress(item);
  body.appendChild(prog);

  // Button
  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = item.is_complete ? 'Meta atingida' : 'Contribuir para esta viagem';
  if (item.is_complete) btn.disabled = true;
  else btn.addEventListener('click', e => { e.stopPropagation(); openModal(item.id); });
  body.appendChild(btn);

  card.appendChild(body);
  section.appendChild(card);

  // Sub-items
  if (item.children && item.children.length) {
    const subSection = document.createElement('div');
    subSection.className = 'sub-section';
    subSection.style.marginTop = '1.5rem';

    const subTitle = document.createElement('p');
    subTitle.className = 'sub-section__title';
    subTitle.textContent = 'Experiências incluídas na viagem';
    subSection.appendChild(subTitle);

    const grid = document.createElement('div');
    grid.className = 'sub-grid';
    item.children.forEach((child, ci) => {
      grid.appendChild(buildSubCard(child, ci));
    });
    subSection.appendChild(grid);
    section.appendChild(subSection);
  }

  return section;
}

function buildFeaturedProgress(item) {
  const wrap = document.createElement('div');
  wrap.className = 'featured-progress';

  const header = document.createElement('div');
  header.className = 'featured-progress__header';
  header.appendChild(safeNode('span', `R$ ${fmt(item.raised_amount)}`, 'featured-progress__raised'));
  header.appendChild(safeNode('span', `meta R$ ${fmt(item.goal_amount)}`, 'featured-progress__goal'));
  wrap.appendChild(header);

  const track = document.createElement('div');
  track.className = 'featured-progress__track';
  const fill = document.createElement('div');
  fill.className = 'featured-progress__fill';
  fill.style.width = item.progress_pct + '%';
  track.appendChild(fill);
  wrap.appendChild(track);

  wrap.appendChild(safeNode('p', `${item.progress_pct}% arrecadado`, 'featured-progress__pct'));
  return wrap;
}

// ─── Sub-item card ────────────────────────────────────────────────────────────
function buildSubCard(item, idx) {
  const card = document.createElement('div');
  card.className = `travel-card${item.is_complete ? ' travel-card--complete' : ''}`;
  card.style.animationDelay = `${idx * 0.07}s`;
  if (!item.is_complete) {
    card.addEventListener('click', () => openModal(item.id));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
  }

  // Image
  const imgWrap = document.createElement('div');
  imgWrap.className = 'travel-card__img-wrap';
  if (item.image_url) {
    const img = document.createElement('img');
    img.className = 'travel-card__img';
    img.src = item.image_url;
    img.alt = item.name;
    img.loading = 'lazy';
    imgWrap.appendChild(img);
  } else {
    imgWrap.appendChild(safeNode('div', '✈', 'travel-card__img-placeholder'));
  }
  imgWrap.appendChild(safeNode('span', item.category, 'travel-card__cat-badge'));
  if (item.is_complete) imgWrap.appendChild(safeNode('span', 'Meta atingida', 'travel-card__complete-badge'));
  card.appendChild(imgWrap);

  // Body
  const body = document.createElement('div');
  body.className = 'travel-card__body';
  body.appendChild(safeNode('h4', item.name, 'travel-card__name'));
  if (item.description) body.appendChild(safeNode('p', item.description, 'travel-card__desc'));

  body.appendChild(buildCardProgress(item));

  const btn = document.createElement('button');
  btn.className = `travel-card__btn${item.is_complete ? ' travel-card__btn--complete' : ''}`;
  btn.textContent = item.is_complete ? 'Meta atingida' : 'Contribuir';
  if (item.is_complete) btn.disabled = true;
  else btn.addEventListener('click', e => { e.stopPropagation(); openModal(item.id); });
  body.appendChild(btn);

  card.appendChild(body);
  return card;
}

function buildCardProgress(item) {
  const wrap = document.createElement('div');
  wrap.className = 'card-progress';

  const header = document.createElement('div');
  header.className = 'card-progress__header';
  header.appendChild(safeNode('span', `R$ ${fmt(item.raised_amount)}`, 'card-progress__raised'));
  header.appendChild(safeNode('span', `meta R$ ${fmt(item.goal_amount)}`, 'card-progress__goal'));
  wrap.appendChild(header);

  const track = document.createElement('div');
  track.className = 'card-progress__track';
  const fill = document.createElement('div');
  fill.className = 'card-progress__fill';
  fill.style.width = item.progress_pct + '%';
  track.appendChild(fill);
  wrap.appendChild(track);

  wrap.appendChild(safeNode('p', `${item.progress_pct}% arrecadado`, 'card-progress__pct'));
  return wrap;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function findItem(id) {
  for (const root of state.items) {
    if (root.id === id) return root;
    if (root.children) {
      const child = root.children.find(c => c.id === id);
      if (child) return child;
    }
  }
  return null;
}

function openModal(id) {
  const item = findItem(id);
  if (!item) return;
  state.selected = item;
  state.amount   = 0;

  setText(document.getElementById('s1Name'), item.name);
  document.getElementById('s1Fill').style.width = item.progress_pct + '%';
  setText(document.getElementById('s1ProgressText'),
    `R$ ${fmt(item.raised_amount)} arrecadado de R$ ${fmt(item.goal_amount)} (${item.progress_pct}%)`);

  buildChips(item.goal_amount);
  document.getElementById('amountInput').value     = '';
  document.getElementById('step1Next').disabled    = true;
  document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));

  showStep(1);
  document.getElementById('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function buildChips(goal) {
  const suggestions = getSuggestions(goal);
  const wrap = document.getElementById('amountSuggestions');
  wrap.innerHTML = '';
  suggestions.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'amount-chip';
    btn.textContent = `R$ ${fmt(v)}`;
    btn.dataset.value = v;
    btn.addEventListener('click', () => selectChip(btn, v));
    wrap.appendChild(btn);
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
  document.getElementById('modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function showStep(n) {
  ['step1','step2','step3'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(`step${n}`).classList.remove('hidden');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });
  document.getElementById('step3Close').addEventListener('click', closeModal);

  document.getElementById('amountInput').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
    if (v >= 1 && v <= 50000) {
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
  const nameInput = document.getElementById('giverName');
  const name      = nameInput.value.trim().slice(0, 200);
  const message   = document.getElementById('giverMessage').value.trim().slice(0, 500);

  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#c0392b';
    return;
  }
  nameInput.style.borderColor = '';

  if (!state.amount || state.amount < 1) {
    showStep(1);
    return;
  }

  const btn = document.getElementById('step2Confirm');
  btn.disabled    = true;
  btn.textContent = 'Confirmando...';

  try {
    const res = await fetch('/api/contribute', {
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

    // Refresh in background
    loadItems();

    // Populate step 3 using textContent (no XSS risk)
    setText(document.getElementById('s3Name'),    name);
    setText(document.getElementById('s3Amount'),  `R$ ${fmt(state.amount)}`);
    setText(document.getElementById('s3PixName'), data.pix_name);
    setText(document.getElementById('s3PixKey'),  data.pix_key);

    const msgWrap = document.getElementById('s3MessageWrap');
    if (message) {
      setText(document.getElementById('s3Message'), `"${message}"`);
      msgWrap.classList.remove('hidden');
    } else {
      msgWrap.classList.add('hidden');
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
    const img  = document.createElement('img');
    img.alt    = 'QR Code Pix';
    img.src    = data.qrcode;      // data: URI — safe
    qrEl.innerHTML = '';
    qrEl.appendChild(img);
  } catch {
    qrEl.textContent = 'QR indisponível';
    qrEl.style.fontSize = '.75rem';
    qrEl.style.color    = 'var(--text-light)';
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
