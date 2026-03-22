// ─── Token ────────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'tv_admin_token';
const getToken  = () => localStorage.getItem(TOKEN_KEY) || '';
const setToken  = t  => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': getToken(),
      ...(options.headers || {}),
    },
  });
  return res;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = { items: [], contributions: [] };

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (getToken()) {
    const res  = await fetch('/api/admin/check', { headers: { 'X-Admin-Token': getToken() } });
    const data = await res.json();
    if (data.logged_in) { showPanel(); return; }
    clearToken();
  }
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Entrando...';
  btn.disabled    = true;
  try {
    const res  = await fetch('/api/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: document.getElementById('adminPassword').value }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      setToken(data.token);
      document.getElementById('loginError').classList.add('hidden');
      showPanel();
    } else {
      document.getElementById('loginError').textContent = data.error || 'Senha incorreta.';
      document.getElementById('loginError').classList.remove('hidden');
    }
  } catch {
    document.getElementById('loginError').textContent = 'Erro de conexão.';
    document.getElementById('loginError').classList.remove('hidden');
  } finally {
    btn.textContent = 'Entrar';
    btn.disabled    = false;
  }
}

function showPanel() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');

  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken();
    location.reload();
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Item modal
  document.getElementById('addItemBtn').addEventListener('click', openAddItem);
  document.getElementById('itemModalClose').addEventListener('click', closeItemModal);
  document.getElementById('itemModalCancel').addEventListener('click', closeItemModal);
  document.getElementById('itemModalSave').addEventListener('click', saveItem);

  // Upload
  document.getElementById('chooseFileBtn').addEventListener('click', () => {
    document.getElementById('imageFile').click();
  });
  document.getElementById('uploadPreview').addEventListener('click', () => {
    document.getElementById('imageFile').click();
  });
  document.getElementById('imageFile').addEventListener('change', handleFileChange);

  // Contributions filter
  document.getElementById('contribFilter').addEventListener('change', renderContributions);

  loadAll();
}

async function loadAll() {
  await Promise.all([loadItems(), loadContributions()]);
  loadStats();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ─── Stats / Dashboard ────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await api('/api/admin/stats');
    const s   = await res.json();

    document.getElementById('stat-raised').textContent        = `R$ ${fmt(s.total_raised)}`;
    document.getElementById('stat-confirmed-val').textContent = `R$ ${fmt(s.confirmed_raised)}`;
    document.getElementById('stat-goal').textContent          = `R$ ${fmt(s.total_goal)}`;
    document.getElementById('stat-contribs').textContent      = s.total_contribs;

    // Overall bar
    document.getElementById('overallPct').textContent      = s.progress_pct + '%';
    document.getElementById('overallFill').style.width     = s.progress_pct + '%';
    document.getElementById('overallCaption').textContent  =
      `R$ ${fmt(s.total_raised)} arrecadado de R$ ${fmt(s.total_goal)}`;

    // Per-item list
    const listEl = document.getElementById('itemsProgressList');
    listEl.innerHTML = (s.items_stats || []).map(item => `
      <div class="item-progress-row">
        <div class="item-progress-row__header">
          <span class="item-progress-row__name">${item.name}</span>
          <span class="item-progress-row__values">
            <strong>R$ ${fmt(item.raised_amount)}</strong> de R$ ${fmt(item.goal_amount)}
            &nbsp;·&nbsp; ${item.progress_pct}%
          </span>
        </div>
        <div class="item-progress-row__track">
          <div class="item-progress-row__fill" style="width:${item.progress_pct}%"></div>
        </div>
      </div>
    `).join('');

  } catch (e) {
    console.error('Stats error:', e);
  }

  // Recent contributions
  renderContribCards(document.getElementById('recentContribs'), state.contributions.slice(0, 6));
}

// ─── Items ────────────────────────────────────────────────────────────────────
async function loadItems() {
  const res    = await api('/api/admin/items');
  state.items  = await res.json();
  if (!Array.isArray(state.items)) state.items = [];
  renderAdminItems();
}

function renderAdminItems() {
  const grid = document.getElementById('adminItemsGrid');
  if (!state.items.length) {
    grid.innerHTML = `<p style="color:var(--text-light);font-size:.85rem;padding:1rem 0">
      Nenhuma experiência cadastrada ainda. Clique em "+ Nova experiência" para começar.</p>`;
    return;
  }
  grid.innerHTML = state.items.map(item => `
    <div class="admin-item-card">
      ${item.image_url
        ? `<img class="admin-item-card__img" src="${item.image_url}" alt="${item.name}" />`
        : `<div class="admin-item-card__img-placeholder">✈</div>`}
      <div class="admin-item-card__body">
        <p class="admin-item-card__name">${item.name}</p>
        <p class="admin-item-card__meta">
          R$ ${fmt(item.raised_amount)} de R$ ${fmt(item.goal_amount)} · ${item.progress_pct}%
          ${!item.is_active ? ' · <span class="inactive-tag">Inativo</span>' : ''}
        </p>
        <div class="admin-item-card__progress">
          <div class="admin-item-card__progress-fill" style="width:${item.progress_pct}%"></div>
        </div>
        <div class="admin-item-card__actions">
          <button class="btn-edit"   onclick="openEditItem(${item.id})">Editar</button>
          <button class="btn-delete" onclick="deleteItem(${item.id})">Remover</button>
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Contributions ────────────────────────────────────────────────────────────
async function loadContributions() {
  const res            = await api('/api/admin/contributions');
  state.contributions  = await res.json();
  if (!Array.isArray(state.contributions)) state.contributions = [];
  renderContributions();
}

function renderContributions() {
  const filter = document.getElementById('contribFilter')?.value || 'all';
  const list   = filter === 'all'
    ? state.contributions
    : state.contributions.filter(c => c.status === filter);
  renderContribCards(document.getElementById('allContribs'), list);
}

function renderContribCards(container, contribs) {
  if (!container) return;
  if (!contribs || !contribs.length) {
    container.innerHTML = '<p style="color:var(--text-light);font-size:.85rem;padding:1rem 0">Nenhuma contribuição ainda.</p>';
    return;
  }
  container.innerHTML = contribs.map(c => `
    <div class="contrib-card">
      <div class="contrib-card__info">
        <p class="contrib-card__name">${c.giver_name}</p>
        <div class="contrib-card__meta">
          <span>${c.item_name}</span>
          <span>${c.created_at}</span>
        </div>
        ${c.message ? `<p class="contrib-card__message">"${c.message}"</p>` : ''}
      </div>
      <div class="contrib-card__right">
        <span class="contrib-card__amount">R$ ${fmt(c.amount)}</span>
        <span class="status-badge status-badge--${c.status}">
          ${c.status === 'confirmed' ? 'Confirmado' : 'Pendente'}
        </span>
        ${c.status === 'pending'
          ? `<button class="confirm-btn" onclick="confirmContrib(${c.id})">Confirmar</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

async function confirmContrib(id) {
  await api(`/api/admin/contributions/${id}/status`, {
    method: 'PUT',
    body:   JSON.stringify({ status: 'confirmed' }),
  });
  await loadContributions();
  loadStats();
}

// ─── Item Modal ───────────────────────────────────────────────────────────────
let uploadedUrl = '';

function resetUpload() {
  uploadedUrl = '';
  document.getElementById('itemImageUrl').value = '';
  document.getElementById('uploadImg').classList.add('hidden');
  document.getElementById('uploadImg').src = '';
  document.getElementById('uploadPlaceholder').classList.remove('hidden');
  document.getElementById('uploadStatus').textContent = '';
  document.getElementById('uploadStatus').className   = 'upload-status';
  document.getElementById('imageFile').value = '';
}

function openAddItem() {
  document.getElementById('itemModalTitle').textContent = 'Nova Experiência';
  document.getElementById('editItemId').value      = '';
  document.getElementById('itemName').value        = '';
  document.getElementById('itemDescription').value = '';
  document.getElementById('itemGoal').value        = '';
  document.getElementById('itemCategory').value    = 'Passeio';
  document.getElementById('itemOrder').value       = 0;
  document.getElementById('itemIsActive').checked  = true;
  resetUpload();
  document.getElementById('itemModal').classList.remove('hidden');
}

function openEditItem(id) {
  const item = state.items.find(x => x.id === id);
  if (!item) return;
  document.getElementById('itemModalTitle').textContent = 'Editar Experiência';
  document.getElementById('editItemId').value      = item.id;
  document.getElementById('itemName').value        = item.name;
  document.getElementById('itemDescription').value = item.description || '';
  document.getElementById('itemGoal').value        = item.goal_amount;
  document.getElementById('itemCategory').value    = item.category;
  document.getElementById('itemOrder').value       = item.display_order;
  document.getElementById('itemIsActive').checked  = item.is_active;

  resetUpload();
  if (item.image_url) {
    uploadedUrl = item.image_url;
    document.getElementById('itemImageUrl').value = item.image_url;
    document.getElementById('uploadImg').src      = item.image_url;
    document.getElementById('uploadImg').classList.remove('hidden');
    document.getElementById('uploadPlaceholder').classList.add('hidden');
    document.getElementById('uploadStatus').textContent = 'Foto atual';
    document.getElementById('uploadStatus').className   = 'upload-status upload-status--ok';
  }

  document.getElementById('itemModal').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('itemModal').classList.add('hidden');
}

// ─── File Upload ──────────────────────────────────────────────────────────────
async function handleFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const status = document.getElementById('uploadStatus');
  status.textContent = 'Enviando...';
  status.className   = 'upload-status';

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res  = await fetch('/api/admin/upload', {
      method:  'POST',
      headers: { 'X-Admin-Token': getToken() },
      body:    formData,
    });
    const data = await res.json();

    if (res.ok && data.url) {
      uploadedUrl = data.url;
      document.getElementById('itemImageUrl').value = data.url;
      document.getElementById('uploadImg').src      = data.url;
      document.getElementById('uploadImg').classList.remove('hidden');
      document.getElementById('uploadPlaceholder').classList.add('hidden');
      status.textContent = 'Foto enviada com sucesso';
      status.className   = 'upload-status upload-status--ok';
    } else {
      status.textContent = data.error || 'Erro ao enviar';
      status.className   = 'upload-status upload-status--error';
    }
  } catch {
    status.textContent = 'Erro de conexão';
    status.className   = 'upload-status upload-status--error';
  }
}

async function saveItem() {
  const id = document.getElementById('editItemId').value;
  const payload = {
    name:          document.getElementById('itemName').value.trim(),
    description:   document.getElementById('itemDescription').value.trim(),
    goal_amount:   parseFloat(document.getElementById('itemGoal').value),
    image_url:     uploadedUrl || document.getElementById('itemImageUrl').value.trim(),
    category:      document.getElementById('itemCategory').value,
    display_order: parseInt(document.getElementById('itemOrder').value) || 0,
    is_active:     document.getElementById('itemIsActive').checked,
  };

  if (!payload.name || isNaN(payload.goal_amount) || payload.goal_amount < 1) {
    alert('Preencha nome e meta.');
    return;
  }

  const btn = document.getElementById('itemModalSave');
  btn.textContent = 'Salvando...';
  btn.disabled    = true;

  try {
    const url    = id ? `/api/admin/items/${id}` : '/api/admin/items';
    const method = id ? 'PUT' : 'POST';
    const res    = await api(url, { method, body: JSON.stringify(payload) });

    if (res.ok) {
      closeItemModal();
      await loadItems();
      loadStats();
    } else {
      const err = await res.json();
      alert(err.error || 'Erro ao salvar.');
    }
  } catch {
    alert('Erro de conexão.');
  } finally {
    btn.textContent = 'Salvar experiência';
    btn.disabled    = false;
  }
}

async function deleteItem(id) {
  if (!confirm('Remover esta experiência?')) return;
  await api(`/api/admin/items/${id}`, { method: 'DELETE' });
  await loadItems();
  loadStats();
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
