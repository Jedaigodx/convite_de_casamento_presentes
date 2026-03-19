// ─── State ────────────────────────────────────────────────────────────────────
const state = { gifts: [], choices: [], editingId: null };

// ─── DOM ──────────────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const adminPanel = document.getElementById('adminPanel');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginError = document.getElementById('loginError');
const adminPassword = document.getElementById('adminPassword');

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/admin/check');
  const data = await res.json();
  if (data.logged_in) showPanel();

  loginBtn.addEventListener('click', doLogin);
  adminPassword.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  logoutBtn.addEventListener('click', doLogout);

  // Tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Gift modal
  document.getElementById('addGiftBtn').addEventListener('click', openAddGift);
  document.getElementById('giftModalClose').addEventListener('click', closeGiftModal);
  document.getElementById('giftModalCancel').addEventListener('click', closeGiftModal);
  document.getElementById('giftModalSave').addEventListener('click', saveGift);

  document.getElementById('choicesFilter').addEventListener('change', renderChoices);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const pwd = adminPassword.value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  });
  if (res.ok) {
    loginError.classList.add('hidden');
    showPanel();
  } else {
    loginError.classList.remove('hidden');
  }
}

async function doLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  adminPanel.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function showPanel() {
  loginScreen.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  loadDashboard();
  loadGifts();
  loadChoices();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const res = await fetch('/api/admin/stats');
  const s = await res.json();
  document.getElementById('stat-total').textContent = s.total_choices;
  document.getElementById('stat-confirmed').textContent = s.confirmed_choices;
  document.getElementById('stat-pix').textContent = `R$ ${fmt(s.total_pix_expected)}`;
  document.getElementById('stat-pix-confirmed').textContent = `R$ ${fmt(s.confirmed_pix)}`;

  // Recent choices (last 5)
  const recent = state.choices.slice(0, 5);
  renderChoiceCards(document.getElementById('recentChoices'), recent);
}

// ─── Gifts ────────────────────────────────────────────────────────────────────
async function loadGifts() {
  const res = await fetch('/api/admin/gifts');
  state.gifts = await res.json();
  renderGiftsTable();
}

function renderGiftsTable() {
  const tbody = document.getElementById('giftsTableBody');
  tbody.innerHTML = state.gifts.map(g => `
    <tr>
      <td>
        <span class="table-item-name">
          ${g.name}
          ${g.is_monetary ? '<small>Contribuição livre</small>' : ''}
        </span>
      </td>
      <td>${g.category}</td>
      <td>R$ ${fmt(g.price)}</td>
      <td>${g.is_monetary ? '∞' : g.max_quantity}</td>
      <td>${g.chosen_quantity}</td>
      <td><span class="${g.is_active ? 'active-badge' : 'inactive-badge'}">${g.is_active ? 'Ativo' : 'Inativo'}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn-edit" onclick="openEditGift(${g.id})">Editar</button>
          <button class="btn-delete" onclick="deleteGift(${g.id})">Remover</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ─── Choices ──────────────────────────────────────────────────────────────────
async function loadChoices() {
  const res = await fetch('/api/admin/choices');
  state.choices = await res.json();
  renderChoices();
  loadDashboard();
}

function renderChoices() {
  const filter = document.getElementById('choicesFilter')?.value || 'all';
  const list = filter === 'all' ? state.choices : state.choices.filter(c => c.status === filter);
  renderChoiceCards(document.getElementById('allChoices'), list);
}

function renderChoiceCards(container, choices) {
  if (!container) return;
  if (!choices.length) {
    container.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem;padding:1rem 0">Nenhuma escolha ainda.</p>';
    return;
  }
  container.innerHTML = choices.map(c => `
    <div class="choice-card">
      <div class="choice-card__info">
        <p class="choice-card__name">${c.giver_name}</p>
        <div class="choice-card__meta">
          <span>${c.gift_name}</span>
          <span class="delivery-tag">${c.delivery_method === 'pix' ? 'Pix' : 'No casamento'}</span>
          <span>${c.created_at}</span>
        </div>
        ${c.message ? `<p class="choice-card__message">"${c.message}"</p>` : ''}
      </div>
      <div class="choice-card__right">
        <span class="choice-card__price">R$ ${fmt(c.pix_amount || c.gift_price)}</span>
        <span class="status-badge status-badge--${c.status}">${c.status === 'confirmed' ? 'Confirmado' : 'Pendente'}</span>
        ${c.status === 'pending' ? `<button class="confirm-btn" onclick="confirmChoice(${c.id})">Confirmar</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function confirmChoice(id) {
  await fetch(`/api/admin/choices/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'confirmed' }),
  });
  await loadChoices();
}

// ─── Gift Modal ───────────────────────────────────────────────────────────────
function openAddGift() {
  state.editingId = null;
  document.getElementById('giftModalTitle').textContent = 'Novo Presente';
  document.getElementById('editGiftId').value = '';
  document.getElementById('giftName').value = '';
  document.getElementById('giftDescription').value = '';
  document.getElementById('giftPrice').value = '';
  document.getElementById('giftMaxQty').value = 1;
  document.getElementById('giftCategory').value = 'Geral';
  document.getElementById('giftImageUrl').value = '';
  document.getElementById('giftIsMonetary').checked = false;
  document.getElementById('giftIsActive').checked = true;
  document.getElementById('giftModal').classList.remove('hidden');
}

function openEditGift(id) {
  const g = state.gifts.find(x => x.id === id);
  if (!g) return;
  state.editingId = id;
  document.getElementById('giftModalTitle').textContent = 'Editar Presente';
  document.getElementById('editGiftId').value = g.id;
  document.getElementById('giftName').value = g.name;
  document.getElementById('giftDescription').value = g.description || '';
  document.getElementById('giftPrice').value = g.price;
  document.getElementById('giftMaxQty').value = g.max_quantity;
  document.getElementById('giftCategory').value = g.category;
  document.getElementById('giftImageUrl').value = g.image_url || '';
  document.getElementById('giftIsMonetary').checked = g.is_monetary;
  document.getElementById('giftIsActive').checked = g.is_active;
  document.getElementById('giftModal').classList.remove('hidden');
}

function closeGiftModal() {
  document.getElementById('giftModal').classList.add('hidden');
}

async function saveGift() {
  const id = state.editingId;
  const payload = {
    name: document.getElementById('giftName').value.trim(),
    description: document.getElementById('giftDescription').value.trim(),
    price: parseFloat(document.getElementById('giftPrice').value),
    max_quantity: parseInt(document.getElementById('giftMaxQty').value),
    category: document.getElementById('giftCategory').value,
    image_url: document.getElementById('giftImageUrl').value.trim(),
    is_monetary: document.getElementById('giftIsMonetary').checked,
    is_active: document.getElementById('giftIsActive').checked,
  };

  if (!payload.name || isNaN(payload.price)) {
    alert('Preencha nome e valor.');
    return;
  }

  const url = id ? `/api/admin/gifts/${id}` : '/api/admin/gifts';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    closeGiftModal();
    await loadGifts();
  } else {
    alert('Erro ao salvar.');
  }
}

async function deleteGift(id) {
  if (!confirm('Remover este item do catálogo?')) return;
  await fetch(`/api/admin/gifts/${id}`, { method: 'DELETE' });
  await loadGifts();
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
