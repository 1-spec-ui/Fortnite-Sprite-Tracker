/* ════════════════════════════════════════════════════════════
   State
   The collection lives entirely in this browser's localStorage,
   so each person's collection is private and survives server
   restarts. The server only provides static sprite reference
   data via /api/directory.
════════════════════════════════════════════════════════════ */
const COL_KEY  = 'spriteCollection';   // map of key -> {level, summoned, mastered}
let allRows      = [];
let TERMINAL     = [];
let VPERKS       = {};
let SPRITE_DIR   = {};   // sprites dict from /api/directory
let calcEntries  = [];   // [{spriteName, variant, rarity, level, maxLevel, cost}]
let TOTAL_VARS   = 61;
let activeFilters = new Set();   // multi-select; conflicting filters live in the same group
let rarityFilter = null;
let sortMode     = 'default';
// Mutually-exclusive groups so e.g. "mastered" and "not mastered" can't both apply
const FILTER_GROUPS = {
  owned:      'collection', unowned: 'collection',
  mastered:   'mastery',    notmastered: 'mastery',
  summoned:   'state',      indexed:  'state',
};
let searchQuery  = '';
let myDust       = 0;

const ALL_VARIANTS = ["Normal","Gold","Gummy","Galaxy","Holofoil","Gem","Cube","Quack"];
const VARIANT_COLORS = {
  Normal: '#94a3b8',
  Gold: '#fbbf24',
  Gummy: '#ec4899',
  Galaxy: '#8b5cf6',
  Cube: '#3b82f6',
  Holofoil: '#2dd4bf',
  Gem: '#22c55e',
  Quack: '#f97316',
};
const VARIANT_ORDER = {
  Normal: 0,
  Gold: 1,
  Gummy: 2,
  Galaxy: 3,
  Holofoil: 4,
  Gem: 5,
  Cube: 6,
  Quack: 7,
};
const VARIANT_ICONS = {
  Normal: '◻', Gold: '🥇', Gummy: '🍬', Galaxy: '🌠',
  Cube: '🧊', Holofoil: '🌈', Gem: '💎', Quack: '🦆',
};
function variantIcon(variant) {
  return VARIANT_ICONS[variant] || VARIANT_ICONS.Normal;
}
function variantColor(variant) {
  return VARIANT_COLORS[variant] || VARIANT_COLORS.Normal;
}
let basketQty    = {};

const RARITY_ORDER = ['Rare','Epic','Legendary','Mythic'];
const RARITY_ICONS = { Rare:'💧', Epic:'⚡', Legendary:'🔥', Mythic:'🌌' };

// Populated from /api/directory
let EXTRACTION_BASE = {
  Rare:      {1:200, 2:300,  3:450,  4:600,  5:1000},
  Epic:      {1:500, 2:750,  3:1000, 4:1500, 5:2500},
  Legendary: {1:1000,2:1500, 3:2250, 4:3500, 5:5000},
  Mythic:    {1:2000,2:3000, 3:4500, 4:6000, 5:8000},
};

/* Compute extraction yield for a row.
   Rules:
   - Level used = sprite's current level when summoned, else 1 (indexed).
   - A Gummy-variant sprite that is Summoned gives +20% to ALL other sprites (not itself).
*/
function gummySummoned() {
  return allRows.some(r => r.variant === 'Gummy' && r.summoned);
}
function computeYield(row) {
  if (!row.owned) return 0;
  const lvl  = row.summoned ? row.level : 1;
  const base = (EXTRACTION_BASE[row.rarity] || {})[lvl] || 0;
  const isGummy = row.variant === 'Gummy';
  if (gummySummoned() && !isGummy) return Math.round(base * 1.20);
  return base;
}

/* ════════════════════════════════════════════════════════════
   Boot
════════════════════════════════════════════════════════════ */
async function boot() {
  const listEl = document.getElementById('list');
  const skeletonEl = document.getElementById('loadingSkeleton');
  if (listEl) listEl.style.display = 'none';
  if (skeletonEl) skeletonEl.style.display = 'block';

  const saved = localStorage.getItem('myDust');
  if (saved) { myDust = parseInt(saved)||0; document.getElementById('myDustInput').value = myDust; }
  const sb = localStorage.getItem('basket');
  if (sb) { try { basketQty = JSON.parse(sb); } catch(e){} }

  const dirRes = await fetch('/api/directory');
  const dir    = await dirRes.json();

  TERMINAL        = dir.terminal;
  VPERKS          = dir.variant_perks;
  SPRITE_DIR      = dir.sprites || {};
  TOTAL_VARS      = dir.total_variants || 61;
  if (dir.extraction_base) EXTRACTION_BASE = dir.extraction_base;

  allRows         = buildAllRows();

  if (listEl) listEl.style.display = 'block';
  if (skeletonEl) skeletonEl.style.display = 'none';

  refreshStats();
  render();
  renderTerminal();
  populateEcSprite();
  renderCalculator();
}

/* ── Local collection persistence ──
   Stored as a flat map: { "SpriteName||Variant": {level, summoned, mastered} }
   Built once on boot into allRows, updated on every toggle. */
function loadCollection() {
  try { return JSON.parse(localStorage.getItem(COL_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function saveCollection(coll) {
  localStorage.setItem(COL_KEY, JSON.stringify(coll));
}

/* Build the full row list by merging the static directory with the
   user's local collection. Each sprite's variant list comes from the
   image-backed variants[] provided by /api/directory. */
function buildAllRows() {
  const coll = loadCollection();
  const rows = [];
  for (const [name, info] of Object.entries(SPRITE_DIR)) {
    const maxLevel = info.max_level || 5;
    const variants = info.variants || [];
    for (const v of variants) {
      const variant = v.variant;
      const key  = name + '||' + variant;
      const entry = coll[key];
      const owned = !!entry;
      let level    = owned ? entry.level : 0;
      let summoned = owned ? !!entry.summoned : false;
      let mastered = owned ? !!entry.mastered : false;
      if (owned && !summoned) level = 1;
      if (owned && level === 5 && maxLevel === 5) mastered = true;
      rows.push({
        key,
        name,
        variant,
        rarity:     info.rarity,
        ability:    info.ability,
        levels:     info.levels,
        max_level:  maxLevel,
        cost:       v.cost || 0,
        image:      v.image || null,
        owned,
        level,
        summoned,
        mastered,
        status:     owned ? computeStatus(level, mastered, summoned) : null,
      });
    }
  }
  rows.sort((a, b) => {
    const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
    if (ra !== rb) return ra - rb;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return (VARIANT_ORDER[a.variant]||0) - (VARIANT_ORDER[b.variant]||0);
  });
  return rows;
}

/* ════════════════════════════════════════════════════════════
   Dust
════════════════════════════════════════════════════════════ */
function onDustChange() {
  myDust = parseInt(document.getElementById('myDustInput').value)||0;
  localStorage.setItem('myDust', myDust);
  renderCalculator();
}

/* ════════════════════════════════════════════════════════════
   Tabs / Filters / Sort
════════════════════════════════════════════════════════════ */
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelectorAll('.tab-btn, .mnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
}
function setFilter(mode, btn) {
  if (mode === 'all') { activeFilters.clear(); updateFilterButtons(); render(); return; }
  // "Not Owned" is fully exclusive — it can't stack with any other filter
  if (mode === 'unowned') {
    if (activeFilters.has('unowned')) activeFilters.delete('unowned');
    else { activeFilters.clear(); activeFilters.add('unowned'); }
    updateFilterButtons(); render(); return;
  }
  activeFilters.delete('unowned');   // any other filter clears Not Owned
  if (activeFilters.has(mode)) {
    activeFilters.delete(mode);            // toggle off
  } else {
    // drop any conflicting filter in the same mutually-exclusive group
    const grp = FILTER_GROUPS[mode];
    [...activeFilters].forEach(f => { if (FILTER_GROUPS[f] === grp) activeFilters.delete(f); });
    activeFilters.add(mode);
  }
  updateFilterButtons();
  render();
}
function updateFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === 'all' ? activeFilters.size === 0 : activeFilters.has(b.dataset.filter));
  });
  updateFilterCount();
}
function updateFilterCount() {
  const n = activeFilters.size + (rarityFilter ? 1 : 0);
  const badge = document.getElementById('filterCount');
  const btn   = document.getElementById('filtersBtn');
  if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  if (btn)   btn.classList.toggle('has-filters', n > 0);
}
/* Mobile filter bottom-sheet */
function toggleFilterSheet() {
  const p = document.getElementById('filterPanel');
  const b = document.getElementById('filterBackdrop');
  const open = p.classList.toggle('open');
  if (b) b.classList.toggle('open', open);
  document.body.style.overflow = (open && window.innerWidth <= 900) ? 'hidden' : '';
}
function closeFilterSheet() {
  document.getElementById('filterPanel')?.classList.remove('open');
  document.getElementById('filterBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}
function setRarity(r, btn) {
  if (r === rarityFilter) {
    r = '';
  }
  rarityFilter = r || null;
  const sel = document.getElementById('raritySelect');
  if (sel) sel.value = r || '';
  document.querySelectorAll('.rarity-filter').forEach(b => {
    b.classList.remove('active-Rare','active-Epic','active-Legendary','active-Mythic','active');
  });
  if (btn && r) btn.classList.add('active-' + r, 'active');
  updateFilterCount();
  render();
}
function setSort(mode, btn) {
  sortMode = mode;
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === mode));
  render();
}
function setSearch(value) {
  searchQuery = (value || '').trim().toLowerCase();
  render();
}
function clearSearch() {
  searchQuery = '';
  const input = document.getElementById('spriteSearch');
  if (input) input.value = '';
  render();
}
function matchesSearch(row, query) {
  const haystack = [
    row.name,
    row.ability,
    row.variant,
    row.rarity,
    row.status ? row.status.text : '',
    Object.values(row.levels || {}).join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

/* ════════════════════════════════════════════════════════════
   Sort helper
════════════════════════════════════════════════════════════ */
function applySort(rows) {
  const VO = ALL_VARIANTS;
  if (sortMode === 'default') {
    return [...rows].sort((a,b) =>
      RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
      a.name.localeCompare(b.name) ||
      VO.indexOf(a.variant) - VO.indexOf(b.variant)
    );
  }
  if (sortMode === 'lvl-desc') return [...rows].sort((a,b) => b.level - a.level || a.name.localeCompare(b.name));
  if (sortMode === 'lvl-asc')  return [...rows].sort((a,b) => a.level - b.level || a.name.localeCompare(b.name));
  if (sortMode === 'mastered')
    return [...rows].sort((a,b) => (b.mastered?1:0)-(a.mastered?1:0) || b.level-a.level || a.name.localeCompare(b.name));
  return rows;
}

/* ════════════════════════════════════════════════════════════
   Render collection
════════════════════════════════════════════════════════════ */
function render() {
  let rows = allRows;
  if (searchQuery) rows = rows.filter(r => matchesSearch(r, searchQuery));
  if (rarityFilter)             rows = rows.filter(r => r.rarity === rarityFilter);
  for (const f of activeFilters) {
    if (f === 'owned')       rows = rows.filter(r => r.owned);
    else if (f === 'unowned')     rows = rows.filter(r => !r.owned);
    else if (f === 'mastered')   rows = rows.filter(r => r.owned && r.mastered);
    else if (f === 'notmastered') rows = rows.filter(r => r.owned && !r.mastered);
    else if (f === 'summoned')   rows = rows.filter(r => r.owned && r.summoned);
    else if (f === 'indexed')     rows = rows.filter(r => r.owned && !r.summoned);
  }

  if (!rows.length) {
    const msg = searchQuery
      ? `<div class="center-msg">No sprites match “${esc(searchQuery)}”.</div>`
      : '<div class="center-msg">No sprites match the current filter.</div>';
    document.getElementById('list').innerHTML = msg;
    return;
  }

  // Group into per-sprite subcategories
  const groups = {};
  for (const r of rows) (groups[r.name] = groups[r.name] || []).push(r);

  const names = orderGroups(groups);
  let html = '';
    for (const name of names) {
      const g = groups[name];
      g.sort((a, b) => VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant]);
      const rarity  = g[0].rarity;
      const display = name.replace(/\s+Sprite$/, '');
      const allOwned = g.every(r => r.owned);
      const allMastered = g.every(r => r.mastered);
      html += `<div class="sprite-group">
        <div class="sprite-group-head">
          <span class="sprite-group-name">${esc(display)}</span>
          <span class="sprite-group-rar ${rarity}">${RARITY_ICONS[rarity]} ${rarity}</span>
           <button class="group-add-btn" ${allOwned?'disabled':''} onclick="addSpriteVariants('${jsAttr(name)}')" title="Add all variants of this sprite to your collection">＋ Add All Variants</button>
           <button class="group-master-btn" ${allMastered?'disabled':''} onclick="masterAllSpriteVariants('${jsAttr(name)}')" title="Add all variants and set them to Level 5 Mastered">★ Master All</button>
        </div>
        <div class="card-grid">${g.map(buildCard).join('')}</div>
      </div>`;
    }
  document.getElementById('list').innerHTML = html;

  // Trigger image load animations with blur-up effect
  requestAnimationFrame(() => {
    document.querySelectorAll('.card-media img:not(.loaded)').forEach(img => {
      if (img.complete) {
        img.classList.add('loaded');
      } else {
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
      }
    });
  });
}

/* Order the sprite subcategories by the active sort */
function orderGroups(groups) {
  const names = Object.keys(groups);
  if (sortMode === 'lvl-desc' || sortMode === 'lvl-asc') {
    const dir = sortMode === 'lvl-desc' ? -1 : 1;
    return names.sort((a, b) => dir * (groupMaxLvl(groups[b]) - groupMaxLvl(groups[a])) || a.localeCompare(b));
  }
  if (sortMode === 'mastered') {
    return names.sort((a, b) =>
      (groupHasMast(groups[b]) - groupHasMast(groups[a])) ||
      RARITY_ORDER.indexOf(groups[a][0].rarity) - RARITY_ORDER.indexOf(groups[b][0].rarity) ||
      a.localeCompare(b));
  }
  // default / owned / unowned — by rarity then name
  return names.sort((a, b) =>
    RARITY_ORDER.indexOf(groups[a][0].rarity) - RARITY_ORDER.indexOf(groups[b][0].rarity) ||
    a.localeCompare(b));
}
function groupMaxLvl(g)  { return Math.max(0, ...g.map(r => r.owned ? r.level : 0)); }
function groupHasMast(g) { return g.some(r => r.mastered) ? 1 : 0; }

function buildCard(row) {
  const key        = row.key;
  const maxLvl     = row.max_level || 5;
  const owned      = row.owned;
  const displayName = row.name.replace(/\s+Sprite$/, '');
  const media      = row.image
    ? `<img src="${esc(row.image)}" alt="${esc(row.variant)}" loading="lazy" decoding="async" />`
    : `<span class="placeholder">${esc(displayName[0]||'?')}</span>`;

  let pips = '';
  for (let i = 1; i <= maxLvl; i++) {
    const lit     = owned && i <= row.level;
    const mastPip = lit && row.mastered && i === row.level;
    pips += `<span class="pip ${lit?'lit':''} ${mastPip?'mast':''}"></span>`;
  }

  const crown = (owned && row.mastered) ? `<div class="card-crown" title="Mastered">👑</div>` : '';
  const check = owned ? `<div class="card-check" title="Collected">✓</div>` : '';
  const summBadge = (owned && row.summoned) ? `<div class="card-summ-badge" title="Summoned">⚡</div>` : '';
  const indexedBadge = (owned && !row.summoned) ? `<div class="card-indexed-badge" title="Indexed">📦</div>` : '';
  const statusIcons = owned ? `<div class="card-status-icons">${check}${summBadge}${indexedBadge}</div>` : '';
  const cls   = ['sprite-card', owned?'':'unowned', (owned&&row.mastered)?'is-mastered':''].filter(Boolean).join(' ');
  const lvlText = owned ? `Lv ${row.level}` : '—';

  const statusHtml = owned && row.status
    ? `<div class="card-status ${row.status.cls}"><span>${row.status.icon}</span><span>${esc(row.status.text)}</span></div>`
    : `<div class="card-status unowned">Not collected</div>`;

  const addBtn = owned ? '' : `<button type="button" class="card-add-btn" onclick="addVariant(event,'${jsAttr(key)}')" title="Add ${esc(row.variant)} ${esc(displayName)} to your collection">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    Add
  </button>`;

  const summonToggle = owned ? `<button type="button" class="card-toggle ${row.summoned?'summoned':''}" onclick="cardToggleSummoned(event,'${jsAttr(key)}')" title="${row.summoned?'Switch to Indexed':'Switch to Summoned'}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    ${row.summoned ? 'Summoned' : 'Indexed'}
  </button>` : '';

  return `<div class="${cls}" onclick="openCard('${jsAttr(key)}')">
    <div class="card-media">${media}${crown}${statusIcons}</div>
    <div class="card-body">
      <div class="card-name" title="${esc(displayName)}">${esc(displayName)}</div>
      <span class="v-chip v-${esc(row.variant)} card-variant">${variantIcon(row.variant)} ${esc(row.variant)}</span>
      <div class="card-foot">
        <div class="card-pips">${pips}</div>
        <div class="card-lvl">${lvlText}</div>
      </div>
      <div class="card-cost">💨 ${row.cost.toLocaleString()} Dust</div>
      ${statusHtml}
      ${addBtn}
      ${summonToggle}
    </div>
  </div>`;
}

/* Indexed ↔ Summoned toggle directly on a collection card.
   Stops the click from also opening the detail modal. */
async function cardToggleSummoned(event, key) {
  event.stopPropagation();
  const row = allRows.find(r => r.key === key);
  if (!row || !row.owned) return;
  await toggleSummoned(key, !row.summoned);
}

/* ════════════════════════════════════════════════════════════
   Sprite detail modal (opened by clicking a card)
════════════════════════════════════════════════════════════ */
let modalKey = null;
let modalGummyOverride = null; // null=auto, true=force +20%, false=force off

function openCard(key) {
  modalKey = key;
  modalGummyOverride = null;
  renderModalContent(key);
  document.getElementById('spriteModal').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeCard() {
  modalKey = null;
  document.getElementById('spriteModal').classList.remove('show');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });

/* Swipe-to-dismiss for mobile modal */
(function() {
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  const modal = document.getElementById('spriteModal');
  const card = document.getElementById('spriteModalCard');

  if (!modal || !card) return;

  modal.addEventListener('touchstart', (e) => {
    if (e.target.closest('.modal-card') && card.scrollTop === 0) {
      startY = e.touches[0].clientY;
      isDragging = true;
      card.style.transition = 'none';
    }
  }, { passive: true });

  modal.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      card.style.transform = `translateY(${deltaY}px)`;
      card.style.opacity = Math.max(0.4, 1 - deltaY / 400);
    }
  }, { passive: true });

  modal.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    const deltaY = currentY - startY;
    if (deltaY > 120) {
      closeCard();
    }
    card.style.transform = '';
    card.style.opacity = '';
    startY = 0;
    currentY = 0;
  });
})();

function renderModalContent(key) {
  const row  = allRows.find(r => r.key === key);
  if (!row) return;
  const card = document.getElementById('spriteModalCard');
  const maxLvl = row.max_level || 5;
  const owned = row.owned, lvl = row.level, mast = row.mastered, summ = row.summoned;
  const mastForced = owned && lvl === 5 && maxLvl === 5;

  // Level buttons
  let lvlBtns = '';
  for (let i = 1; i <= 5; i++) {
    if (i > maxLvl) { lvlBtns += `<button class="lvl-btn hidden-btn" disabled></button>`; continue; }
    const isLit    = owned && i <= lvl;
    const noSummon = owned && !summ && i > 1;
    const disabled = !owned || noSummon;
    const ttip     = noSummon ? `Level ${i} (enable Summoned first)` : `Level ${i}`;
    lvlBtns += `<button class="${isLit?'lvl-btn lit':'lvl-btn'}" ${disabled?'disabled':''}
      onclick="mSetLevel('${jsAttr(key)}',${i})" title="${ttip}">${i===5?'5':i}</button>`;
  }

  const mastChecked = owned && mast;
  const mastLbl    = mastForced ? '★ (Lv 5)' : (mastChecked ? '★ Yes' : '☆ No');
  const mastCls    = mastForced ? 'mast-label forced' : (mastChecked ? 'mast-label on' : 'mast-label');
  const mastTitle  = mastForced
    ? 'Automatically mastered at Level 5'
    : 'Click to mark this sprite as Mastered (independent of level)';

  // Ability progression
  let prog = '';
  for (let i = 1; i <= maxLvl; i++) {
    const isMax  = (i === maxLvl);
    const isMast = isMax && maxLvl === 5;
    const numCls = isMast ? 'm' : (isMax ? 'cap' : '');
    const dscCls = isMast ? 'm' : (isMax ? 'cap' : '');
    const icon   = isMast ? '★' : i;
    prog += `<div class="lvl-desc-row">
      <div class="lvl-num ${numCls}">${icon}</div>
      <div class="lvl-desc ${dscCls}">${esc((row.levels && row.levels[i]) || '')}</div>
    </div>`;
  }

  const media = row.image
    ? `<img src="${esc(row.image)}" alt="${esc(row.variant)}" loading="lazy" decoding="async" />`
    : `<span style="font-size:2rem;font-weight:800;color:#fff">${esc(row.name[0]||'?')}</span>`;
  const displayName = row.name.replace(/\s+Sprite$/, '');
  const yieldHtml   = buildYieldHtml(row);
  const variantPerk = (VPERKS && VPERKS[row.variant]) || '';
  // Variant ability block — shown for non-Normal variants that carry a perk
  const variantAbilityHtml = (row.variant !== 'Normal' && variantPerk)
    ? `<div class="sm-ability-label">Variant Ability — ${esc(row.variant)}</div>
       <div class="sm-variant-ability">
         <span class="sm-va-chip">${variantIcon(row.variant)} ${esc(row.variant)}</span>${esc(variantPerk)}
       </div>`
    : '';

  card.innerHTML = `
    <button class="modal-close" onclick="closeCard()" aria-label="Close">✕</button>
    <div class="sm-header">
      <div class="sm-thumb" style="background:${variantColor(row.variant)}">${media}</div>
      <div class="sm-meta">
        <div class="sm-title">${esc(displayName)}</div>
        <span class="v-chip v-${esc(row.variant)}">${variantIcon(row.variant)} ${esc(row.variant)}</span>
        <span class="t-cost-badge" style="margin-left:4px">💨 ${row.cost.toLocaleString()} Dust</span>
      </div>
    </div>
    <div class="sm-ability-label">Base Ability</div>
    <p class="sm-ability">${esc(row.ability)}</p>
    ${variantAbilityHtml}
    <label class="sm-owned">
      <input type="checkbox" ${owned?'checked':''} onchange="mToggleOwned('${jsAttr(key)}',this.checked)" />
      <span>${owned ? 'Collected — tap to remove' : 'Mark as Collected'}</span>
    </label>
    <div class="sm-section">
      <div class="sm-label">LEVEL</div>
      <div class="lvl-selector" style="margin-top:8px">${lvlBtns}</div>
    </div>
    <div class="sm-section sm-toggle-row">
      <div class="mast-col">
        <input type="checkbox" class="mast-check" ${mastChecked?'checked':''} ${(!owned||mastForced)?'disabled':''}
          onchange="mToggleMastered('${jsAttr(key)}',this.checked)" title="${esc(mastTitle)}" />
        <span class="${mastCls}">${mastLbl}</span>
      </div>
      <div class="s-toggle">
        <label class="tgl">
          <input type="checkbox" ${summ?'checked':''} ${owned?'':'disabled'}
            onchange="mToggleSummoned('${jsAttr(key)}',this.checked)" />
          <span class="tgl-sl"></span>
        </label>
        <span class="s-lbl ${summ?'on':''}">${summ?'Summoned':'Indexed (Lv 1)'}</span>
      </div>
      <div class="s-toggle">
        <label class="tgl">
          <input type="checkbox" ${modalGummyOverride!==false?'checked':''}
            onchange="modalGummyOverride=this.checked; refreshModal();" />
          <span class="tgl-sl"></span>
        </label>
        <span class="s-lbl ${modalGummyOverride!==false?'on':''}">🍬 +20% Gummy</span>
      </div>
    </div>
    <div class="sm-section">
      <div class="sm-label">ABILITY PROGRESSION</div>
      <div class="lvl-desc-rows" style="margin-top:8px">${prog}</div>
    </div>
    ${yieldHtml ? `<div class="sm-section">${yieldHtml}</div>` : ''}
  `;
}

function refreshModal() { if (modalKey) renderModalContent(modalKey); }
async function mSetLevel(k, l)      { await setLevel(k, l);          refreshModal(); }
async function mToggleMastered(k, m) { await toggleMastered(k, m);    refreshModal(); }
async function mToggleSummoned(k, s) { await toggleSummoned(k, s);    refreshModal(); }
async function mToggleOwned(k, o)    { await toggleOwned(k, o);       refreshModal(); }

function buildYieldHtml(row) {
  if (!row.owned) return '';
  const yld     = computeYield(row);
  const isGummy = row.variant === 'Gummy';
  let cls = 'yield-hint';
  let txt = `📤 Est. Yield: ${yld.toLocaleString()} Dust`;
  if (!row.summoned) {
    cls = 'yield-hint inactive';
    txt = `📤 Indexed yield: ${yld.toLocaleString()} Dust (Lv 1)`;
  } else if (modalGummyOverride === true || (modalGummyOverride === null && gummySummoned() && !isGummy)) {
    const boosted = Math.round(yld * 1.20);
    const delta = boosted - yld;
    cls = 'yield-hint gummy-boost';
    txt = `📤 Est. Yield: ${yld.toLocaleString()} Dust + ${delta.toLocaleString()} Dust (20%) = ${boosted.toLocaleString()} Dust`;
  }
  return `<div class="${cls}">${txt}</div>`;
}

/* ════════════════════════════════════════════════════════════
   Actions
════════════════════════════════════════════════════════════ */
async function toggleOwned(key, checked) {
  if (checked) await upsert(key, 1, false, false);
  else         await remove(key);
}

async function setLevel(key, level) {
  const row = allRows.find(r => r.key === key);
  if (!row || !row.owned) return;
  const maxLevel = row.max_level || 5;
  if (level > maxLevel) return;
  // Level 5 (when max is 5) forces mastered; keep existing mastered otherwise
  const newMastered = (level === 5 && maxLevel === 5) ? true : row.mastered;
  await upsert(key, level, row.summoned, newMastered);
}

async function toggleMastered(key, mastered) {
  const row = allRows.find(r => r.key === key);
  if (!row || !row.owned) return;
  await upsert(key, row.level, row.summoned, mastered);
}

async function toggleSummoned(key, summoned) {
  const row = allRows.find(r => r.key === key);
  if (!row || !row.owned) return;
  // If unsummoning, level must drop to 1 (indexed state)
  const newLevel = summoned ? row.level : 1;
  await upsert(key, newLevel, summoned, row.mastered);
}

function upsert(key, level, summoned, mastered) {
  const row = allRows.find(r => r.key === key);
  if (!row) return;
  const maxLevel = row.max_level || 5;
  if (!summoned) level = 1;
  if (level === 5 && maxLevel === 5) mastered = true;

  const coll = loadCollection();
  coll[key] = { level, summoned, mastered };
  saveCollection(coll);

  row.owned    = true;
  row.level    = level;
  row.summoned = summoned;
  row.mastered = mastered;
  row.status   = computeStatus(level, mastered, summoned);

  // Re-render so filters (e.g. a sprite leaving a "mastered" view) stay correct
  render();
  refreshStats();
  renderCalculator();
}

function remove(key) {
  const coll = loadCollection();
  delete coll[key];
  saveCollection(coll);

  const row = allRows.find(r => r.key === key);
  if (row) { row.owned=false; row.level=0; row.summoned=false; row.mastered=false; row.status=null; }
  render();
  refreshStats();
  renderCalculator();
}

/* ════════════════════════════════════════════════════════════
   Refresh helpers
════════════════════════════════════════════════════════════ */
function refreshStats() {
  const owned = allRows.filter(r => r.owned);
  const mast  = owned.filter(r => r.mastered).length;
  const summ  = owned.filter(r => r.summoned).length;
  const worth = owned.reduce((s, r) => s + r.cost, 0);
  document.getElementById('sTotal').textContent      = owned.length;
  document.getElementById('sMastered').textContent   = mast;
  document.getElementById('sSummoned').textContent   = summ;
  document.getElementById('sUnsummoned').textContent = owned.length - summ;
  document.getElementById('dustWorth').textContent   = worth.toLocaleString();
  const ab = document.getElementById('appbarWorth'); if (ab) ab.textContent = worth.toLocaleString();

  const dw = document.getElementById('dashWorth');      if (dw) dw.textContent = worth.toLocaleString() + ' Dust';
  const dwS = document.getElementById('dashWorthSub');  if (dwS) dwS.textContent = `${owned.length} / ${TOTAL_VARS} variants`;
  const dO = document.getElementById('dashOwned');      if (dO) dO.textContent = owned.length;
  const dM = document.getElementById('dashMast');       if (dM) dM.textContent = mast;
  const dMs = document.getElementById('dashMastSub');   if (dMs) dMs.textContent = `${mast} / ${owned.length} owned`;
  const dS = document.getElementById('dashSumm');       if (dS) dS.textContent = summ;
  const dU = document.getElementById('dashUnsumm');     if (dU) dU.textContent = `${owned.length - summ} not summoned`;

  updateProgressBars(owned.length, mast);
  if (variantProgressOpen) renderVariantProgress();
  if (perVariantProgressOpen) renderPerVariantProgress();
}

function updateProgressBars(owned, mastered) {
  const total   = TOTAL_VARS;
  const collPct = total   ? Math.round(owned   / total   * 100) : 0;
  const mastPct = owned   ? Math.round(mastered / owned   * 100) : 0;
  document.getElementById('collProgFill').style.width  = collPct + '%';
  document.getElementById('mastProgFill').style.width  = mastPct + '%';
  document.getElementById('collProgLabel').textContent = `${owned} / ${total} VARIANTS`;
  document.getElementById('mastProgLabel').textContent = `${mastered} / ${owned} OWNED`;
  document.getElementById('collProgPct').textContent   = collPct + '%';
  document.getElementById('mastProgPct').textContent   = mastPct + '%';

  // Completion ring on the dashboard hero
  const arc = document.getElementById('collRingArc');
  const pctEl = document.getElementById('collRingPct');
  if (arc) {
    const C = 2 * Math.PI * 52;               // r=52
    arc.style.strokeDasharray  = C.toFixed(1);
    arc.style.strokeDashoffset = (C * (1 - collPct / 100)).toFixed(1);
  }
  if (pctEl) pctEl.textContent = collPct + '%';
}

function computeStatus(level, mastered, summoned) {
  if (mastered && summoned)  return {icon:'👑', text:'Mastered & Summoned',    cls:'status-crown'};
  if (mastered && !summoned) return {icon:'🔒', text:'Mastered — Not Summoned',cls:'status-mastered-locked'};
  if (summoned)              return {icon:'🏃', text:`Summoned (Level ${level})`, cls:'status-active'};
  return                            {icon:'📦', text:'Indexed (Level 1)',       cls:'status-indexed'};
}

/* ════════════════════════════════════════════════════════════
   Dashboard — Sprite Variant Progress
════════════════════════════════════════════════════════════ */
let variantProgressOpen = false;

function toggleVariantProgress() {
  variantProgressOpen = !variantProgressOpen;
  const btn    = document.getElementById('dashVariantToggle');
  const panel  = document.getElementById('variantProgressPanel');
  btn.classList.toggle('open', variantProgressOpen);
  if (panel) panel.style.display = variantProgressOpen ? 'block' : 'none';
  if (variantProgressOpen) renderVariantProgress();
}

function renderVariantProgress() {
  const container = document.getElementById('variantProgressContent');
  if (!container) return;

  const spriteNames = Object.keys(SPRITE_DIR).sort((a, b) => {
    const ra = RARITY_ORDER.indexOf(SPRITE_DIR[a].rarity);
    const rb = RARITY_ORDER.indexOf(SPRITE_DIR[b].rarity);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });

  let html = '';
  for (const name of spriteNames) {
    const info = SPRITE_DIR[name];
    const variants = (info.variants || []).map(v => v.variant);
    const ownedCount = variants.filter(v => allRows.some(r => r.name === name && r.variant === v && r.owned)).length;
    const mastCount  = variants.filter(v => allRows.some(r => r.name === name && r.variant === v && r.mastered)).length;
    const total      = variants.length;
    const ownedPct   = total ? Math.round((ownedCount / total) * 100) : 0;
    const mastPct    = total ? Math.round((mastCount  / total) * 100) : 0;
    const displayName = name.replace(/\s+Sprite$/, '');

    html += `<div class="variant-progress-row">
      <div class="vp-header">
        <span class="vp-name">${esc(displayName)}</span>
        <span class="vp-rarity ${info.rarity}">${info.rarity}</span>
      </div>
      <div class="vp-bars">
        <div class="vp-bar-row">
          <span class="vp-bar-label">Owned</span>
          <div class="vp-bar-track"><div class="vp-bar-fill owned" style="width:${ownedPct}%"></div></div>
          <span class="vp-bar-pct">${ownedCount}/${total}</span>
        </div>
        <div class="vp-bar-row">
          <span class="vp-bar-label">Mastered</span>
          <div class="vp-bar-track"><div class="vp-bar-fill mastered" style="width:${mastPct}%"></div></div>
          <span class="vp-bar-pct">${mastCount}/${total}</span>
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

let perVariantProgressOpen = false;

function togglePerVariantProgress() {
  perVariantProgressOpen = !perVariantProgressOpen;
  const btn    = document.getElementById('dashPerVariantToggle');
  const panel  = document.getElementById('perVariantProgressPanel');
  btn.classList.toggle('open', perVariantProgressOpen);
  if (panel) panel.style.display = perVariantProgressOpen ? 'block' : 'none';
  if (perVariantProgressOpen) renderPerVariantProgress();
}

function renderPerVariantProgress() {
  const container = document.getElementById('perVariantProgressContent');
  if (!container) return;

  const variantTypes = ["Normal", "Gold", "Gummy", "Galaxy", "Cube", "Holofoil", "Gem", "Quack"];

  let html = '';
  for (const variant of variantTypes) {
    const totalSprites = Object.keys(SPRITE_DIR).length;
    const ownedCount   = allRows.filter(r => r.variant === variant && r.owned).length;
    const mastCount    = allRows.filter(r => r.variant === variant && r.mastered).length;
    const totalExists  = allRows.filter(r => r.variant === variant).length;
    const ownedPct     = totalExists ? Math.round((ownedCount / totalExists) * 100) : 0;
    const mastPct      = totalExists ? Math.round((mastCount  / totalExists) * 100) : 0;

    html += `<div class="variant-progress-row">
      <div class="vp-header">
        <span class="vp-name">${variantIcon(variant)} ${variant}</span>
      </div>
      <div class="vp-bars">
        <div class="vp-bar-row">
          <span class="vp-bar-label">Owned</span>
          <div class="vp-bar-track"><div class="vp-bar-fill owned" style="width:${ownedPct}%"></div></div>
          <span class="vp-bar-pct">${ownedCount}/${totalExists}</span>
        </div>
        <div class="vp-bar-row">
          <span class="vp-bar-label">Mastered</span>
          <div class="vp-bar-track"><div class="vp-bar-fill mastered" style="width:${mastPct}%"></div></div>
          <span class="vp-bar-pct">${mastCount}/${totalExists}</span>
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html;
}

/* Add every variant of a single sprite (e.g. all Water Sprite variants) to the collection */
function addSpriteVariants(spriteName) {
  let added = 0;
  allRows.forEach(r => {
    if (r.name === spriteName && !r.owned) { upsert(r.key, 1, false, false); added++; }
  });
  render(); refreshStats(); renderCalculator();
  if (added > 0) showToast(`Added all ${added} variant${added>1?'s':''} of ${spriteName.replace(/\s+Sprite$/, '')} to your collection.`, 'ok');
}

/* Add every variant of a single sprite and set them all to max level + mastered */
function masterAllSpriteVariants(spriteName) {
  let updated = 0;
  allRows.forEach(r => {
    if (r.name === spriteName) {
      const maxLevel = r.max_level || 5;
      upsert(r.key, maxLevel, true, true);
      updated++;
    }
  });
  render(); refreshStats(); renderCalculator();
  if (updated > 0) showToast(`Mastered all ${updated} variants of ${spriteName.replace(/\s+Sprite$/, '')}.`, 'ok');
}

/* Add a single variant to the collection from the card button */
async function addVariant(event, key) {
  event.stopPropagation();
  const row = allRows.find(r => r.key === key);
  if (!row || row.owned) return;
  await upsert(key, 1, false, false);
  render(); refreshStats(); renderCalculator();
  showToast(`Added ${row.variant} ${row.name.replace(/\s+Sprite$/, '')} to collection.`, 'ok');
}

/* ══════════════════════════════════════════════════════════
   Terminal
════════════════════════════════════════════════════════════ */
function renderTerminal() {
  document.getElementById('terminalGrid').innerHTML = TERMINAL.map((s,i) => {
    const qty = basketQty[i] || 0;
    return `<div class="t-card">
      <div class="t-card-header">
        <div class="t-name">${esc(s.name)}</div>
        <div class="t-cost-badge">${s.cost.toLocaleString()} Dust</div>
      </div>
      <div class="t-cat">${esc(s.category)}</div>
      ${s.limit ? `<div class="t-limit">⏰ ${esc(s.limit)}</div>` : ''}
      <div class="t-qty-row">
        <button class="t-qty-btn" onclick="adjustQty(${i},-1)">−</button>
        <span class="t-qty" id="qty-${i}">${qty}</span>
        <button class="t-qty-btn" onclick="adjustQty(${i},1)">+</button>
        <span class="t-row-total" id="trow-${i}">${qty ? '= '+(qty*s.cost).toLocaleString()+' Dust' : ''}</span>
      </div>
    </div>`;
  }).join('');
}

function adjustQty(i, delta) {
  const s   = TERMINAL[i];
  const max = s.limit ? 1 : 99;
  basketQty[i] = Math.max(0, Math.min(max, (basketQty[i]||0) + delta));
  localStorage.setItem('basket', JSON.stringify(basketQty));
  document.getElementById('qty-'+i).textContent = basketQty[i];
  const tot = basketQty[i] * s.cost;
  document.getElementById('trow-'+i).textContent = tot ? '= '+tot.toLocaleString()+' Dust' : '';
  renderCalculator();
}

/* ════════════════════════════════════════════════════════════
   Calculator
════════════════════════════════════════════════════════════ */
function renderCalculator() {
  const owned = allRows.filter(r => r.owned);
  const byRarity = {};
  for (const r of owned) byRarity[r.rarity] = (byRarity[r.rarity]||0) + r.cost;
  const collTotal = owned.reduce((s,r) => s+r.cost, 0);

  let collLines = '';
  if (!owned.length) {
    collLines = '<div class="calc-empty">No sprites owned yet.</div>';
  } else {
    for (const rar of RARITY_ORDER) {
      if (!byRarity[rar]) continue;
      collLines += `<div class="calc-line"><span class="cl">${RARITY_ICONS[rar]} ${rar}</span><span class="cr">${byRarity[rar].toLocaleString()} Dust</span></div>`;
    }
    collLines += `<div class="calc-line"><span class="cl">Owned variants</span><span class="cr">${owned.length}</span></div>`;
  }
  document.getElementById('calcCollectionLines').innerHTML = collLines;
  document.getElementById('calcTotalWorth').textContent    = collTotal.toLocaleString() + ' Dust';
  document.getElementById('dustWorth').textContent         = collTotal.toLocaleString();

  let basketTotal = 0, termLines = '', hasItems = false;
  for (const [i, qty] of Object.entries(basketQty)) {
    if (!qty) continue;
    hasItems = true;
    const s = TERMINAL[i], sub = qty * s.cost;
    basketTotal += sub;
    termLines += `<div class="calc-line"><span class="cl">${esc(s.name)} ×${qty}</span><span class="cr">${sub.toLocaleString()} Dust</span></div>`;
  }
  if (!hasItems) termLines = '<div class="calc-empty">Nothing in basket — add services on the Terminal tab.</div>';
  document.getElementById('calcTerminalLines').innerHTML = termLines;
  document.getElementById('calcTerminalTotal').textContent = basketTotal.toLocaleString() + ' Dust';
  document.getElementById('dustBasket').textContent        = basketTotal.toLocaleString();

  const affEl = document.getElementById('affordNote');
  if (hasItems && myDust > 0) {
    affEl.style.display = 'block';
    if (myDust >= basketTotal) {
      affEl.className   = 'afford-note can';
      affEl.textContent = `✅ You can afford this! ${(myDust-basketTotal).toLocaleString()} Dust remaining after purchase.`;
      document.getElementById('calcTerminalTotal').className = 'ct-val ok';
    } else {
      affEl.className   = 'afford-note cannot';
      affEl.textContent = `❌ You need ${(basketTotal-myDust).toLocaleString()} more Dust to afford this basket.`;
      document.getElementById('calcTerminalTotal').className = 'ct-val over';
    }
  } else {
    affEl.style.display = 'none';
    document.getElementById('calcTerminalTotal').className = 'ct-val';
  }
}

/* ════════════════════════════════════════════════════════════
   Extraction Dust Calculator (standalone)
════════════════════════════════════════════════════════════ */
function populateEcSprite() {
  const sel = document.getElementById('ecSprite');
  if (!sel) return;
  const names = Object.keys(SPRITE_DIR).sort();
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  onEcSpriteChange();
}

function onEcSpriteChange() {
  const spriteName = document.getElementById('ecSprite')?.value;
  const sprite     = SPRITE_DIR[spriteName];
  if (!sprite) return;

  // Populate variants from the sprite's actual available variants (image-backed)
  const varSel  = document.getElementById('ecVariant');
  const variants = (sprite.variants || []).map(v => v.variant);
  varSel.innerHTML = variants.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

  // Populate levels 1..max_level
  const lvlSel  = document.getElementById('ecLevel');
  const maxLvl  = sprite.max_level || 5;
  let lh = '';
  for (let i = 1; i <= maxLvl; i++) lh += `<option value="${i}">${i}</option>`;
  lvlSel.innerHTML = lh;
  // Default to max level
  lvlSel.value = String(maxLvl);
}

function addEcEntry() {
  const spriteName = document.getElementById('ecSprite')?.value;
  const variant    = document.getElementById('ecVariant')?.value;
  const level      = parseInt(document.getElementById('ecLevel')?.value || '1');
  const sprite     = SPRITE_DIR[spriteName];
  if (!sprite || !variant) return;

  const rarity   = sprite.rarity;
  const maxLevel = sprite.max_level || 5;
  const variantInfo = (sprite.variants || []).find(v => v.variant === variant);
  const cost     = variantInfo ? variantInfo.cost : 0;

  calcEntries.push({ spriteName, variant, rarity, level, maxLevel, cost });
  renderEcEntries();
}

function removeEcEntry(idx) {
  calcEntries.splice(idx, 1);
  renderEcEntries();
}

function clearEcEntries() {
  calcEntries = [];
  renderEcEntries();
}

function renderEcEntries() {
  const wrap  = document.getElementById('ecTableWrap');
  const tots  = document.getElementById('ecTotals');
  if (!wrap) return;

  if (!calcEntries.length) {
    wrap.innerHTML = '<div class="ec-empty">No sprites added yet. Use the controls above to build your extraction list.</div>';
    if (tots) tots.style.display = 'none';
    return;
  }

  let totalBase = 0, totalGummy = 0;
  let rows = '';
  calcEntries.forEach((e, i) => {
    const base     = (EXTRACTION_BASE[e.rarity] || {})[e.level] || 0;
    const withGum  = Math.round(base * 1.20);
    totalBase  += base;
    totalGummy += withGum;
    const icon = RARITY_ICONS[e.rarity] || '';
    rows += `<tr>
      <td><b class="ec-sprite-name">${esc(e.spriteName)}</b>
          <span class="ec-variant-sub">${icon} ${esc(e.variant)}</span></td>
      <td><span class="ec-lvl-label">Lv ${e.level}</span></td>
      <td class="ec-base">${base.toLocaleString()} Dust</td>
      <td class="ec-gummy">${withGum.toLocaleString()} Dust
          <span class="ec-gummy-delta">(+${(withGum-base).toLocaleString()})</span></td>
      <td><button class="ec-rm" onclick="removeEcEntry(${i})">✕</button></td>
    </tr>`;
  });

  wrap.innerHTML = `<table class="ec-table">
    <thead><tr>
      <th>SPRITE / VARIANT</th>
      <th>LEVEL</th>
      <th>BASE YIELD</th>
      <th>WITH GUMMY (+20%)</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  if (tots) {
    tots.style.display = 'grid';
    const diff = totalGummy - totalBase;
    document.getElementById('ecTotalBase').textContent  = totalBase.toLocaleString()  + ' Dust';
    document.getElementById('ecTotalGummy').textContent = totalGummy.toLocaleString() + ' Dust';
    document.getElementById('ecTotalDiff').textContent  = `+${diff.toLocaleString()} Dust extra with Gummy`;
  }
}

const EXPORT_ICONS = {
  mastered: '👑',
  owned:    '✅',
  lost:     '👻',
  missing:  '❌',
  unavailable: '🚫',
};
const EXPORT_HEADER_VARIANTS = ["Normal","Gold","Gummy","Galaxy","Holofoil","Gem","Cube","Quack"];
const EXPORT_VARIANTS = EXPORT_HEADER_VARIANTS;
const EXPORT_SPRITE_ORDER = [
  "Water Sprite", "Earth Sprite", "Fire Sprite", "Fishy Sprite", "Air Sprite",
  "Duck Sprite", "Ghost Sprite", "Demon Sprite", "King Sprite", "Aura Sprite",
  "Striker Sprite", "Dream Sprite", "Punk Sprite", "Boss Sprite", "Seven Sprite",
  "Batman Sprite", "Grim Reaper Sprite", "Zero Point Sprite", "Burnt Peanut Sprite",
  "Vini Jr. Sprite", "Pollo Sprite", "Peeky Peely", "Lootin' Llama",
  "John Wick", "Iron Mouse"
];

function buildExportText() {
  const ownedCount = allRows.filter(r => r.owned).length;
  const totalCount = allRows.length;

  const rowsByName = {};
  allRows.forEach(row => {
    rowsByName[row.name] = rowsByName[row.name] || {};
    rowsByName[row.name][row.variant] = row;
  });

  const headerLine = `|${EXPORT_HEADER_VARIANTS.join('|')}|`;

  const rows = EXPORT_SPRITE_ORDER.map(name => {
    const spriteInfo = SPRITE_DIR[name];
    const variantMap = rowsByName[name] || {};
    let displayName = name.replace(/\s+Sprite$/, '');
    if (displayName === 'Zero Point') displayName = 'ZP';
    if (displayName === 'Grim Reaper') displayName = 'Grim';
    if (displayName === 'Burnt Peanut') displayName = 'Peanut';
    if (displayName === 'Peeky Peely') displayName = 'Peely';
    if (displayName === "Lootin' Llama") displayName = 'Llama';
    const availableVariants = spriteInfo ? (spriteInfo.variants || []).map(v => v.variant) : [];

    const cells = EXPORT_HEADER_VARIANTS.map(variant => {
      if (!availableVariants.includes(variant)) return `${EXPORT_ICONS.unavailable} `;
      const row = variantMap[variant];
      if (!row) return `${EXPORT_ICONS.unavailable} `;
      if (!row.owned) return `${EXPORT_ICONS.missing} `;
      if (row.mastered && row.summoned) {
        return row.level > 1 ? `${EXPORT_ICONS.mastered}${row.level}` : `${EXPORT_ICONS.mastered} `;
      }
      if (row.summoned) {
        return row.level > 1 ? `${EXPORT_ICONS.owned}${row.level}` : `${EXPORT_ICONS.owned} `;
      }
      return row.level > 1 ? `${EXPORT_ICONS.lost}${row.level}` : `${EXPORT_ICONS.lost} `;
    });

    return `${displayName}|${cells.join('|')}|`;
  });

  // Pad names so the checklist columns align, with just one space after the longest name
  const maxNameLen = Math.max(0, ...EXPORT_SPRITE_ORDER.map(name => {
    let displayName = name.replace(/\s+Sprite$/, '');
    if (displayName === 'Zero Point') displayName = 'ZP';
    if (displayName === 'Grim Reaper') displayName = 'Grim';
    if (displayName === 'Burnt Peanut') displayName = 'Peanut';
    if (displayName === 'Peeky Peely') displayName = 'Peely';
    if (displayName === "Lootin' Llama") displayName = 'Llama';
    return displayName.length;
  }));
  const paddedRows = rows.map(row => {
    const parts = row.split('|');
    if (parts.length > 0) {
      parts[0] = parts[0].padEnd(maxNameLen + 1);
    }
    return parts.join('|');
  });

  const lines = [
    'Sprite Collection Checklist',
    '',
    'Legend: 👑 Mastered (summoned) | ✅ Owned (summoned) | 👻 Lost / Indexed',
    'Missing: ❌ | Not available: 🚫 | Digit after icon = level (2–5)',
    '',
    headerLine,
    ...paddedRows,
    '',
    `Total: ${ownedCount}/${totalCount} collected`,
  ];

  return '```\n' + lines.join('\n') + '\n```';
}

async function loadExportImage(url) {
  if (!url) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function drawExportPlaceholder(ctx, x, y, width, height, label, subtitle) {
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.fillText(label, x + 8, y + 8);
  ctx.font = '500 10px Inter, Arial, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(subtitle, x + 8, y + 26);
}

async function downloadExportImage() {
  const rows = applySort(allRows);
  const grouped = {};
  for (const row of rows) {
    grouped[row.name] = grouped[row.name] || [];
    grouped[row.name].push(row);
  }
  const spriteGroups = Object.keys(grouped).map(name => ({
    name,
    variants: grouped[name].sort((a,b) => VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant])
  }));

  const titleLines = ['FORTNITE COLLECTION TRACKER', 'SPRITE LOCKER CHECKLIST'];
  const padding = 28;
  const titleFont = '700 32px Inter, Arial, sans-serif';
  const headingFont = '600 18px Inter, Arial, sans-serif';
  const labelFont = '600 14px Inter, Arial, sans-serif';
  const infoFont = '500 12px Inter, Arial, sans-serif';
  const cardWidth = 104;
  const cardHeight = 42;
  const cardGap = 10;
  const rowHeight = cardHeight + 40;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = titleFont;
  const titleWidth = Math.max(...titleLines.map(line => measureCtx.measureText(line).width));
  measureCtx.font = headingFont;
  const nameWidth = Math.max(...spriteGroups.map(group => measureCtx.measureText(group.name.replace(/\s+Sprite$/, '')).width), 240);
  const variantWidth = EXPORT_VARIANTS.length * cardWidth + (EXPORT_VARIANTS.length - 1) * cardGap;
  const width = Math.min(1400, Math.max(titleWidth, nameWidth + variantWidth + padding * 3, 940));
  const height = Math.min(10000, padding * 2 + titleLines.length * 42 + spriteGroups.length * rowHeight + 30);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1d4ed8');
  gradient.addColorStop(1, '#7c3aed');
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = padding;

  ctx.fillStyle = '#ffffff';
  ctx.font = titleFont;
  titleLines.forEach(line => {
    ctx.fillText(line, padding, y);
    y += 38;
  });

  ctx.font = infoFont;
  ctx.fillStyle = '#c7d2fe';
  ctx.fillText(`Generated ${new Date().toLocaleDateString()} • ${spriteGroups.length} sprites`, padding, y + 2);
  y += 36;

  ctx.font = headingFont;
  for (const group of spriteGroups) {
    const groupName = group.name.replace(/\s+Sprite$/, '');
    ctx.fillStyle = '#ffffff';
    ctx.fillText(groupName, padding, y);
    const blockX = padding + nameWidth + 18;
    const blockY = y - 4;

    for (let index = 0; index < EXPORT_VARIANTS.length; index++) {
      const variantName = EXPORT_VARIANTS[index];
      const variantRow = group.variants.find(v => v.variant === variantName);
      const available = variantRow && variantRow.available !== false;
      const owned = variantRow && variantRow.owned;
      const mastered = variantRow && variantRow.mastered;
      const x = blockX + index * (cardWidth + cardGap);
      const yCard = blockY + 28;
      const imageUrl = variantRow ? (variantRow.images?.[variantName] || variantRow.image || '') : '';

      if (available && imageUrl) {
        const img = await loadExportImage(imageUrl);
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, yCard, cardWidth, cardHeight, 6);
          ctx.clip();
          ctx.drawImage(img, x, yCard, cardWidth, cardHeight);
          ctx.restore();
        } else {
          drawExportPlaceholder(ctx, x, yCard, cardWidth, cardHeight, variantName, 'No image');
        }
      } else {
        const label = available ? (variantName === 'Gem' || variantName === 'Quack' ? variantName : variantName) : 'N/A';
        const subtitle = available ? (variantName === 'Gem' || variantName === 'Quack' ? 'Placeholder' : 'No image') : 'Unavailable';
        drawExportPlaceholder(ctx, x, yCard, cardWidth, cardHeight, label, subtitle);
      }

      ctx.strokeStyle = available ? '#ffffff33' : '#ffffff22';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, yCard, cardWidth, cardHeight);

      if (available) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 12px Inter, Arial, sans-serif';
        const icon = owned ? (mastered ? '👑' : '✅') : '❌';
        ctx.fillText(icon, x + 6, yCard + 6);
      }
    }

    y += rowHeight;
  }

  const link = document.createElement('a');
  link.download = 'sprite-locker-checklist.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function startExport() {
  const type = document.querySelector('input[name="exportType"]:checked')?.value || 'text';
  closeExportModal();

  if (type === 'image') {
    await downloadExportImage();
    showToast('Collection image download started.', 'ok');
    return;
  }

  if (type === 'list') {
    const text = buildSpriteListText();
    const copied = await copyTextToClipboard(text);
    showToast(copied ? `Copied sprite list to clipboard` : 'Copy failed. Please select and copy the text manually.', copied ? 'ok' : 'err');
    return;
  }

  const text = buildExportText();
  const copied = await copyTextToClipboard(text);
  showToast(copied ? 'Collection checklist copied to clipboard.' : 'Copy failed. Please select and copy the text manually.', copied ? 'ok' : 'err');
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showToast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 2800);
}
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    return true;
  } catch (e) {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function jsAttr(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}
function safeId(k)    { return k.replace(/[^a-zA-Z0-9]/g,'_'); }

function openExportModal() {
  document
      .getElementById("exportModal")
      .classList.add("show");
}
function closeExportModal() {
    document
        .getElementById("exportModal")
        .classList.remove("show");
}
function populateSpriteCheckboxes() {
  const container = document.getElementById('spriteCheckboxes');
  if (!container) return;
  const grouped = {};
  for (const r of allRows) {
    if (!grouped[r.name]) grouped[r.name] = [];
    grouped[r.name].push(r);
  }
  const names = Object.keys(grouped).sort();
  container.innerHTML = names.map(name => {
    const display = name.replace(/\s+Sprite$/, '');
    const owned = grouped[name].some(v => v.owned);
    return `<label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer; color:var(--text-secondary);">
      <input type="checkbox" data-sprite="${esc(name)}" ${owned?'checked':'disabled'} style="accent-color:var(--accent);" />
      ${esc(display)} ${owned ? '' : '(none owned)'}
    </label>`;
  }).join('');
}
function selectAllSprites() {
  document.querySelectorAll('#spriteCheckboxes input[type="checkbox"]').forEach(cb => { if (!cb.disabled) cb.checked = true; });
}
function deselectAllSprites() {
  document.querySelectorAll('#spriteCheckboxes input[type="checkbox"]').forEach(cb => { if (!cb.disabled) cb.checked = false; });
}
function buildSpriteListText() {
  const checkboxes = document.querySelectorAll('#spriteCheckboxes input[type="checkbox"]:checked');
  const selectedNames = new Set();
  checkboxes.forEach(cb => { if (cb.dataset.sprite) selectedNames.add(cb.dataset.sprite); });
  const rows = applySort(allRows).filter(r => selectedNames.has(r.name));
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.name]) grouped[r.name] = [];
    grouped[r.name].push(r);
  }
  const lines = [];
  for (const [name, variants] of Object.entries(grouped)) {
    variants.sort((a, b) => VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant]);
    const owned = variants.filter(v => v.owned);
    if (owned.length === 0) continue;
    const display = name.replace(/\s+Sprite$/, '');
    const parts = owned.map(v => {
      const mark = v.mastered ? ' ★' : '';
      const lvl = v.summoned ? ` Lv${v.level}` : ' Indexed';
      return `${v.variant}${lvl}${mark}`;
    });
    lines.push(`${display}: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

document.addEventListener('change', (e) => {
  if (e.target.name === 'exportType') {
    const listOptions = document.getElementById('listOptions');
    if (listOptions) {
      listOptions.style.display = e.target.value === 'list' ? 'block' : 'none';
    }
  }
});

boot();
