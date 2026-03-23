// ── State ──────────────────────────────────────────────────────────────────────
const S  = { items: [], selected: null, amount: 0 };
const LB = { imgs: [], idx: 0 };   // lightbox state

// ── Tiny helpers ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const tx = (el, t) => { el.textContent = t; };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)              e.className   = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  await load();
  bindModal();
  bindLightbox();
}

async function load() {
  try {
    const r = await fetch('/api/items');
    if (!r.ok) throw new Error();
    S.items = await r.json();
    if (!Array.isArray(S.items)) S.items = [];
    render();
  } catch {
    $('catalogLoading').innerHTML =
      '<p style="color:var(--text-light)">Erro ao carregar. Recarregue a página.</p>';
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
  $('catalogLoading').classList.add('hidden');
  const root = $('catalogRoot');
  root.innerHTML = '';
  if (!S.items.length) { $('catalogEmpty').classList.remove('hidden'); return; }
  S.items.forEach((item, i) => {
    if (i > 0) { const hr = document.createElement('hr'); hr.className='catalog-separator'; root.appendChild(hr); }
    root.appendChild(mkFeatured(item, i));
  });
}

// ── Featured (root) card ───────────────────────────────────────────────────────
function mkFeatured(item, idx) {
  const sec  = el('section', 'featured-section');
  const card = el('div', `featured-card${item.is_complete ? ' featured-card--complete' : ''}`);
  card.style.animationDelay = `${idx * .1}s`;

  // ── Image side ──
  const imgWrap = el('div', 'featured-card__img-wrap');
  const imgs = item.images || [];

  if (imgs.length) {
    // Main image — click opens lightbox at index 0
    const mainImg = document.createElement('img');
    mainImg.className = 'featured-card__img';
    mainImg.src       = imgs[0];
    mainImg.alt       = item.name;
    mainImg.loading   = 'lazy';
    mainImg.style.cursor = imgs.length > 1 ? 'zoom-in' : 'default';
    mainImg.addEventListener('click', e => {
      e.stopPropagation();
      openLightbox(imgs, 0);
    });
    imgWrap.appendChild(mainImg);

    // Thumbnail strip for extra images
    if (imgs.length > 1) {
      const strip = el('div', 'featured-card__gallery');
      imgs.forEach((url, ti) => {
        const th = document.createElement('img');
        th.className = 'featured-card__thumb';
        th.src = url; th.alt = ''; th.loading = 'lazy';
        if (ti === 0) th.classList.add('featured-card__thumb--active');
        th.addEventListener('click', e => {
          e.stopPropagation();
          // Swap main image preview
          mainImg.src = url;
          strip.querySelectorAll('.featured-card__thumb').forEach(t => t.classList.remove('featured-card__thumb--active'));
          th.classList.add('featured-card__thumb--active');
          // Open lightbox on double-click / if already showing this image
          openLightbox(imgs, ti);
        });
        strip.appendChild(th);
      });
      imgWrap.appendChild(strip);

      // Photo count badge
      const cnt = el('span', 'featured-card__img-count', `${imgs.length} fotos`);
      imgWrap.appendChild(cnt);
    }
  } else {
    imgWrap.appendChild(el('div', 'featured-card__img-placeholder', '✈'));
  }

  imgWrap.appendChild(el('span', 'featured-card__badge', 'Destino Principal'));
  card.appendChild(imgWrap);

  // ── Body side ──
  const body = el('div', 'featured-card__body');

  // Card click → modal (not on image wrap)
  if (!item.is_complete) {
    body.style.cursor = 'pointer';
    body.addEventListener('click', () => openModal(item.id));
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('keydown', e => { if (e.key === 'Enter') openModal(item.id); });
  }

  body.appendChild(el('p', 'featured-card__eyebrow', item.category));
  body.appendChild(el('h3', 'featured-card__name',   item.name));
  if (item.description) body.appendChild(el('p', 'featured-card__desc', item.description));

  // Progress bar
  const prog  = el('div', 'featured-progress');
  const hdr   = el('div', 'featured-progress__header');
  hdr.appendChild(el('span', 'featured-progress__raised', `R$ ${fmt(item.raised_amount)}`));
  hdr.appendChild(el('span', 'featured-progress__goal',   `meta R$ ${fmt(item.goal_amount)}`));
  prog.appendChild(hdr);
  const track = el('div', 'featured-progress__track');
  const fill  = el('div', 'featured-progress__fill');
  fill.style.width = item.progress_pct + '%';
  track.appendChild(fill); prog.appendChild(track);
  prog.appendChild(el('p', 'featured-progress__pct', `${item.progress_pct}% arrecadado`));
  body.appendChild(prog);

  const btn = el('button', 'btn-primary',
    item.is_complete ? 'Meta atingida' : 'Contribuir para esta viagem');
  btn.disabled = item.is_complete;
  if (!item.is_complete)
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(item.id); });
  body.appendChild(btn);

  card.appendChild(body);
  sec.appendChild(card);

  // ── Sub-items ──
  if (item.children && item.children.length) {
    const sub = el('div', 'sub-section');
    sub.appendChild(el('p', 'sub-section__title', 'Experiências incluídas na viagem'));
    const grid = el('div', 'sub-grid');
    item.children.forEach((child, ci) => grid.appendChild(mkSubCard(child, ci)));
    sub.appendChild(grid);
    sec.appendChild(sub);
  }

  return sec;
}

// ── Sub card ───────────────────────────────────────────────────────────────────
function mkSubCard(item, idx) {
  const card = el('div', `travel-card${item.is_complete ? ' travel-card--complete' : ''}`);
  card.style.animationDelay = `${idx * .07}s`;

  const imgs    = item.images || [];
  const imgWrap = el('div', 'travel-card__img-wrap');

  if (imgs.length) {
    const img = document.createElement('img');
    img.className = 'travel-card__img';
    img.src = imgs[0]; img.alt = item.name; img.loading = 'lazy';
    img.style.cursor = imgs.length > 1 ? 'zoom-in' : 'default';
    // Click on image opens lightbox
    img.addEventListener('click', e => {
      e.stopPropagation();
      openLightbox(imgs, 0);
    });
    imgWrap.appendChild(img);
    if (imgs.length > 1)
      imgWrap.appendChild(el('span', 'travel-card__img-count', `+${imgs.length - 1}`));
  } else {
    imgWrap.appendChild(el('div', 'travel-card__img-placeholder', '✈'));
  }

  imgWrap.appendChild(el('span', 'travel-card__cat-badge', item.category));
  if (item.is_complete)
    imgWrap.appendChild(el('span', 'travel-card__complete-badge', 'Meta atingida'));
  card.appendChild(imgWrap);

  // Card body click → modal
  const body = el('div', 'travel-card__body');
  if (!item.is_complete) {
    body.style.cursor = 'pointer';
    body.addEventListener('click', () => openModal(item.id));
    card.setAttribute('tabindex', '0');
    card.setAttribute('role',     'button');
    card.addEventListener('keydown', e => { if (e.key === 'Enter') openModal(item.id); });
  }

  body.appendChild(el('h4', 'travel-card__name', item.name));
  if (item.description) body.appendChild(el('p', 'travel-card__desc', item.description));
  body.appendChild(mkCardProgress(item));

  const btn = el('button',
    `travel-card__btn${item.is_complete ? ' travel-card__btn--complete' : ''}`,
    item.is_complete ? 'Meta atingida' : 'Contribuir');
  btn.disabled = item.is_complete;
  if (!item.is_complete)
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(item.id); });
  body.appendChild(btn);

  card.appendChild(body);
  return card;
}

function mkCardProgress(item) {
  const w = el('div', 'card-progress');
  const h = el('div', 'card-progress__header');
  h.appendChild(el('span', 'card-progress__raised', `R$ ${fmt(item.raised_amount)}`));
  h.appendChild(el('span', 'card-progress__goal',   `meta R$ ${fmt(item.goal_amount)}`));
  w.appendChild(h);
  const t = el('div', 'card-progress__track');
  const f = el('div', 'card-progress__fill');
  f.style.width = item.progress_pct + '%';
  t.appendChild(f); w.appendChild(t);
  w.appendChild(el('p', 'card-progress__pct', `${item.progress_pct}% arrecadado`));
  return w;
}

// ── Lightbox ───────────────────────────────────────────────────────────────────
function openLightbox(imgs, startIdx) {
  if (!imgs || !imgs.length) return;
  LB.imgs = imgs;
  LB.idx  = startIdx;
  updateLightbox();
  $('lightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('lightbox').classList.add('hidden');
  // Only restore scroll if modal is also closed
  if ($('modal').classList.contains('hidden'))
    document.body.style.overflow = '';
}

function goLightbox(delta) {
  const next = LB.idx + delta;
  if (next < 0 || next >= LB.imgs.length) return;
  LB.idx = next;
  updateLightbox();
}

function updateLightbox() {
  const lbImg = $('lightboxImg');
  // Fade transition
  lbImg.style.opacity = '0';
  setTimeout(() => {
    lbImg.src         = LB.imgs[LB.idx];
    lbImg.style.opacity = '1';
  }, 120);

  $('lightboxCounter').textContent = `${LB.idx + 1} / ${LB.imgs.length}`;
  $('lightboxPrev').style.visibility = LB.idx > 0                      ? 'visible' : 'hidden';
  $('lightboxNext').style.visibility = LB.idx < LB.imgs.length - 1     ? 'visible' : 'hidden';

  // Update dot indicators
  const dots = $('lightboxDots');
  dots.innerHTML = '';
  if (LB.imgs.length > 1) {
    LB.imgs.forEach((_, i) => {
      const d = el('span', `lb-dot${i === LB.idx ? ' lb-dot--active' : ''}`);
      d.addEventListener('click', () => { LB.idx = i; updateLightbox(); });
      dots.appendChild(d);
    });
  }
}

function bindLightbox() {
  $('lightboxClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', e => {
    if (e.target === $('lightbox')) closeLightbox();
  });
  $('lightboxPrev').addEventListener('click', e => { e.stopPropagation(); goLightbox(-1); });
  $('lightboxNext').addEventListener('click', e => { e.stopPropagation(); goLightbox(+1); });

  // Keyboard
  document.addEventListener('keydown', e => {
    if ($('lightbox').classList.contains('hidden')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  goLightbox(-1);
    if (e.key === 'ArrowRight') goLightbox(+1);
  });

  // Touch swipe
  let touchStartX = 0;
  const lb = $('lightbox');
  lb.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 50) goLightbox(delta < 0 ? +1 : -1);
  }, { passive: true });
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function findItem(id) {
  for (const r of S.items) {
    if (r.id === id) return r;
    if (r.children) {
      const c = r.children.find(x => x.id === id);
      if (c) return c;
    }
  }
  return null;
}

function openModal(id) {
  const item = findItem(id);
  if (!item) return;
  S.selected = item;
  S.amount   = 0;

  tx($('s1Name'), item.name);
  $('s1Fill').style.width = item.progress_pct + '%';
  tx($('s1ProgressText'),
    `R$ ${fmt(item.raised_amount)} arrecadado de R$ ${fmt(item.goal_amount)} (${item.progress_pct}%)`);

  const rem = typeof item.remaining_amount === 'number'
    ? item.remaining_amount
    : Math.max(0, item.goal_amount - item.raised_amount);
  tx($('s1Remaining'), `Faltam R$ ${fmt(rem)} para completar a meta`);

  buildChips(item.goal_amount, rem);
  $('amountInput').value = '';
  $('amountInput').max   = Math.floor(rem);
  $('step1Next').disabled = true;
  $('amountError').classList.add('hidden');
  document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));

  showStep(1);
  $('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function buildChips(goal, remaining) {
  const wrap = $('amountSuggestions');
  wrap.innerHTML = '';
  getSuggestions(goal, remaining).forEach(v => {
    const b = el('button', 'amount-chip', `R$ ${fmt(v)}`);
    b.dataset.value = v;
    b.addEventListener('click', () => selectChip(b, v, remaining));
    wrap.appendChild(b);
  });
}

function getSuggestions(goal, remaining) {
  let base;
  if      (goal <= 100)  base = [10, 20, 50];
  else if (goal <= 300)  base = [20, 50, 100];
  else if (goal <= 600)  base = [50, 100, 200];
  else if (goal <= 1000) base = [50, 100, 250];
  else                   base = [100, 200, 500];

  const capped = base.map(v => Math.min(v, remaining)).filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  if (remaining > 0 && !capped.includes(remaining)) capped.push(remaining);
  return capped;
}

function selectChip(btn, value, remaining) {
  const capped = Math.min(value, remaining);
  document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
  btn.classList.add('selected');
  $('amountInput').value = '';
  S.amount = capped;
  $('step1Next').disabled = false;
  $('amountError').classList.add('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function showStep(n) {
  ['step1', 'step2', 'step3'].forEach(id => $(id).classList.add('hidden'));
  $(`step${n}`).classList.remove('hidden');
}

// ── Events (modal) ─────────────────────────────────────────────────────────────
function bindModal() {
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  $('step3Close').addEventListener('click', closeModal);

  $('amountInput').addEventListener('input', e => {
    const rem = S.selected
      ? (typeof S.selected.remaining_amount === 'number' ? S.selected.remaining_amount : S.selected.goal_amount)
      : 50000;
    const v = parseFloat(e.target.value);
    document.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
    $('amountError').classList.add('hidden');

    if (v >= 1 && v <= rem) {
      S.amount = v;
      $('step1Next').disabled = false;
    } else if (v > rem) {
      S.amount = rem;
      $('amountInput').value = rem;
      tx($('amountError'), `Valor máximo disponível: R$ ${fmt(rem)}`);
      $('amountError').classList.remove('hidden');
      $('step1Next').disabled = false;
    } else {
      S.amount = 0;
      $('step1Next').disabled = true;
    }
  });

  $('step1Next').addEventListener('click', () => {
    $('giverName').value    = '';
    $('giverMessage').value = '';
    $('giverName').style.borderColor = '';
    showStep(2);
  });
  $('step2Back').addEventListener('click', () => showStep(1));
  $('step2Confirm').addEventListener('click', doConfirm);

  $('copyPixKey').addEventListener('click', () => {
    navigator.clipboard.writeText($('s3PixKey').textContent).catch(() => {});
    const b = $('copyPixKey');
    b.textContent = 'Copiado!';
    setTimeout(() => { b.textContent = 'Copiar chave Pix'; }, 2000);
  });
}

// ── Confirm contribution ───────────────────────────────────────────────────────
async function doConfirm() {
  const name    = $('giverName').value.trim().slice(0, 200);
  const message = $('giverMessage').value.trim().slice(0, 500);
  if (!name) { $('giverName').focus(); $('giverName').style.borderColor = '#c0392b'; return; }
  $('giverName').style.borderColor = '';
  if (!S.amount || S.amount < 1) { showStep(1); return; }

  const btn = $('step2Confirm');
  btn.disabled = true; btn.textContent = 'Confirmando...';
  try {
    const r = await fetch('/api/contribute', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ travel_item_id: S.selected.id, giver_name: name, message, amount: S.amount })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');

    load(); // background refresh

    tx($('s3Name'),    name);
    tx($('s3Amount'),  `R$ ${fmt(d.amount ?? S.amount)}`);
    tx($('s3PixName'), d.pix_name);
    tx($('s3PixKey'),  d.pix_key);

    const msgWrap = $('s3MessageWrap');
    if (message) { tx($('s3Message'), `"${message}"`); msgWrap.classList.remove('hidden'); }
    else          { msgWrap.classList.add('hidden'); }

    genQR(d.amount ?? S.amount);
    showStep(3);
  } catch (e) {
    alert(e.message || 'Ocorreu um erro. Tente novamente.');
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar';
  }
}

async function genQR(amount) {
  const qrEl = $('pixQr');
  qrEl.innerHTML = '<div class="spinner"></div>';
  try {
    const r = await fetch('/api/pix-qrcode', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount })
    });
    const d   = await r.json();
    const img = document.createElement('img');
    img.alt = 'QR Code Pix'; img.src = d.qrcode;
    qrEl.innerHTML = '';
    qrEl.appendChild(img);
  } catch {
    qrEl.textContent = 'QR indisponível';
    Object.assign(qrEl.style, { fontSize: '.75rem', color: 'var(--text-light)', textAlign: 'center' });
  }
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
init();
