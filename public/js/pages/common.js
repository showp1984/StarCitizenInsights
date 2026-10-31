import {chart, emptyState, esc} from '../kit.js';

export function tile(label, value, note = '', cls = '') {
  return `<div class="tile ${cls}"><span class="tile-label">${esc(label)}</span><span class="tile-value">${esc(value)}</span>${note ? `<span class="tile-note">${note}</span>` : ''}</div>`;
}

export function card(id, title, note = '', {wide = false, legend = '', body = ''} = {}) {
  return `<article class="card${wide ? ' wide' : ''}" id="card-${id}"><h2>${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ''}${legend}${body || `<div class="chart" id="${id}"></div>`}</article>`;
}

export function head(title, lede = '') {
  return `<header class="page-head"><h1>${esc(title)}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</header>`;
}

// Draws into #id; fn returns false when it has nothing to show.
export function draw(root, id, height, fn, emptyText = 'No data for this selection.') {
  const el = root.querySelector(`#${id}`);
  if (!el) return;
  const ctx = chart(el, typeof height === 'function' ? height() : height);
  if (fn(ctx) === false) emptyState(el, emptyText);
}

export const b = (v) => `<b>${esc(v)}</b>`;
