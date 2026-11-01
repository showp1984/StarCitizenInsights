// Journey: where you were during a session, on a map of the star system drawn from the positions the overlay
// shows, with the stops and trips in a timeline beside it. Planets and moons open as a globe with the named places
// on them. The map is drawn here from coordinates (public/data/starmap.json); there are no map images.

import {fmt, esc, css, showTip, hideTip} from '../kit.js';
import {ms} from '../model.js';
import {head} from './common.js';
import {placeName} from './overview.js';
import {buildJourney, positionAt, bodyName} from '../journey-model.js';

let starmap = null;
// What you were looking at, kept across re-renders (the page redraws when the window resizes).
const view = {key: null, system: null, body: null, t: null, sel: null, cam: null, globe: null, live: false, busy: false, picking: false, listScroll: 0};
// The app redraws the page every 15 s while it shows the session being played, unless you're dragging the map or
// choosing a session.
export const following = () => view.live && !view.busy && !view.picking;
window.addEventListener('pointerup', () => { view.busy = false; });

// With no session picked, the tab switches to one being played as soon as it has positions.
export async function liveWaiting(state) {
  if (state.journey || view.live || view.picking) return false;
  try {
    const {journeys} = await (await fetch('/api/journeys')).json();
    return journeys.some((x) => x.live && x.session !== view.key);
  } catch (e) {
    return false;
  }
}

const clock = (t) => new Date(`${t.slice(0, 19)}Z`).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const day = (t) => new Date(`${t.slice(0, 19)}Z`).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'});
const kmText = (km, about = false) => {
  if (km == null) return '';
  const a = about ? 'about ' : '';
  if (km < 1) return `${a}${fmt.int(km * 1000)} m`;
  if (km < 1e6) return `${a}${fmt.int(km)} km`;
  return `${a}${fmt.dec(km / 1e6, km < 1e7 ? 2 : 1)} million km`;
};
const span = (min) => (min < 1 ? 'under a minute' : fmt.hm(min));
const isGlobe = (code) => /^[A-Z][a-z]+\d[a-z]?$/.test(code || '');
const lonLat = (v) => {
  const r = Math.hypot(v[0], v[1], v[2] ?? 0);
  return [(Math.atan2(v[1], v[0]) * 180) / Math.PI, r ? (Math.asin((v[2] ?? 0) / r) * 180) / Math.PI : 0];
};

const MOVE = {quantum: 'Quantum travel', flight: 'Flight', local: 'Moved around', gap: 'No readings', jump: 'Jump', relog: 'Back to the main menu and in again'};

export async function render(root, {state}) {
  let list;
  try {
    [list, starmap] = await Promise.all([(await fetch('/api/journeys')).json(), starmap || (await fetch('data/starmap.json')).json()]);
  } catch (e) {
    root.innerHTML = `${head('Journey')}<p class="note">Can't reach the app server.</p>`;
    return;
  }
  if (state.page !== 'journey') return;
  const journeys = list.journeys || [];
  if (!journeys.length) {
    root.innerHTML = `${head('Journey', 'Where you were during a session, on a map, with the stops you made and the trips between them.')}
      <p class="note">Nothing yet. The app reads your position from the game's info overlay while you play, from version 0.3.0 on: turn the overlay on with <code>r_displayinfo 3</code> in the game console (~) and keep overlay reading switched on (Live tab). Journeys show up here during and after the session.</p>`;
    return;
  }
  // The session you picked (it's in the address); otherwise the one being played, the one you last looked at, or
  // the newest.
  const picked = journeys.some((x) => x.session === state.journey) ? state.journey : null;
  const playing = journeys.find((x) => x.live);
  const key = picked || (playing && playing.session) || (view.key && journeys.some((x) => x.session === view.key) ? view.key : journeys[0].session);
  if (key !== view.key) Object.assign(view, {key, system: null, body: null, t: null, sel: null, cam: null, globe: null, atEnd: false, listScroll: 0});
  const meta = journeys.find((x) => x.session === key);
  view.live = !!meta.live;
  const data = await (await fetch(`/api/journey?session=${encodeURIComponent(key)}`)).json();
  if (state.page !== 'journey') return;
  const j = buildJourney(data.readings, starmap, {nameOf: placeName, events: data.events, places: data.places, logPlaces: data.logPlaces});

  const minutes = j.start ? (ms(j.end) - ms(j.start)) / 60000 : 0;
  const lede = j.points.length
    ? `${esc(day(j.start))}, ${esc(clock(j.start))}–${esc(clock(j.end))}: <b>${esc(span(minutes))}</b> with <b>${j.stops.length}</b> stop${j.stops.length === 1 ? '' : 's'}, <b>${j.quantum}</b> quantum trip${j.quantum === 1 ? '' : 's'}${j.jumps ? ` and <b>${j.jumps}</b> jump${j.jumps === 1 ? '' : 's'} between systems` : ''}, <b>${esc(kmText(j.km))}</b> travelled in ${esc(j.systems.join(' and ') || 'space')}.`
    : 'No positions could be read in this session.';
  if (!view.system || !j.systems.includes(view.system)) view.system = j.systems[j.systems.length - 1] || null;

  root.innerHTML = `
    ${head('Journey', lede)}
    <div class="toolbar">
      <div class="jr-picker" id="jr-picker">
        <button type="button" class="btn jr-picked" id="jr-picked" aria-haspopup="listbox" aria-expanded="false" aria-controls="jr-options">${sessionLabel(meta)}</button>
        <ul class="jr-options" id="jr-options" role="listbox" aria-label="Session" tabindex="-1" hidden>
          ${journeys.map((x, i) => `<li role="option" id="jr-opt-${i}" data-session="${esc(x.session)}" aria-selected="${x.session === key}">${sessionLabel(x)}</li>`).join('')}
        </ul>
      </div>
      <span class="note">From the positions the game's info overlay shows (${fmt.int(j.points.length)} of ${fmt.int(data.readings.length)} readings this session had one).</span>
    </div>
    <div class="journey">
      <section class="card jr-map">
        <div class="jr-bar">
          <div class="seg" role="group" aria-label="Map" id="jr-systems">${j.systems.map((s) => `<button type="button" data-system="${esc(s)}" aria-pressed="${!view.body && s === view.system}">${esc(s)}</button>`).join('')}</div>
          <span id="jr-where" class="jr-where"></span>
          <span class="jr-tools">
            <button type="button" class="btn" id="jr-globe" hidden></button>
            <button type="button" class="btn" id="jr-fit" title="Fit your track">Fit</button>
            <button type="button" class="btn" id="jr-all" title="Whole system">Whole system</button>
          </span>
        </div>
        <div class="jr-canvas"><canvas id="jr-canvas" aria-label="Map of your journey"></canvas></div>
        <div class="jr-time">
          <input type="range" id="jr-slider" min="${j.points.length ? j.points[0].at : 0}" max="${j.points.length ? j.points[j.points.length - 1].at : 0}" step="1000" aria-label="Time">
          <span id="jr-time-label" class="jr-time-label"></span>
        </div>
        <p class="note">Scroll to zoom, left-drag to turn and tilt, right-drag to move${j.systems.length ? '; double-click a planet or moon to see it as a globe' : ''}. Planet and moon positions are from the starnav community data (MIT); Pyro's Lagrange points there are approximate, and the map corrects those your readings show to be off.</p>
      </section>
      <section class="card jr-list">
        <h2>Stops and trips</h2>
        <ol class="jr-items" id="jr-items">${itemsHtml(j.items) || '<li class="note">No stops or trips found.</li>'}</ol>
      </section>
    </div>`;

  const canvas = root.querySelector('#jr-canvas');
  const slider = root.querySelector('#jr-slider');
  const map = makeMap(canvas, j);
  // Keep following the newest position when you were looking at the newest one.
  const lastAt = j.points.length ? j.points[j.points.length - 1].at : 0;
  if (view.t == null || view.t > lastAt || view.atEnd) view.t = lastAt;
  slider.value = String(view.t);

  const setTime = (at, {follow = false} = {}) => {
    view.t = at;
    view.atEnd = at >= lastAt;
    const p = positionAt(j.points, at);
    const inside = (x) => at >= x.startAt && at <= x.endAt;
    const it = j.items.find((x) => x.type === 'stop' && inside(x)) || j.items.find(inside);
    root.querySelector('#jr-time-label').textContent = p ? `${clock(new Date(at).toISOString())} · ${it ? itemTitle(it) : ''}` : '';
    root.querySelectorAll('.jr-item').forEach((el) => el.classList.toggle('now', it && Number(el.dataset.i) === j.items.indexOf(it)));
    if (follow && p && p.system && p.system !== view.system && !view.body) {
      view.system = p.system;
      map.reset();
    }
    map.draw();
  };
  slider.addEventListener('input', () => setTime(Number(slider.value), {follow: true}));

  sessionPicker(root.querySelector('#jr-picker'), journeys.findIndex((x) => x.session === key));
  // The list keeps its scroll position when the page redraws.
  const listBox = root.querySelector('.jr-list');
  listBox.scrollTop = view.listScroll;
  listBox.addEventListener('scroll', () => { view.listScroll = listBox.scrollTop; });
  root.querySelector('#jr-systems').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-system]');
    if (!b) return;
    view.system = b.dataset.system;
    view.body = null;
    map.reset();
  });
  root.querySelector('#jr-fit').addEventListener('click', () => map.fit());
  root.querySelector('#jr-all').addEventListener('click', () => map.whole());
  root.querySelector('#jr-globe').addEventListener('click', () => {
    if (view.body) view.body = null;
    else if (view.globeOffer) view.body = view.globeOffer;
    map.reset();
  });
  root.querySelector('#jr-items').addEventListener('click', (e) => {
    const el = e.target.closest('.jr-item');
    if (!el) return;
    const it = j.items[Number(el.dataset.i)];
    view.sel = Number(el.dataset.i);
    slider.value = String(it.startAt);
    if (it.system && it.system !== view.system) view.system = it.system;
    else if (it.systems && it.systems.length && !it.systems.includes(view.system)) view.system = it.systems[0];
    if (view.body && it.body !== view.body) view.body = null;
    setTime(it.startAt);
    map.focus(it);
  });
  map.onPick = (at) => {
    slider.value = String(at);
    setTime(at);
  };
  map.reset();
  setTime(view.t);
}

// A green dot marks the session being played right now.
function sessionLabel(x) {
  return `${x.live ? '<span class="jr-live" title="Being played now"></span>' : ''}<span>${esc(`${day(x.start)}, ${clock(x.start)}–${clock(x.end)} · ${x.systems.join(', ') || '?'} · ${fmt.int(x.positions)} positions`)}</span>`;
}

// The session list: a button that opens a list box (a plain select can't show the dot). Arrow keys move,
// Enter picks, Escape closes.
function sessionPicker(box, selected) {
  const button = box.querySelector('#jr-picked');
  const list = box.querySelector('#jr-options');
  const options = [...list.querySelectorAll('[role=option]')];
  let active = Math.max(0, selected);
  const mark = () => {
    options.forEach((o, i) => o.classList.toggle('active', i === active));
    list.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({block: 'nearest'});
  };
  const open = () => {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    view.picking = true;
    active = Math.max(0, selected);
    mark();
    list.focus();
  };
  const close = (refocus = true) => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    view.picking = false;
    if (refocus) button.focus();
  };
  const pick = (i) => {
    close();
    if (i !== selected) location.hash = `#journey/${encodeURIComponent(options[i].dataset.session)}`;
  };
  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(options.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      mark();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      active = e.key === 'Home' ? 0 : options.length - 1;
      mark();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close(e.key === 'Escape');
    }
  });
  list.addEventListener('click', (e) => {
    const o = e.target.closest('[role=option]');
    if (o) pick(options.indexOf(o));
  });
  list.addEventListener('focusout', (e) => {
    if (!box.contains(e.relatedTarget)) close(false);
  });
}

function itemTitle(it) {
  if (it.type === 'stop') return it.name;
  if (it.kind === 'jump') return `Jump to ${it.to || 'another system'}`;
  return MOVE[it.kind] || 'Moved';
}

// The ship you flew is named on the first trip in it, not on every one.
function itemsHtml(items) {
  let ship = null;
  return items.map((it, i) => {
    const show = it.type === 'move' && it.ship && it.ship !== ship && it.kind !== 'local';
    if (show) ship = it.ship;
    return itemHtml(it, i, show);
  }).join('');
}

function itemHtml(it, i, showShip) {
  const time = `${clock(it.start)}${it.type === 'stop' ? `–${clock(it.end)}` : ''}`;
  const events = (it.events || []).slice(0, 8).map((e) => `<li><span class="dot ${esc(e.kind)}"></span>${esc(e.text)}</li>`).join('');
  if (it.type === 'stop') {
    const bits = [span(it.minutes)];
    if (it.detail && !it.name.includes(it.detail)) bits.push(it.detail);
    if (it.altitude != null && it.altitude >= 5) bits.push(`${kmText(it.altitude)} up`);
    if (it.servers.length) bits.push(it.servers.join(', '));
    return `<li class="jr-item stop" data-i="${i}"><time>${esc(time)}</time><span class="jr-icon stop"></span><div><b>${esc(it.name)}</b><small>${esc(bits.join(' · '))}</small>${events ? `<ul class="jr-events">${events}</ul>` : ''}</div></li>`;
  }
  const bits = [];
  if (!['gap', 'jump', 'relog'].includes(it.kind) && it.km >= 0.5) bits.push(kmText(it.km, it.estimated));
  bits.push(span(it.minutes));
  if (it.gapMinutes >= 1) bits.push(`no readings for ${fmt.hm(it.gapMinutes)}`);
  if (showShip) bits.push(`aboard ${it.ship}`);
  return `<li class="jr-item move ${esc(it.kind)}" data-i="${i}"><time>${esc(time)}</time><span class="jr-icon ${esc(it.kind)}"></span><div>${esc(itemTitle(it))}<small>${esc(bits.join(' · '))}</small>${events ? `<ul class="jr-events">${events}</ul>` : ''}</div></li>`;
}

// ---------- the map
// The star system in 3D, seen by a camera that circles a point you choose: left-drag turns and tilts, right-drag
// moves, the wheel zooms towards the pointer, as on the game's own star map. Planets and moons open as a globe.
const FOV = (40 * Math.PI) / 180;
const DEFAULT_PITCH = (60 * Math.PI) / 180;

function makeMap(canvas, j) {
  const box = canvas.parentElement;
  const w = Math.max(280, Math.floor(box.clientWidth));
  const h = Math.max(320, Math.min(640, Math.round(w * 0.62)));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  const col = {
    bg: css('--panel'), fg: css('--fg'), muted: css('--muted'), faint: css('--faint'), grid: css('--grid'), axis: css('--axis'),
    panel2: css('--panel-2'), accent: css('--accent'), star: css('--warn'), early: css('--s2'), late: css('--s1'), poi: css('--s4'), cave: css('--s7'), wreck: css('--s5'),
  };
  const font = (px, weight = 400) => `${weight} ${px}px ${css('--font-ui')}`;
  const timeColor = (at) => d3.interpolateRgb(col.early, col.late)(j.points.length > 1 ? (at - j.points[0].at) / (j.points[j.points.length - 1].at - j.points[0].at) : 1);
  const api = {onPick: null};
  let hits = [];
  let anim = 0;
  // Focal length in px: what a km at the camera's target distance comes to on screen is f / dist.
  const f = h / 2 / Math.tan(FOV / 2);

  const sys = () => starmap.systems[view.system] || {star: {x: 0, y: 0, z: 0, r: 700000}, bodies: [], lagrange: [], jumps: []};
  // Where bodies are: the map data, or where your readings put them.
  const placeOf = (b) => {
    const fixed = j.bodies[b.code];
    return fixed && (fixed.fitted || fixed.checked) ? {...b, x: fixed.x, y: fixed.y} : b;
  };
  const track = () => (j.tracks[view.system] || []);
  const xyz = (o) => [o.x, o.y, o.z || 0];

  // World (km) to camera: shift to the target, turn by yaw about the system's up axis, tilt by pitch (90° looks
  // straight down). Returns [right, up, depth].
  let B = null;
  const basis = () => {
    const c = view.cam;
    B = {cy: Math.cos(c.yaw), sy: Math.sin(c.yaw), cp: Math.cos(c.pitch), sp: Math.sin(c.pitch)};
  };
  const toCam = (p) => {
    const c = view.cam;
    const vx = p[0] - c.t[0];
    const vy = p[1] - c.t[1];
    const vz = (p[2] ?? 0) - c.t[2];
    const x1 = vx * B.cy + vy * B.sy;
    const y1 = -vx * B.sy + vy * B.cy;
    return [x1, y1 * B.sp + vz * B.cp, c.dist + y1 * B.cp - vz * B.sp];
  };
  const near = () => view.cam.dist * 1e-3;
  const onScreen = (q) => [w / 2 + (f * q[0]) / q[2], h / 2 - (f * q[1]) / q[2], q[2]];
  const project = (p) => {
    const q = toCam(p);
    return q[2] > near() ? onScreen(q) : null;
  };
  // A line in space as it appears, cut where it passes behind the camera.
  const segment = (p, q) => {
    let a = toCam(p);
    let b = toCam(q);
    const n = near();
    if (a[2] <= n && b[2] <= n) return null;
    const cut = (u, v) => {
      const t = (n - u[2]) / (v[2] - u[2]);
      return [u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1]), n];
    };
    if (a[2] <= n) a = cut(a, b);
    else if (b[2] <= n) b = cut(b, a);
    return [onScreen(a), onScreen(b)];
  };
  const line = (p, q) => {
    const s = segment(p, q);
    if (!s) return;
    ctx.moveTo(s[0][0], s[0][1]);
    ctx.lineTo(s[1][0], s[1][1]);
  };
  // Camera axes in the world, for moving the target.
  const axes = () => ({right: [B.cy, B.sy, 0], up: [-B.sy * B.sp, B.cy * B.sp, B.cp]});

  // Camera that shows these points: aimed at their middle, far enough back to see them all.
  const framing = (pts, minKm) => {
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k] ?? 0)));
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k] ?? 0)));
    const t = lo.map((v, k) => (v + hi[k]) / 2);
    const radius = Math.max(minKm / 2, ...pts.map((p) => Math.hypot(p[0] - t[0], p[1] - t[1], (p[2] ?? 0) - t[2])));
    return {t, dist: (radius * 1.25) / Math.tan(FOV / 2) / Math.min(1, w / h)};
  };
  const flyTo = ({t, dist}, animate = true) => {
    cancelAnimationFrame(anim);
    if (!animate) {
      Object.assign(view.cam, {t, dist});
      return draw();
    }
    const from = {t: [...view.cam.t], dist: view.cam.dist};
    const start = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - start) / 450);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      view.cam.t = from.t.map((v, k) => v + (t[k] - v) * e);
      view.cam.dist = Math.exp(Math.log(from.dist) + (Math.log(dist) - Math.log(from.dist)) * e);
      draw();
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  const trackFrame = () => {
    const pts = track().map((r) => r.d);
    const s = sys();
    return pts.length ? framing(pts, 3000) : framing([xyz(s.star), ...s.bodies.map(xyz)], 1e6);
  };

  function reset() {
    hideTip();
    document.querySelectorAll('#jr-systems button').forEach((b) => b.setAttribute('aria-pressed', String(!view.body && b.dataset.system === view.system)));
    if (view.body) {
      if (!view.globe || view.globe.code !== view.body) {
        const pts = j.points.filter((r) => r.body === view.body && r.l);
        const stop = view.sel != null && j.items[view.sel] && j.items[view.sel].body === view.body ? j.items[view.sel] : null;
        const c = stop && stop.local ? lonLat(stop.local) : pts.length ? lonLat(pts[Math.floor(pts.length / 2)].l) : [0, 0];
        view.globe = {code: view.body, rotate: [-c[0], -c[1]], k: 1.2, off: [0, 0]};
      }
      draw();
      return;
    }
    // The camera stays where you put it (across the page's refreshes while you play, and coming back from a
    // globe); another star system starts framed on your track there.
    if (!view.cam || view.cam.system !== view.system) {
      view.cam = {system: view.system, yaw: view.cam ? view.cam.yaw : 0, pitch: view.cam ? view.cam.pitch : DEFAULT_PITCH, ...trackFrame()};
    }
    draw();
  }

  function fit() {
    if (view.body) {
      Object.assign(view.globe, {k: 1.2, off: [0, 0]});
      return draw();
    }
    return flyTo(trackFrame());
  }

  function whole() {
    if (view.body) {
      view.body = null;
      reset();
    }
    const s = sys();
    flyTo(framing([xyz(s.star), ...s.bodies.map(xyz), ...s.jumps.map(xyz)], 1e6));
  }

  function focus(it) {
    if (view.body) {
      if (it.local && it.body === view.body) {
        const c = lonLat(it.local);
        Object.assign(view.globe, {rotate: [-c[0], -c[1]], k: Math.max(view.globe.k, 4), off: [0, 0]});
        draw();
      }
      return;
    }
    const pts = (it.list || []).filter((r) => r.d && r.system === view.system).map((r) => r.d);
    if (it.type === 'stop' && it.pos && it.system === view.system) {
      const b = it.body && starmap.systems[view.system]?.bodies.find((x) => x.code === it.body);
      // Close enough to see the planet or moon next to you.
      const across = b ? Math.max(4 * b.r, 2.2 * Math.hypot(it.pos[0] - placeOf(b).x, it.pos[1] - placeOf(b).y)) : 2000;
      flyTo({t: [it.pos[0], it.pos[1], it.pos[2] ?? 0], dist: across / 2 / Math.tan(FOV / 2)});
    } else if (pts.length) {
      flyTo(framing(pts, 200));
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, w, h);
    hits = [];
    if (view.body) drawGlobe();
    else if (view.cam) drawSystem();
    const globeBtn = document.getElementById('jr-globe');
    if (globeBtn) {
      globeBtn.hidden = !(view.body || view.globeOffer);
      globeBtn.textContent = view.body ? `Back to ${view.system}` : view.globeOffer ? `${bodyName(view.globeOffer, starmap)} as a globe` : '';
    }
  }

  // Labels skip spots another label already took.
  const taken = [];
  const label = (text, x, y, {color = col.muted, size = 11.5, weight = 400, align = 'left'} = {}) => {
    ctx.font = font(size, weight);
    const tw = ctx.measureText(text).width;
    const x0 = align === 'center' ? x - tw / 2 : x;
    const r = [x0 - 2, y - size, x0 + tw + 2, y + 3];
    if (r[2] < 0 || r[0] > w || r[3] < 0 || r[1] > h) return false;
    if (taken.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) return false;
    taken.push(r);
    ctx.fillStyle = color;
    ctx.fillText(text, x0, y);
    return true;
  };
  // Labels go on last, most important first: your stops, then the star, planets, jump points, moons, the rest.
  const pending = [];
  const queue = (priority, ...args) => pending.push([priority, args]);
  const flush = () => {
    pending.sort((a, b) => a[0] - b[0]).forEach(([, args]) => label(...args));
    pending.length = 0;
  };
  const inView = (p, pad = 40) => p && p[0] > -pad && p[0] < w + pad && p[1] > -pad && p[1] < h + pad;

  function drawSystem() {
    taken.length = 0;
    basis();
    const s = sys();
    const star = s.star;
    const bodies = s.bodies.map(placeOf);
    const planets = bodies.filter((b) => b.type === 'planet');
    const pxPerKm = f / view.cam.dist;

    // Orbits around the star, in the system's plane: they show how the map is tilted.
    ctx.lineWidth = 1;
    ctx.strokeStyle = col.grid;
    for (const p of planets) {
      const r = Math.hypot(p.x - star.x, p.y - star.y);
      if (r * pxPerKm > 4e5) continue;
      ctx.beginPath();
      let prev = null;
      for (let i = 0; i <= 192; i += 1) {
        const a = (i / 192) * 2 * Math.PI;
        const q = [star.x + r * Math.cos(a), star.y + r * Math.sin(a), p.z || 0];
        if (prev) line(prev, q);
        prev = q;
      }
      ctx.stroke();
    }
    // Things off the system's plane get a faint line down to it, so you can tell height from distance.
    const stem = (p) => {
      if (Math.abs(p[2] ?? 0) * pxPerKm < 3) return;
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = col.grid;
      ctx.beginPath();
      line(p, [p[0], p[1], 0]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Lagrange points, unless your readings showed the data's position to be off.
    for (const l of s.lagrange) {
      const fixed = j.bodies[l.code];
      if (fixed && fixed.off) continue;
      const p = project(fixed && fixed.fitted ? xyz(fixed) : xyz(l));
      if (!inView(p, 20)) continue;
      ctx.fillStyle = col.faint;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 3.5); ctx.lineTo(p[0] + 3.5, p[1]); ctx.lineTo(p[0], p[1] + 3.5); ctx.lineTo(p[0] - 3.5, p[1]); ctx.closePath();
      ctx.fill();
      const planet = planets.find((b) => l.code.startsWith(`${b.code}_`));
      const pp = planet && project(xyz(planet));
      if (!pp || Math.hypot(p[0] - pp[0], p[1] - pp[1]) > 70) queue(5, l.station ? `${l.name} · ${l.station}` : l.name, p[0] + 6, p[1] + 4, {color: col.faint, size: 10.5});
      hits.push({x: p[0], y: p[1], r: 7, tip: () => [l.name, [[null, 'Lagrange point', l.planet || ''], ...(l.station ? [[null, 'Station', l.station]] : []), ...(l.approx && !(fixed && fixed.fitted) ? [[null, 'Position', 'approximate']] : [])]]});
    }

    // Jump points: the map data's, and those your readings found that it doesn't have (Pyro's).
    const found = Object.entries(j.bodies).map(([code, b]) => [/^JP_(\w+)_(\w+)$/.exec(code), b])
      .filter(([m, b]) => m && m[1] === view.system && (b.fitted || b.checked) && !s.jumps.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 1e5))
      .map(([m, b]) => ({to: m[2], name: `${m[1]}–${m[2]} jump point`, x: b.x, y: b.y, z: b.z || 0}));
    for (const jp of [...s.jumps, ...found]) {
      stem(xyz(jp));
      const p = project(xyz(jp));
      if (!inView(p)) continue;
      ctx.strokeStyle = col.muted;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 5, 0, 2 * Math.PI);
      ctx.stroke();
      queue(3, `To ${jp.to}`, p[0] + 8, p[1] + 4);
      hits.push({x: p[0], y: p[1], r: 8, tip: () => [jp.name, [[null, 'Jump point to', jp.to]]]});
    }

    // The star, planets and moons, farthest first so nearer ones cover them; to scale once you're close enough,
    // never smaller than a dot.
    view.globeOffer = null;
    stem(xyz(star));
    const spheres = [{...star, type: 'star'}, ...bodies].map((b) => ({b, p: project(xyz(b))})).filter((x) => x.p).sort((a, c) => c.p[2] - a.p[2]);
    for (const {b, p} of spheres) {
      const r = (f * b.r) / p[2];
      const parent = b.parent && bodies.find((x) => x.code === b.parent);
      const pp = parent && project(xyz(parent));
      const fromParent = pp ? Math.hypot(p[0] - pp[0], p[1] - pp[1]) : Infinity;
      if (b.type === 'moon' && fromParent < 6 && r < 2) continue;
      if (p[0] + r < -40 || p[0] - r > w + 40 || p[1] + r < -40 || p[1] - r > h + 40) continue;
      if (b.type === 'star') {
        ctx.fillStyle = col.star;
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.max(5, r), 0, 2 * Math.PI);
        ctx.fill();
        queue(1, b.name, p[0] + Math.max(9, r * 0.72), p[1] + 4, {color: col.star});
        hits.push({x: p[0], y: p[1], r: Math.max(8, r), tip: () => [b.name, [[null, 'Star', '']]]});
        continue;
      }
      ctx.fillStyle = col.panel2;
      ctx.strokeStyle = col.axis;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(b.type === 'planet' ? 4.5 : 3, r), 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (b.om && r > 12) {
        // Orbital markers' height, as a ring in the system's plane.
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = col.grid;
        ctx.beginPath();
        let prev = null;
        for (let i = 0; i <= 96; i += 1) {
          const a = (i / 96) * 2 * Math.PI;
          const q = [b.x + b.om * Math.cos(a), b.y + b.om * Math.sin(a), b.z || 0];
          if (prev) line(prev, q);
          prev = q;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.type === 'planet' || fromParent > 30 || r > 10) queue(b.type === 'planet' ? 2 : 4, b.name, p[0] + Math.max(6, r * 0.72) + 3, p[1] + Math.max(4, r * 0.72) + 4, {color: col.fg, weight: b.type === 'planet' ? 600 : 400});
      const hasTrack = j.points.some((x) => x.body === b.code && x.l);
      hits.push({x: p[0], y: p[1], r: Math.max(7, r), body: hasTrack ? b.code : null, tip: () => [b.name, [[null, b.type === 'planet' ? 'Planet' : 'Moon', ''], [null, 'Radius', kmText(b.r)], ...(hasTrack ? [[null, 'Double-click', 'globe view']] : [])]]});
      if (hasTrack && r > Math.min(w, h) * 0.08 && Math.hypot(p[0] - w / 2, p[1] - h / 2) < r + Math.min(w, h) / 3) view.globeOffer = b.code;
    }

    // Your track, early to late in time; quantum travel dashed.
    const pts = track();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const c = pts[i];
      if (c.at - a.at > 10 * 60000) continue;
      const quantum = Math.hypot(c.d[0] - a.d[0], c.d[1] - a.d[1]) / Math.max(1, (c.at - a.at) / 1000) > 50;
      ctx.strokeStyle = timeColor(c.at);
      ctx.setLineDash(quantum ? [6, 5] : []);
      ctx.beginPath();
      line(a.d, c.d);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const r of pts) {
      const p = project(r.d);
      if (inView(p, 0)) hits.push({x: p[0], y: p[1], r: 5, at: r.at, tip: () => [clock(r.t), [[null, 'Where', r.body ? bodyName(r.body, starmap) : `${view.system} system`], ...(r.server ? [[null, 'Server', r.server]] : [])]]});
    }
    // Stops.
    j.stops.forEach((st) => {
      if (st.system !== view.system || !st.pos) return;
      const p = project(st.pos);
      if (!inView(p)) return;
      const i = j.items.findIndex((it) => it.type === 'stop' && it.startAt === st.startAt);
      const rr = 4 + Math.min(5, Math.sqrt(st.minutes));
      ctx.fillStyle = timeColor(st.startAt);
      ctx.strokeStyle = view.sel === i ? col.fg : col.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0], p[1], rr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      queue(0, st.name, p[0] + rr + 4, p[1] - rr - 2, {color: col.fg, size: 12, weight: 600});
      hits.unshift({x: p[0], y: p[1], r: rr + 4, at: st.startAt, tip: () => [st.name, [[null, 'From', clock(st.start)], [null, 'To', clock(st.end)], [null, 'Stayed', span(st.minutes)]]]});
    });
    drawNow((r) => (r.system === view.system && r.d ? project(r.d) : null));
    flush();
    // Scale bar, true at the distance of the point the camera circles.
    const kmpp = 1 / pxPerKm;
    const nice = [1, 2, 5].flatMap((m) => [0.1, 1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8].map((p) => m * p)).sort((a, b) => a - b).find((v) => v / kmpp >= 80) || 1e9;
    const len = nice / kmpp;
    ctx.strokeStyle = col.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, h - 14); ctx.lineTo(12, h - 10); ctx.lineTo(12 + len, h - 10); ctx.lineTo(12 + len, h - 14);
    ctx.stroke();
    ctx.font = font(11);
    ctx.fillStyle = col.muted;
    ctx.fillText(kmText(nice), 16, h - 16);
    const where = document.getElementById('jr-where');
    if (where) where.textContent = `${view.system} system`;
  }

  // Your position at the slider's time.
  function drawNow(at) {
    const p = view.t != null ? positionAt(j.points, view.t) : null;
    const xy = p && at(p);
    if (!xy) return;
    ctx.strokeStyle = col.fg;
    ctx.fillStyle = col.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], 6.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  function drawGlobe() {
    taken.length = 0;
    const g = view.globe;
    const code = view.body;
    const b = Object.values(starmap.systems).flatMap((s) => s.bodies).find((x) => x.code === code) || {name: bodyName(code, starmap), r: 300};
    const R = Math.min(w, h) * 0.4 * g.k;
    const proj = d3.geoOrthographic().scale(R).translate([w / 2 + g.off[0], h / 2 + g.off[1]]).rotate(g.rotate).clipAngle(90);
    const path = d3.geoPath(proj, ctx);
    const center = [-g.rotate[0], -g.rotate[1]];
    const visible = (ll) => d3.geoDistance(ll, center) < Math.PI / 2 - 1e-3;
    ctx.fillStyle = col.panel2;
    ctx.strokeStyle = col.axis;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    path({type: 'Sphere'});
    ctx.fill();
    ctx.stroke();
    // Lines of latitude and longitude, about 100 px apart however far you zoom in.
    const step = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1].find((d) => (R * d * Math.PI) / 180 < 140) || 0.1;
    ctx.strokeStyle = col.axis;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Zoomed in, only the part in view (a whole globe of 0.1° lines would be millions of points).
    const reach = Math.min(180, ((Math.max(w, h) / R) * 180) / Math.PI);
    const snap = (v) => Math.round(v / step) * step;
    const ext = reach >= 90 ? [[-180, -90 + 1e-6], [180, 90 - 1e-6]]
      : [[snap(center[0] - reach * 1.5), Math.max(-90 + 1e-6, snap(center[1] - reach))], [snap(center[0] + reach * 1.5), Math.min(90 - 1e-6, snap(center[1] + reach))]];
    path(d3.geoGraticule().extentMinor(ext).step([step, step]).precision(Math.min(2.5, step / 2))());
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Named places on the body.
    const stopsHere = j.stops.filter((s) => s.body === code && s.local);
    const pois = (starmap.pois[code] || []).map((p) => ({name: p[0], type: p[1], v: [p[2], p[3], p[4]]}));
    for (const p of pois) {
      const ll = lonLat(p.v);
      if (!visible(ll)) continue;
      const [x, y] = proj(ll);
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
      const c = /LandingZone|Spaceport|OrbitalStation/.test(p.type) ? col.accent : /Cave/.test(p.type) ? col.cave : /Wreck|Druglab/.test(p.type) ? col.wreck : col.poi;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, 2 * Math.PI);
      ctx.fill();
      const nearStop = stopsHere.some((s) => Math.hypot(s.local[0] - p.v[0], s.local[1] - p.v[1], (s.local[2] ?? 0) - p.v[2]) < 25);
      if (g.k >= 2.5 || nearStop || /LandingZone|OrbitalStation/.test(p.type)) queue(6, p.name, x + 5, y + 4, {size: 10.5});
      hits.push({x, y, r: 6, tip: () => [p.name, [[null, 'Place', p.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()]]]});
    }
    // Your track over the ground; high above it (in orbit, at a station) drawn dashed.
    const pts = j.points.filter((r) => r.body === code && r.l);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const c = pts[i];
      if (c.at - a.at > 10 * 60000) continue;
      const high = b.r && c.l[2] != null && Math.hypot(...c.l) - b.r > 30;
      ctx.strokeStyle = timeColor(c.at);
      ctx.setLineDash(high ? [5, 5] : []);
      ctx.beginPath();
      path({type: 'LineString', coordinates: [lonLat(a.l), lonLat(c.l)]});
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const r of pts) {
      const ll = lonLat(r.l);
      if (!visible(ll)) continue;
      const [x, y] = proj(ll);
      const alt = b.r && r.l[2] != null ? Math.hypot(...r.l) - b.r : null;
      hits.push({x, y, r: 5, at: r.at, tip: () => [clock(r.t), [[null, 'Height', alt == null ? '?' : kmText(Math.max(0, alt))], ...(r.server ? [[null, 'Server', r.server]] : [])]]});
    }
    for (const st of stopsHere) {
      const ll = lonLat(st.local);
      if (!visible(ll)) continue;
      const [x, y] = proj(ll);
      const i = j.items.findIndex((it) => it.type === 'stop' && it.startAt === st.startAt);
      const rr = 4 + Math.min(5, Math.sqrt(st.minutes));
      ctx.fillStyle = timeColor(st.startAt);
      ctx.strokeStyle = view.sel === i ? col.fg : col.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      queue(0, st.name, x + rr + 4, y - rr - 2, {color: col.fg, size: 12, weight: 600});
      hits.unshift({x, y, r: rr + 4, at: st.startAt, tip: () => [st.name, [[null, 'From', clock(st.start)], [null, 'To', clock(st.end)], ...(st.altitude != null ? [[null, 'Height', kmText(Math.max(0, st.altitude))]] : [])]]});
    }
    drawNow((r) => (r.body === code && r.l && visible(lonLat(r.l)) ? proj(lonLat(r.l)) : null));
    flush();
    const where = document.getElementById('jr-where');
    if (where) where.textContent = `${b.name} · radius ${kmText(b.r)}`;
  }

  // ---------- mouse: left-drag turns and tilts (turns the globe), right-drag moves, the wheel zooms
  const hitAt = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = null;
    for (const hh of hits) {
      const d = Math.hypot(hh.x - x, hh.y - y);
      if (d <= hh.r && (!best || d < best.d)) best = {...hh, d};
    }
    return best;
  };
  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    // (No text selection or page scrolling while you drag the map.)
    e.preventDefault();
    cancelAnimationFrame(anim);
    view.busy = true;
    drag = {button: e.button, x: e.clientX, y: e.clientY, moved: 0};
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add(e.button === 2 ? 'panning' : 'turning');
    hideTip();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const hh = hitAt(e);
      if (!hh) return hideTip();
      const [title, lines] = hh.tip();
      return showTip(e, title, lines);
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (view.body) {
      const g = view.globe;
      if (drag.button === 0) {
        const k = 0.25 / g.k;
        g.rotate = [g.rotate[0] + dx * k, Math.max(-90, Math.min(90, g.rotate[1] - dy * k))];
      } else {
        g.off = [g.off[0] + dx, g.off[1] + dy];
      }
    } else if (drag.button === 0) {
      view.cam.yaw -= dx * 0.006;
      view.cam.pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2, view.cam.pitch + dy * 0.006));
    } else {
      basis();
      const {right, up} = axes();
      const k = view.cam.dist / f;
      view.cam.t = view.cam.t.map((v, i) => v - right[i] * dx * k + up[i] * dy * k);
    }
    draw();
  });
  const end = (e) => {
    const d = drag;
    drag = null;
    view.busy = false;
    canvas.classList.remove('panning', 'turning');
    if (d && d.moved < 4 && d.button === 0) {
      const hh = hitAt(e);
      if (hh && hh.at != null && api.onPick) api.onPick(hh.at);
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('mouseleave', () => { if (!drag) hideTip(); });
  canvas.addEventListener('dblclick', (e) => {
    const hh = hitAt(e);
    if (!view.body && hh && hh.body) {
      view.body = hh.body;
      reset();
    }
  });
  // Twice d3's usual wheel speed: the map spans millions of km down to a few.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const step = e.deltaY * (e.deltaMode === 1 ? 0.1 : e.deltaMode ? 2 : 0.004) * (e.ctrlKey ? 10 : 1);
    if (view.body) {
      view.globe.k = Math.max(1, Math.min(400, view.globe.k * 2 ** -step));
      return draw();
    }
    // Towards the pointer: the spot under it stays put.
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - w / 2;
    const my = e.clientY - r.top - h / 2;
    basis();
    const {right, up} = axes();
    const k = view.cam.dist / f;
    const under = view.cam.t.map((v, i) => v + right[i] * mx * k - up[i] * my * k);
    const dist = Math.max(0.2, Math.min(5e9, view.cam.dist * 2 ** step));
    const keep = dist / view.cam.dist;
    view.cam.t = under.map((v, i) => v - (v - view.cam.t[i]) * keep);
    view.cam.dist = dist;
    draw();
  }, {passive: false});

  return Object.assign(api, {draw, reset, fit, whole, focus});
}
