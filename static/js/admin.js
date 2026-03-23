// ── Token ───────────────────────────────────────────────────────────────────────
const getToken  = () => localStorage.getItem('tv_admin_token') || '';
const setToken  = t  => localStorage.setItem('tv_admin_token', t);
const clearToken = () => localStorage.removeItem('tv_admin_token');

async function api(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type':'application/json', 'X-Admin-Token': getToken(), ...(opts.headers||{}) }
  });
}

// ── State ───────────────────────────────────────────────────────────────────────
const ST = { items:[], contribs:[] };
let uploadedImages = [];   // array of /static/uploads/xxx.jpg

// ── Init ────────────────────────────────────────────────────────────────────────
async function init() {
  if (getToken()) {
    const r = await fetch('/api/admin/check', { headers:{'X-Admin-Token':getToken()} });
    const d = await r.json();
    if (d.logged_in) { showPanel(); return; }
    clearToken();
  }
  $id('loginBtn').addEventListener('click', doLogin);
  $id('adminPassword').addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });
}

function $id(id) { return document.getElementById(id); }

// ── Auth ────────────────────────────────────────────────────────────────────────
async function doLogin() {
  const btn = $id('loginBtn');
  btn.textContent = 'Entrando...'; btn.disabled = true;
  try {
    const r = await fetch('/api/admin/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: $id('adminPassword').value })
    });
    const d = await r.json();
    if (r.ok && d.token) { setToken(d.token); $id('loginError').classList.add('hidden'); showPanel(); }
    else { $id('loginError').textContent = d.error||'Senha incorreta.'; $id('loginError').classList.remove('hidden'); }
  } catch { $id('loginError').textContent='Erro de conexão.'; $id('loginError').classList.remove('hidden'); }
  finally { btn.textContent='Entrar'; btn.disabled=false; }
}

function showPanel() {
  $id('loginScreen').classList.add('hidden');
  $id('adminPanel').classList.remove('hidden');

  $id('logoutBtn').addEventListener('click', () => { clearToken(); location.reload(); });

  // Tabs
  document.querySelectorAll('.nav-item').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab))
  );

  // Item modal buttons
  $id('addItemBtn').addEventListener('click', openAddItem);
  $id('itemModalClose').addEventListener('click', closeItemModal);
  $id('itemModalCancel').addEventListener('click', closeItemModal);
  $id('itemModalSave').addEventListener('click', saveItem);

  // Upload
  $id('chooseFileBtn').addEventListener('click', () => $id('imageFile').click());
  $id('uploadPreview').addEventListener('click', () => $id('imageFile').click());
  $id('imageFile').addEventListener('change', handleFiles);

  // Contributions filter
  $id('contribFilter').addEventListener('change', renderContribs);

  // ── Event delegation for dynamically rendered buttons ──────────────────────
  // Items grid: edit / delete buttons
  $id('adminItemsGrid').addEventListener('click', e => {
    const editBtn   = e.target.closest('[data-action="edit-item"]');
    const deleteBtn = e.target.closest('[data-action="delete-item"]');
    if (editBtn)   openEditItem(+editBtn.dataset.id);
    if (deleteBtn) deleteItem(+deleteBtn.dataset.id);
  });

  // Contributions list: confirm button
  $id('allContribs').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="confirm-contrib"]');
    if (btn) confirmContrib(+btn.dataset.id);
  });
  $id('recentContribs').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="confirm-contrib"]');
    if (btn) confirmContrib(+btn.dataset.id);
  });

  loadAll();
}

// ── Tabs ─────────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  $id(`tab-${tab}`).classList.add('active');
}

// ── Load ─────────────────────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadItems(), loadContribs()]);
  loadStats();
}

async function loadItems() {
  const r = await api('/api/admin/items');
  const d = await r.json();
  ST.items = Array.isArray(d) ? d : [];
  renderItems();
}

async function loadContribs() {
  const r = await api('/api/admin/contributions');
  const d = await r.json();
  ST.contribs = Array.isArray(d) ? d : [];
  renderContribs();
}

// ── Stats ─────────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await api('/api/admin/stats');
    const s = await r.json();
    $id('stat-raised').textContent        = `R$ ${fmt(s.total_raised)}`;
    $id('stat-confirmed-val').textContent = `R$ ${fmt(s.confirmed_raised)}`;
    $id('stat-goal').textContent          = `R$ ${fmt(s.total_goal)}`;
    $id('stat-contribs').textContent      = s.total_contribs;
    $id('overallPct').textContent         = s.progress_pct + '%';
    $id('overallFill').style.width        = s.progress_pct + '%';
    $id('overallCaption').textContent     = `R$ ${fmt(s.total_raised)} arrecadado de R$ ${fmt(s.total_goal)}`;

    const list = $id('itemsProgressList');
    list.innerHTML = (s.items_stats||[]).map(item => `
      <div class="item-progress-row${item.parent_id ? ' item-progress-row--child' : ''}">
        <div class="item-progress-row__header">
          <span class="item-progress-row__name">${esc(item.name)}</span>
          <span class="item-progress-row__values"><strong>R$ ${fmt(item.raised_amount)}</strong> de R$ ${fmt(item.goal_amount)} · ${item.progress_pct}%</span>
        </div>
        <div class="item-progress-row__track">
          <div class="item-progress-row__fill" style="width:${item.progress_pct}%"></div>
        </div>
      </div>`).join('');
  } catch(e) { console.error('Stats:', e); }

  renderContribCards($id('recentContribs'), ST.contribs.slice(0,6));
}

// ── Items ─────────────────────────────────────────────────────────────────────────
function renderItems() {
  const grid = $id('adminItemsGrid');
  if (!ST.items.length) {
    grid.innerHTML = '<p style="color:var(--text-light);font-size:.85rem;padding:1rem 0">Nenhuma experiência cadastrada. Clique em "+ Nova experiência".</p>';
    return;
  }
  // Build lookup for parent names
  const nameById = {};
  ST.items.forEach(i => { nameById[i.id] = i.name; });

  grid.innerHTML = ST.items.map(item => {
    const imgs  = item.images || [];
    const thumb = imgs[0] ? `<img class="admin-item-card__img" src="${esc(imgs[0])}" alt="${esc(item.name)}"/>` : `<div class="admin-item-card__img-placeholder">✈</div>`;
    const parentLabel = item.parent_id ? `<span class="admin-item-card__label">Passeio em ${esc(nameById[item.parent_id]||'')}</span>` : `<span class="admin-item-card__label">Destino principal</span>`;
    const imgCount = imgs.length > 1 ? ` · ${imgs.length} fotos` : '';
    return `
    <div class="admin-item-card${item.parent_id?' admin-item-card--child':''}">
      ${thumb}
      <div class="admin-item-card__body">
        ${parentLabel}
        <p class="admin-item-card__name">${esc(item.name)}</p>
        <p class="admin-item-card__meta">
          R$ ${fmt(item.raised_amount)} de R$ ${fmt(item.goal_amount)} · ${item.progress_pct}%
          ${!item.is_active ? ' · <span class="inactive-tag">Inativo</span>' : ''}${imgCount}
        </p>
        <div class="admin-item-card__progress">
          <div class="admin-item-card__progress-fill" style="width:${item.progress_pct}%"></div>
        </div>
        <div class="admin-item-card__actions">
          <button class="btn-edit"   data-action="edit-item"   data-id="${item.id}">Editar</button>
          <button class="btn-delete" data-action="delete-item" data-id="${item.id}">Remover</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Contributions ─────────────────────────────────────────────────────────────────
function renderContribs() {
  const filter = $id('contribFilter')?.value || 'all';
  const list   = filter === 'all' ? ST.contribs : ST.contribs.filter(c => c.status === filter);
  renderContribCards($id('allContribs'), list);
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
        <p class="contrib-card__name">${esc(c.giver_name)}</p>
        <div class="contrib-card__meta">
          <span>${esc(c.item_name)}</span>
          <span>${esc(c.created_at)}</span>
        </div>
        ${c.message ? `<p class="contrib-card__message">"${esc(c.message)}"</p>` : ''}
      </div>
      <div class="contrib-card__right">
        <span class="contrib-card__amount">R$ ${fmt(c.amount)}</span>
        <span class="status-badge status-badge--${c.status}">${c.status==='confirmed'?'Confirmado':'Pendente'}</span>
        ${c.status==='pending'
          ? `<button class="confirm-btn" data-action="confirm-contrib" data-id="${c.id}">Confirmar</button>`
          : ''}
      </div>
    </div>`).join('');
}

async function confirmContrib(id) {
  await api(`/api/admin/contributions/${id}/status`, {
    method:'PUT', body: JSON.stringify({status:'confirmed'})
  });
  await loadContribs();
  loadStats();
}

// ── Item Modal ─────────────────────────────────────────────────────────────────────
function resetUpload() {
  uploadedImages = [];
  $id('uploadMainImg').classList.add('hidden');
  $id('uploadMainImg').src = '';
  $id('uploadPlaceholder').classList.remove('hidden');
  $id('uploadThumbs').innerHTML = '';
  $id('uploadStatus').textContent = '';
  $id('uploadStatus').className   = 'upload-status';
  $id('imageFile').value = '';
}

function showUploaded() {
  const thumbs = $id('uploadThumbs');
  thumbs.innerHTML = '';
  uploadedImages.forEach((url, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'upload-thumb';
    wrap.title = 'Clique para definir como principal';
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    wrap.appendChild(img);
    const del = document.createElement('span');
    del.className = 'upload-thumb__del'; del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); uploadedImages.splice(i,1); showUploaded(); });
    wrap.appendChild(del);
    wrap.addEventListener('click', () => {
      // Move clicked to front
      uploadedImages.splice(i,1); uploadedImages.unshift(url); showUploaded();
    });
    thumbs.appendChild(wrap);
  });

  if (uploadedImages.length > 0) {
    $id('uploadMainImg').src = uploadedImages[0];
    $id('uploadMainImg').classList.remove('hidden');
    $id('uploadPlaceholder').classList.add('hidden');
  } else {
    $id('uploadMainImg').classList.add('hidden');
    $id('uploadPlaceholder').classList.remove('hidden');
  }
}

function populateParentSelect(currentParentId) {
  const sel = $id('itemParentId');
  sel.innerHTML = '<option value="">Destino principal (raiz)</option>';
  // Only root items (parent_id === null) can be parents
  ST.items.filter(i => i.parent_id === null || i.parent_id === undefined).forEach(root => {
    const opt = document.createElement('option');
    opt.value = root.id;
    opt.textContent = root.name;
    if (currentParentId !== null && currentParentId !== undefined && root.id === currentParentId)
      opt.selected = true;
    sel.appendChild(opt);
  });
}

function openAddItem() {
  $id('itemModalTitle').textContent = 'Nova Experiência';
  $id('editItemId').value = '';
  $id('itemName').value = '';
  $id('itemDescription').value = '';
  $id('itemGoal').value = '';
  $id('itemCategory').value = 'Passeio';
  $id('itemOrder').value = 0;
  $id('itemIsActive').checked = true;
  populateParentSelect(null);
  resetUpload();
  $id('itemModal').classList.remove('hidden');
}

function openEditItem(id) {
  const item = ST.items.find(x => x.id === id);
  if (!item) return;
  $id('itemModalTitle').textContent = 'Editar Experiência';
  $id('editItemId').value      = item.id;
  $id('itemName').value        = item.name;
  $id('itemDescription').value = item.description || '';
  $id('itemGoal').value        = item.goal_amount;
  $id('itemCategory').value    = item.category;
  $id('itemOrder').value       = item.display_order;
  $id('itemIsActive').checked  = item.is_active;
  populateParentSelect(item.parent_id ?? null);
  resetUpload();
  uploadedImages = Array.isArray(item.images) ? [...item.images] : [];
  showUploaded();
  if (uploadedImages.length) {
    $id('uploadStatus').textContent = `${uploadedImages.length} foto(s) atual(is)`;
    $id('uploadStatus').className   = 'upload-status upload-status--ok';
  }
  $id('itemModal').classList.remove('hidden');
}

function closeItemModal() { $id('itemModal').classList.add('hidden'); }

// ── File Upload ─────────────────────────────────────────────────────────────────
async function handleFiles(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  if (uploadedImages.length + files.length > 5) {
    alert('Máximo de 5 fotos por item. Remova algumas antes de adicionar mais.');
    return;
  }
  const status = $id('uploadStatus');
  status.textContent = 'Enviando...'; status.className = 'upload-status';

  for (const file of files) {
    const fd = new FormData(); fd.append('image', file);
    try {
      const r = await fetch('/api/admin/upload', {
        method:'POST', headers:{'X-Admin-Token': getToken()}, body: fd
      });
      const d = await r.json();
      if (r.ok && d.url) { uploadedImages.push(d.url); }
      else { status.textContent = d.error||'Erro ao enviar'; status.className='upload-status upload-status--error'; }
    } catch { status.textContent='Erro de conexão'; status.className='upload-status upload-status--error'; }
  }
  showUploaded();
  if (uploadedImages.length) {
    status.textContent = `${uploadedImages.length} foto(s) salva(s)`;
    status.className   = 'upload-status upload-status--ok';
  }
  $id('imageFile').value = '';
}

async function saveItem() {
  const id = $id('editItemId').value;

  // Read parent_id properly: empty string → null, number string → int
  const parentRaw = $id('itemParentId').value;
  const parent_id = parentRaw === '' ? null : parseInt(parentRaw, 10);

  const payload = {
    name:          $id('itemName').value.trim(),
    description:   $id('itemDescription').value.trim(),
    goal_amount:   parseFloat($id('itemGoal').value),
    images:        uploadedImages,
    category:      $id('itemCategory').value,
    parent_id,
    display_order: parseInt($id('itemOrder').value) || 0,
    is_active:     $id('itemIsActive').checked,
  };

  if (!payload.name || isNaN(payload.goal_amount) || payload.goal_amount < 1) {
    alert('Preencha nome e meta.'); return;
  }

  const btn = $id('itemModalSave');
  btn.textContent = 'Salvando...'; btn.disabled = true;

  try {
    const url    = id ? `/api/admin/items/${id}` : '/api/admin/items';
    const method = id ? 'PUT' : 'POST';
    const r = await api(url, { method, body: JSON.stringify(payload) });
    if (r.ok) {
      closeItemModal();
      await loadItems();
      loadStats();
    } else {
      const err = await r.json();
      alert(err.error || 'Erro ao salvar.');
    }
  } catch { alert('Erro de conexão.'); }
  finally { btn.textContent='Salvar experiência'; btn.disabled=false; }
}

async function deleteItem(id) {
  if (!confirm('Remover esta experiência?')) return;
  await api(`/api/admin/items/${id}`, { method:'DELETE' });
  await loadItems(); loadStats();
}

// ── Utils ────────────────────────────────────────────────────────────────────────
function fmt(n) { return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2}); }

// Escape HTML for safe insertion into innerHTML
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Boot ────────────────────────────────────────────────────────────────────────
init();
