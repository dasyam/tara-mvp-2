import { supabase } from '../lib/supabase.js';
import { emitEvent } from '../lib/analytics.js';
import idealSeed from '../data/ideal-sleep.json';

const ROWS = ['Food','Movement','Mind','Sleep'];
const COLS = ['Morning','Day','Evening','Night'];

function istTodayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

async function loadUserRituals() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, rituals: [] };

  const { data, error } = await supabase
    .from('rituals')
    .select('ritual_id,name,tagline,category,time_block,color,active')
    .eq('user_id', user.id)
    .eq('active', true);

  if (error) {
    console.error('rituals select error', error);
    return { user, rituals: [] };
  }
  return { user, rituals: data || [] };
}

async function loadSeedIfEmpty(current) {
async function loadSeedIfEmpty(current) {
  if (current.length > 0) return { rituals: current, preview: false };
  return { rituals: idealSeed, preview: true };
}


function makeGrid(rituals) {
  const grid = {};
  ROWS.forEach(r => COLS.forEach(c => grid[`${r}-${c}`] = []));
  rituals.forEach(r => {
    if (!r.category || !r.time_block) return;
    if (!ROWS.includes(r.category) || !COLS.includes(r.time_block)) return;
    grid[`${r.category}-${r.time_block}`].push(r);
  });
  return grid;
}

function cellKey(row, col) { return `${row}-${col}`; }

function renderGrid(container, grid, opts) {
  const { preview } = opts;
  const headersRow = `
    <div class="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-2 mb-2">
      <div></div>
      ${COLS.map(c => `<div class="text-center text-xs text-gray-500">${c}</div>`).join('')}
    </div>
  `;

  const rowsHTML = ROWS.map(row => {
    const cells = COLS.map(col => {
      const items = grid[cellKey(row,col)];
      const active = items && items.length > 0;
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
  }).join('');

  container.innerHTML = headersRow + rowsHTML;

  // Preview banner
  const banner = document.getElementById('mapBanner');
  if (banner) banner.classList.toggle('hidden', !preview);

  // Analytics
  const cellsActive = Object.values(grid).filter(arr => arr.length > 0).length;
  emitEvent('map_viewed', { cells_active: cellsActive, user_has_rituals: !preview });

  wireCellInteractions(container);
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
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-row][data-col]');
    if (!btn) return;
    const row = btn.dataset.row;
    const col = btn.dataset.col;
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    if (!pressed) return; // inactive cell, ignore

    const pop = btn.querySelector('.popover');
    if (!pop) return;
    const isOpen = !pop.classList.contains('hidden');

    // Close any open popovers first
    container.querySelectorAll('.popover').forEach(p => p.classList.add('hidden'));

    if (!isOpen) {
      pop.classList.remove('hidden');
      const count = (btn.querySelector('.popover ul')?.children?.length) || 0;
      emitEvent('map_cell_open', { category: row, time_block: col, rituals_count: count });
    } else {
      pop.classList.add('hidden');
      emitEvent('map_cell_close', { category: row, time_block: col });
    }
  });

  // Close popover via ×
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-pop')) {
      const pop = e.target.closest('.popover');
      const wrapper = pop?.closest('button[data-row]');
      if (pop && wrapper) {
        pop.classList.add('hidden');
        emitEvent('map_cell_close', { category: wrapper.dataset.row, time_block: wrapper.dataset.col });
      }
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    const anyOpen = document.querySelector('.popover:not(.hidden)');
    if (!anyOpen) return;
    if (!e.target.closest('.popover') && !e.target.closest('button[data-row]')) {
      document.querySelectorAll('.popover').forEach(p => p.classList.add('hidden'));
    }
  });
}

export async function renderSystemMap() {
  const mount = document.getElementById('systemMap');
  if (!mount) return;

  // skeleton
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

  const { rituals: userRituals } = await loadUserRituals();
  const { rituals, preview } = await loadSeedIfEmpty(userRituals);

  const grid = makeGrid(rituals);
  renderGrid(mount, grid, { preview });
}

export async function renderSystemMap() {
  console.log("[map] renderSystemMap start");
  const mount = document.getElementById('systemMap');
  if (!mount) { console.warn("[map] #systemMap not found"); return; }

  // quick skeleton to prove we’re painting
  mount.innerHTML = `<div class="p-3 text-xs text-gray-500">Loading map…</div>`;

  const { rituals: userRituals } = await loadUserRituals();
  console.log("[map] user rituals:", userRituals?.length);

  const { rituals, preview } = await loadSeedIfEmpty(userRituals);
  console.log("[map] using preview:", preview, "rituals:", rituals?.length);

  const grid = makeGrid(rituals);
  renderGrid(mount, grid, { preview });
  console.log("[map] grid rendered");
}


// bootstrap when page loads
document.addEventListener('DOMContentLoaded', renderSystemMap);
