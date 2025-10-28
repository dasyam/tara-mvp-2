// src/js/map.js
import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/analytics.js';

// Toggle this if later you want preview cells when DB is empty
const USE_SEED_WHEN_EMPTY = false;

// If you flip the flag above to true, import your seed:
// import idealSeed from '../data/ideal-sleep.json';

const ROWS = ['Food','Movement','Mind','Sleep'];
const COLS = ['Morning','Day','Evening','Night'];

function cellKey(row, col) { return `${row}-${col}`; }

function makeEmptyGrid() {
  const grid = {};
  ROWS.forEach(r => COLS.forEach(c => grid[cellKey(r,c)] = []));
  return grid;
}

function makeGridFromRituals(rituals) {
  const grid = makeEmptyGrid();
  rituals.forEach(r => {
    if (!r || !r.category || !r.time_block) return;
    if (!ROWS.includes(r.category) || !COLS.includes(r.time_block)) return;
    grid[cellKey(r.category, r.time_block)].push(r);
  });
  return grid;
}

function renderHeaders() {
  return `
    <div class="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-2 mb-2">
      <div></div>
      ${COLS.map(c => `<div class="text-center text-xs text-gray-500">${c}</div>`).join('')}
    </div>
  `;
}

function renderRow(row, grid) {
  const cells = COLS.map(col => {
    const items = grid[cellKey(row,col)];
    const active = items.length > 0;
    const isSleepRow = row === 'Sleep';
    const base = `relative rounded-2xl border p-3 h-[92px] select-none transition`;
    const styles = [
      'border-gray-200',
      active ? 'bg-gradient-to-br from-purple-500/10 to-indigo-400/10 shadow-md' : 'bg-white',
      active ? 'animate-[softpulse_3s_ease-in-out_infinite]' : '',
      isSleepRow ? 'ring-1 ring-indigo-300/40' : ''
    ].join(' ');
    const chip = active
      ? `<div class="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-white/80 border border-gray-200 shadow">${items.length} ritual${items.length>1?'s':''}</div>`
      : `<div class="absolute bottom-2 right-3 text-gray-300">•</div>`;
    const topName = active ? `<div class="text-[11px] font-medium text-gray-800">${items[0].name}</div>` : '';
    const sub = active ? `<div class="text-[11px] text-gray-600 line-clamp-2">${items[0].tagline || ''}</div>` : `<div class="text-[11px] text-gray-400">—</div>`;
    return `
      <button
        class="${base} ${styles}"
        data-row="${row}" data-col="${col}"
        aria-label="${row} • ${col} (${items.length} rituals)"
        aria-pressed="${active?'true':'false'}">
        ${chip}
        <div class="text-[10px] text-gray-500 mb-1">${row} • ${col}</div>
        ${topName}
        ${sub}
        ${active ? renderPopover(items, row, col) : ''}
      </button>
    `;
  }).join('');

  return `
    <div class="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-2">
      <div class="text-xs font-medium text-gray-600 pr-1 self-center">${row}</div>
      ${cells}
    </div>
  `;
}

function renderPopover(items, row, col) {
  const list = items.map(i => `
    <li class="py-1">
      <div class="text-sm font-medium text-gray-800">${i.name}</div>
      <div class="text-xs text-gray-600">${i.tagline || ''}</div>
    </li>
  `).join('');
  return `
    <div class="popover hidden absolute left-2 right-2 top-2 z-20 rounded-xl bg-white border border-gray-200 shadow-lg p-3">
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-semibold">${row} • ${col}</div>
        <button class="close-pop text-gray-500 hover:text-gray-700 text-sm" aria-label="Close">×</button>
      </div>
      <ul class="max-h-40 overflow-auto pr-1">${list}</ul>
    </div>
  `;
}

function wireCellInteractions(container) {
  // open/close popover on cell click
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-row][data-col]');
    if (!btn) return;
    const row = btn.dataset.row;
    const col = btn.dataset.col;
    const active = btn.getAttribute('aria-pressed') === 'true';
    if (!active) return;

    // Close others
    container.querySelectorAll('.popover').forEach(p => p.classList.add('hidden'));
    const pop = btn.querySelector('.popover');
    if (!pop) return;
    const isOpen = !pop.classList.contains('hidden');
    if (isOpen) {
      pop.classList.add('hidden');
      emitEvent('map_cell_close', { category: row, time_block: col });
    } else {
      pop.classList.remove('hidden');
      const count = btn.querySelectorAll('.popover ul li').length;
      emitEvent('map_cell_open', { category: row, time_block: col, rituals_count: count });
    }
  });

  // close with ×
  container.addEventListener('click', (e) => {
    if (!e.target.classList.contains('close-pop')) return;
    const pop = e.target.closest('.popover');
    const wrap = pop?.closest('button[data-row]');
    if (pop && wrap) {
      pop.classList.add('hidden');
      emitEvent('map_cell_close', { category: wrap.dataset.row, time_block: wrap.dataset.col });
    }
  });

  // click outside to close
  document.addEventListener('click', (e) => {
    const anyOpen = document.querySelector('.popover:not(.hidden)');
    if (!anyOpen) return;
    if (!e.target.closest('.popover') && !e.target.closest('button[data-row]')) {
      document.querySelectorAll('.popover').forEach(p => p.classList.add('hidden'));
    }
  });
}

function renderGrid(container, grid, { preview }) {
  const headers = renderHeaders();
  const rows = ROWS.map(r => renderRow(r, grid)).join('');
  container.innerHTML = headers + rows;

  const banner = document.getElementById('mapBanner');
  if (banner) banner.classList.toggle('hidden', !preview);

  // analytics
  const cellsActive = Object.values(grid).filter(arr => arr.length > 0).length;
  emitEvent('map_viewed', { cells_active: cellsActive, user_has_rituals: cellsActive > 0 && !preview });

  wireCellInteractions(container);
}

async function safeLoadUserRituals() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[map] no user session; rendering blank grid');
      return [];
    }
    const { data, error } = await supabase
      .from('rituals')
      .select('ritual_id,name,tagline,category,time_block,color,active')
      .eq('user_id', user.id)
      .eq('active', true);

    if (error) {
      console.warn('[map] rituals select error:', error.message || error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('[map] loadUserRituals exception:', e);
    return [];
  }
}

export async function renderSystemMap() {
  const mount = document.getElementById('systemMap');
  if (!mount) {
    console.warn('[map] #systemMap not found');
    return;
  }

  // skeleton (ensures you see *something* immediately)
  mount.innerHTML = `
    <div class="space-y-2">
      ${Array.from({length: ROWS.length}).map(() => `
        <div class="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-2">
          <div class="h-5"></div>
          ${COLS.map(()=>`<div class="h-[92px] rounded-2xl border border-gray-100 bg-gray-50 animate-pulse"></div>`).join('')}
        </div>
      `).join('')}
    </div>
  `;

  // 1) render blank grid first
  const emptyGrid = makeEmptyGrid();
  renderGrid(mount, emptyGrid, { preview: false });

  console.log('[map] rendered empty grid; loading data…');

  // 2) then try to load rituals and re-render if any
  let rituals = await safeLoadUserRituals();

  if (rituals.length === 0 && USE_SEED_WHEN_EMPTY) {
    // flip the flag above to true if you want preview cells for demos
    // rituals = idealSeed;
  }

  const grid = makeGridFromRituals(rituals);
  renderGrid(mount, grid, { preview: rituals.length === 0 && USE_SEED_WHEN_EMPTY });

  console.log('[map] final grid rendered with items:', rituals.length);
}
