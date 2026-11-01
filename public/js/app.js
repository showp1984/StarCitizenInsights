import {prepare, filterSessions} from './model.js';
import {fmt, hideTip} from './kit.js';
import * as overview from './pages/overview.js';
import * as stability from './pages/stability.js';
import * as performance from './pages/performance.js';
import * as loading from './pages/loading.js';
import * as combat from './pages/combat.js';
import * as ships from './pages/ships.js';
import * as missions from './pages/missions.js';
import * as sessionsPage from './pages/sessions.js';
import * as live from './pages/live.js';
import * as servers from './pages/servers.js';
import * as journey from './pages/journey.js';

const PAGES = {live, journey, overview, stability, performance, loading, servers, combat, ships, missions, sessions: sessionsPage};
const LIVE_REFRESH_MS = 15000;
const $ = (s) => document.querySelector(s);

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('sci-filters') || '{}');
  } catch (e) {
    return {};
  }
})();
const state = {data: null, env: saved.env || 'LIVE', period: saved.period || 'all', page: 'overview', session: null, journey: null};

function saveFilters() {
  try {
    localStorage.setItem('sci-filters', JSON.stringify({env: state.env, period: state.period}));
  } catch (e) {
    // storage unavailable: filters just won't persist
  }
}

function readHash() {
  const [page, ...rest] = location.hash.replace(/^#/, '').split('/');
  state.page = PAGES[page] ? page : 'overview';
  state.session = state.page === 'sessions' && rest.length ? decodeURIComponent(rest.join('/')) : null;
  state.journey = state.page === 'journey' && rest.length ? decodeURIComponent(rest.join('/')) : null;
}

function open(key) {
  location.hash = `#sessions/${encodeURIComponent(key)}`;
}

function render() {
  if (!state.data) return;
  hideTip();
  document.querySelectorAll('#tabs button').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.page === state.page)));
  document.querySelectorAll('#env-filter button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.env === state.env)));
  $('#period-filter').value = state.period;
  const page = $('#page');
  const scroll = window.scrollY;
  const keep = render.keepScroll;
  render.keepScroll = false;
  const sessions = filterSessions(state.data.sessions, state);
  // Pages replace their own content; the live pages fetch first, so a refresh doesn't blank the screen.
  const done = PAGES[state.page].render(page, {sessions, all: state.data.sessions, nick: state.data.nick, state, open});
  Promise.resolve(done).then(() => {
    if (keep) window.scrollTo(0, scroll);
  });
}

// The Live tab follows the running session, and so does the Journey tab while it shows it (or, with no session
// picked, as soon as one is being played).
setInterval(async () => {
  if (!state.data || document.hidden) return;
  if (state.page === 'live' || (state.page === 'journey' && (journey.following() || (await journey.liveWaiting(state))))) {
    render.keepScroll = true;
    render();
  }
}, LIVE_REFRESH_MS);

function setSub(text) {
  $('#brand-sub').textContent = text;
}

async function loadData() {
  const raw = await (await fetch('/api/data')).json();
  state.data = prepare(raw);
  const n = state.data.sessions.length;
  setSub(`${state.data.nick ? `${state.data.nick} · ` : ''}${fmt.int(n)} sessions · updated ${new Date(raw.generatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`);
  $('#splash').hidden = true;
  $('#page').hidden = false;
  render();
}

function showFooter(st) {
  $('#footer-version').textContent = st.version ? `v${st.version}` : '';
  $('#footer-root').textContent = st.root ? `Reading logs from ${st.root}.` : 'No Star Citizen folder chosen yet.';
  $('#change-folder').hidden = false;
}

// Shown when the game can't be found or the folder has no logs.
function askForFolder(title, text) {
  $('#splash').hidden = false;
  $('#page').hidden = true;
  $('#splash-title').textContent = title;
  $('#splash-text').textContent = text;
  $('#splash-progress').hidden = true;
  $('#splash-actions').hidden = false;
  setSub('Waiting for your Star Citizen folder');
}

async function waitForScan() {
  $('#splash-progress').hidden = false;
  $('#splash-actions').hidden = true;
  for (;;) {
    let st;
    try {
      st = await (await fetch('/api/status')).json();
    } catch (e) {
      $('#splash-text').textContent = 'Waiting for the app server to start…';
      setSub('Connecting…');
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    showFooter(st);
    if (!st.scanning && st.finishedAt) {
      if (st.notFound) {
        askForFolder('Where is Star Citizen installed?', 'Star Citizen Insights reads the Game.log files the game writes. It looked in the usual places and in the RSI Launcher\'s log, but couldn\'t find your install.');
        return false;
      }
      if (!st.sessions) {
        askForFolder('No game logs found', st.error ? `Couldn't read logs from ${st.root}: ${st.error}` : `There are no Game.log files under ${st.root} yet. Play a session, or pick a different folder.`);
        return false;
      }
      return true;
    }
    const pct = st.total ? (100 * st.done) / st.total : 0;
    $('#splash-bar').style.width = `${pct}%`;
    $('#splash-text').textContent = st.total ? `Parsed ${fmt.int(st.done)} of ${fmt.int(st.total)} new or changed logs…` : 'Looking for Game.log files…';
    setSub(st.total ? `Scanning logs ${Math.round(pct)}%…` : 'Scanning logs…');
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function rescan() {
  const btn = $('#rescan');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  try {
    await fetch('/api/rescan', {method: 'POST'});
    if (await waitForScan()) {
      render.keepScroll = true;
      await loadData();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Rescan logs';
  }
}

async function chooseFolder() {
  const err = $('#pick-error');
  err.hidden = true;
  let r;
  try {
    r = await (await fetch('/api/folder', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({pick: true})})).json();
  } catch (e) {
    r = {error: 'The app server stopped. Start Star Citizen Insights again.'};
  }
  if (r.cancelled) return;
  if (r.error) {
    if (!$('#splash').hidden) {
      err.textContent = r.error;
      err.hidden = false;
    } else {
      askForFolder('That folder has no game logs', r.error);
      err.textContent = r.error;
      err.hidden = false;
    }
    return;
  }
  $('#splash').hidden = false;
  $('#page').hidden = true;
  $('#splash-title').textContent = 'Reading your flight logs';
  if (await waitForScan()) await loadData();
}

$('#pick-folder').addEventListener('click', chooseFolder);
$('#change-folder').addEventListener('click', chooseFolder);

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]');
  if (b) location.hash = `#${b.dataset.page}`;
});
$('#env-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-env]');
  if (!b) return;
  state.env = b.dataset.env;
  saveFilters();
  render.keepScroll = true;
  render();
});
$('#period-filter').addEventListener('change', (e) => {
  state.period = e.target.value;
  saveFilters();
  render.keepScroll = true;
  render();
});
$('#rescan').addEventListener('click', rescan);
window.addEventListener('hashchange', () => {
  readHash();
  render();
  window.scrollTo(0, 0);
});
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastWidth) < 30) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    lastWidth = window.innerWidth;
    render.keepScroll = true;
    render();
  }, 250);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { render.keepScroll = true; render(); });
// Tell the server a window is still open so it can shut itself down after the last one closes.
setInterval(() => fetch('/api/ping').catch(() => {}), 20000);

readHash();
(async () => {
  if (await waitForScan()) await loadData();
})();
