/* SUNDIAL ATL trip page: pick a start and destination (boxes or tap the map), see the best way to go on MARTA's real
   timetable, schedule it, and get reminders. Uses js/transit.js (planner) and js/access.js (heat, profiles). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const NEEDS = [['wheel', 'Wheelchair or scooter'], ['walk', "Can't walk far"], ['sight', 'Low vision or blind'], ['hear', 'Deaf or hard of hearing'], ['easy', 'Plain, simple words']];
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /* Well-known places, approximate positions (good enough to pick the right station). */
  const LANDMARKS = [
    ['Grady Memorial Hospital', 33.7527, -84.3823, 'Hospital'], ['Emory University Hospital', 33.7938, -84.3232, 'Hospital'], ['Piedmont Atlanta Hospital', 33.8093, -84.3927, 'Hospital'],
    ['Hartsfield-Jackson Airport', 33.6407, -84.4277, 'Airport'], ['Georgia Aquarium', 33.7634, -84.3951, 'Landmark'], ['Centennial Olympic Park', 33.7603, -84.3932, 'Park'],
    ['Mercedes-Benz Stadium', 33.7554, -84.4009, 'Landmark'], ['Fox Theatre', 33.7727, -84.3857, 'Landmark'], ['Piedmont Park', 33.7817, -84.3733, 'Park'],
    ['Ponce City Market', 33.7725, -84.3655, 'Landmark'], ['Atlanta Botanical Garden', 33.7899, -84.3735, 'Landmark'], ['High Museum of Art', 33.7903, -84.3856, 'Landmark'],
    ['Lenox Square', 33.8463, -84.3621, 'Shopping'], ['Phipps Plaza', 33.8512, -84.3631, 'Shopping'], ['Atlanta History Center', 33.8423, -84.3881, 'Landmark'],
    ['Decatur Square', 33.7748, -84.2963, 'Landmark'], ['Georgia State Capitol', 33.749, -84.388, 'Landmark'], ['Zoo Atlanta', 33.7331, -84.3702, 'Landmark'],
    ['Oakland Cemetery', 33.7485, -84.3727, 'Landmark'], ['Krog Street Market', 33.7547, -84.3641, 'Food']
  ].map(([label, lat, lon, kind]) => ({ label, lat, lon, kind }));
  const PKIND = { hospital: 'Hospital', pharmacy: 'Pharmacy', clinic: 'Clinic', library: 'Library', senior: 'Senior center', community: 'Community center', grocery: 'Grocery', toilets: 'Restroom' };

  const S = { rail: null, marta: null, climate: null, T: null, dest: [], from: null, to: null, tap: 'to', last: null, sel: 0, route: null, avoid: new Set(store.get('avoid', [])), here: null };

  /* ---------- time helpers ---------- */
  const fmt = (m) => { m = Math.round(m); const day = Math.floor(m / 1440), mm = ((m % 1440) + 1440) % 1440, H = Math.floor(mm / 60), M = mm % 60; return ((H + 11) % 12 + 1) + ':' + pad(M) + ' ' + (H >= 12 ? 'PM' : 'AM') + (day > 0 ? ' (next day)' : ''); };
  const dur = (m) => { m = Math.max(0, Math.round(m)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? pad(m % 60) + ' min' : ''); };
  const dateISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayLabel = (d) => `${DAYN[d.getDay()]}, ${MON[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const atMinutes = (d, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.round(m), 0);   // handles minutes past 1440
  const metres = (m) => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
  const needs = () => new Set(store.get('needs', []));
  const profileKey = () => { const n = needs(); return n.has('wheel') ? 'wheelchair' : n.has('walk') ? 'walker' : n.has('sight') ? 'lowvision' : 'general'; };
  const easy = () => needs().has('easy');

  /* ================= the map: tiles on a canvas, with our own pan, pinch and zoom ================= */
  const MAP = (function () {
    const cv = $('#tmap'), g = cv.getContext('2d'), wrap = cv.parentElement;
    const mx = (lon) => (lon + 180) / 360, my = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
    const ilon = (x) => x * 360 - 180, ilat = (y) => { const n = Math.PI - 2 * Math.PI * y; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
    const V = { cx: mx(-84.385), cy: my(33.775), z: 11.4 }; let w = 0, h = 0, dpr = 1, raf = 0, fly = null, tileFails = 0, tileOk = 0;
    const cache = new Map();
    const ws = () => 256 * Math.pow(2, V.z);
    const toScr = (lon, lat) => [(mx(lon) - V.cx) * ws() + w / 2, (my(lat) - V.cy) * ws() + h / 2];
    const fromScr = (x, y) => [ilon(V.cx + (x - w / 2) / ws()), ilat(V.cy + (y - h / 2) / ws())];
    function size() { const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); w = r.width; h = r.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); draw(); }
    const want = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    function tile(z, x, y) {
      const k = z + '/' + x + '/' + y; let t = cache.get(k);
      if (!t) {
        t = new Image(); t.crossOrigin = 'anonymous'; t.decoding = 'async'; t.done = false;
        t.onload = () => { t.done = true; tileOk++; $('#m-fail').hidden = true; want(); };
        t.onerror = () => { tileFails++; if (tileFails > 6 && !tileOk) $('#m-fail').hidden = false; };
        t.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
        cache.set(k, t); if (cache.size > 500) cache.delete(cache.keys().next().value);
      }
      return t;
    }
    const cssv = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
    function draw() {
      if (!w) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#e8e2d4'; g.fillRect(0, 0, w, h);
      const zi = clamp(Math.round(V.z), 8, 17), n = 1 << zi, scale = Math.pow(2, V.z - zi), ts = 256 * scale, W0 = ws();
      const x0 = Math.floor((V.cx - w / 2 / W0) * n), x1 = Math.floor((V.cx + w / 2 / W0) * n), y0 = Math.max(0, Math.floor((V.cy - h / 2 / W0) * n)), y1 = Math.min(n - 1, Math.floor((V.cy + h / 2 / W0) * n));
      g.imageSmoothingEnabled = true; try { g.filter = 'grayscale(0.55) saturate(0.8) brightness(1.04)'; } catch (e) {}   // calm the colours so the route is what you see
      for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
        const im = tile(zi, ((tx % n) + n) % n, ty); if (!im.done) continue;
        g.drawImage(im, (tx / n - V.cx) * W0 + w / 2, (ty / n - V.cy) * W0 + h / 2, ts + 0.6, ts + 0.6);
      }
      try { g.filter = 'none'; } catch (e) {}
      overlays();
    }
    function path(pts) { g.beginPath(); pts.forEach((p, i) => { const q = toScr(p.lon, p.lat); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); }
    function lines() {
      if (!S.rail) return;
      g.lineCap = 'round'; g.lineJoin = 'round';
      const drawn = new Set();
      for (const [name, wd, a] of [['RED', 6, 0.5], ['BLUE', 6, 0.5], ['GOLD', 2.6, 0.95], ['GREEN', 2.6, 0.95]]) {
        const p = S.rail.patterns.filter((q) => q.line === name && q.dir === 0).sort((x, y) => y.stops.length - x.stops.length)[0]; if (!p || drawn.has(name)) continue;
        path(p.stops.map((id) => S.T.byId.get(id))); g.strokeStyle = S.rail.colors[name]; g.globalAlpha = a; g.lineWidth = wd; g.stroke(); g.globalAlpha = 1;
      }
    }
    function dot(lon, lat, r, fill, stroke, lw) { const q = toScr(lon, lat); g.beginPath(); g.arc(q[0], q[1], r, 0, 7); g.fillStyle = fill; g.fill(); g.lineWidth = lw || 2; g.strokeStyle = stroke; g.stroke(); return q; }
    function label(text, x, y, size, color) { g.font = `700 ${size}px "Hanken Grotesk", system-ui, sans-serif`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.strokeText(text, x, y); g.fillStyle = color || '#2a1f17'; g.fillText(text, x, y); }
    function marker(pt, ch, color) {
      const q = toScr(pt.lon, pt.lat); g.beginPath(); g.moveTo(q[0], q[1]); g.bezierCurveTo(q[0] - 15, q[1] - 16, q[0] - 15, q[1] - 36, q[0], q[1] - 36); g.bezierCurveTo(q[0] + 15, q[1] - 36, q[0] + 15, q[1] - 16, q[0], q[1]); g.fillStyle = color; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = '800 14px "Hanken Grotesk", sans-serif'; g.textAlign = 'center'; g.fillText(ch, q[0], q[1] - 20);
    }
    function overlays() {
      lines();
      const R = S.route;
      if (R) {
        for (const l of R.legs) {
          if (l.type === 'walk') { path([l.fromPt, l.toPt]); g.setLineDash([2, 8]); g.lineWidth = 7; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 4; g.strokeStyle = '#c24a0e'; g.stroke(); g.setLineDash([]); }
          if (l.type === 'rail') { const pts = l.stops.map((id) => S.T.byId.get(id)); path(pts); g.lineWidth = 11; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 6; g.strokeStyle = l.color; g.stroke(); }
        }
        for (const l of R.legs) if (l.type === 'rail') { for (const id of [l.stops[0], l.stops[l.stops.length - 1]]) { const s = S.T.byId.get(id); dot(s.lon, s.lat, 6.5, '#fff', '#2a1f17', 3); } }
      }
      const z = V.z;
      for (const s of S.T ? S.T.stations : []) { const q = toScr(s.lon, s.lat); if (q[0] < -20 || q[1] < -20 || q[0] > w + 20 || q[1] > h + 20) continue; dot(s.lon, s.lat, z > 12 ? 5 : 3.5, S.avoid.has(s.id) ? '#b3261e' : '#fff', '#2a1f17', 2); if (z >= 11.6) label(s.name.replace(/ Station$/, ''), q[0], q[1] - 10, 11); }
      if (S.here) dot(S.here.lon, S.here.lat, 7, '#1d5fa8', '#fff', 3);
      if (S.from) marker(S.from, 'A', '#1f7a3d');
      if (S.to) marker(S.to, 'B', '#c24a0e');
    }
    /* movement */
    const ptrs = new Map(); let moved = 0, startX = 0, startY = 0, pinch0 = 0;
    function zoomAt(px, py, nz) { nz = clamp(nz, 9, 17.5); const before = fromScr(px, py); V.z = nz; const a = toScr(before[0], before[1]); V.cx += (a[0] - px) / ws(); V.cy += (a[1] - py) / ws(); }
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); if (ptrs.size === 1) { moved = 0; startX = e.offsetX; startY = e.offsetY; } if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } fly = null; });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
      if (ptrs.size === 1) { V.cx -= dx / ws(); V.cy -= dy / ws(); moved += Math.abs(dx) + Math.abs(dy); }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, V.z + Math.log2(d / pinch0)); pinch0 = d; moved += 9; }
      want();
    });
    const up = (e) => { const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (was && ptrs.size === 0 && moved < 6 && e.type === 'pointerup') click(e.offsetX, e.offsetY); pinch0 = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, V.z - e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)); want(); }, { passive: false });
    function click(x, y) {
      let best = null; for (const s of S.T.stations) { const q = toScr(s.lon, s.lat), d = Math.hypot(q[0] - x, q[1] - y); if (d < 18 && (!best || d < best.d)) best = { d, s }; }
      const pt = best ? { lat: best.s.lat, lon: best.s.lon, label: best.s.name.replace(/ Station$/, '') + ' Station' } : (() => { const [lon, lat] = fromScr(x, y); return { lat, lon, label: nearName(lat, lon) }; })();
      UI.setPoint(S.tap, pt);
    }
    function flyTo(cx, cy, z) { if (reduce) { V.cx = cx; V.cy = cy; V.z = z; want(); return; } fly = { cx0: V.cx, cy0: V.cy, z0: V.z, cx, cy, z, t0: performance.now() }; step(); }
    function step() { if (!fly) return; const t = clamp((performance.now() - fly.t0) / 650, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; V.cx = fly.cx0 + (fly.cx - fly.cx0) * e; V.cy = fly.cy0 + (fly.cy - fly.cy0) * e; V.z = fly.z0 + (fly.z - fly.z0) * e; draw(); if (t < 1) requestAnimationFrame(step); else fly = null; }
    function fit(points, pad) {
      const pts = points.filter(Boolean); if (!pts.length) return;
      const xs = pts.map((p) => mx(p.lon)), ys = pts.map((p) => my(p.lat)), minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const px = (pad || 70), ex = Math.max(maxx - minx, 0.0008), ey = Math.max(maxy - miny, 0.0008);
      const z = clamp(Math.min(Math.log2((w - px * 2) / (256 * ex)), Math.log2((h - px * 2 - 30) / (256 * ey))), 9.5, 16);
      flyTo((minx + maxx) / 2, (miny + maxy) / 2 - 18 / (256 * Math.pow(2, z)), z);
    }
    $('#z-in').onclick = () => { flyTo(V.cx, V.cy, clamp(V.z + 1, 9, 17.5)); }; $('#z-out').onclick = () => { flyTo(V.cx, V.cy, clamp(V.z - 1, 9, 17.5)); };
    $('#z-fit').onclick = () => { if (S.route) fit(routePoints()); else fit(S.T.stations.filter((s) => s.lat > 33.68 && s.lat < 33.9 && s.lon > -84.5 && s.lon < -84.25)); };
    new ResizeObserver(size).observe(cv); size();
    return { V, draw, want, fit, flyTo, size, toScr, center: (pt, z) => flyTo(mx(pt.lon), my(pt.lat), z) };
  })();
  const routePoints = () => { const o = []; for (const l of S.route.legs) { if (l.fromPt) o.push(l.fromPt); if (l.toPt) o.push(l.toPt); if (l.stops) l.stops.forEach((id) => o.push(S.T.byId.get(id))); } return o; };
  function nearName(lat, lon) {
    let best = null; for (const d of S.dest) { const m = S.A.dist({ lat, lon }, d); if (m < 450 && (!best || m < best.m)) best = { m, d }; }
    return best ? 'Near ' + best.d.label : 'Dropped pin';
  }

  /* ================= combo boxes: type to search, arrow keys, Enter ================= */
  function combo(id, onPick) {
    const root = $('#c-' + id), input = $('input', root), list = $('.clist', root);
    let items = [], idx = -1, token = 0;
    const base = () => {
      const pop = ['Five Points Station', 'Midtown Station', 'Decatur Station', 'Airport Station', 'Buckhead Station'];
      return [...LANDMARKS.slice(0, 8).map((d) => Object.assign({}, d, { sub: d.kind })), ...pop.map((n) => S.dest.find((d) => d.label === n)).filter(Boolean)];
    };
    function find(q) {
      q = q.trim().toLowerCase(); if (!q) return base();
      const toks = q.split(/\s+/), out = [];
      for (const d of S.dest) { const L = d.label.toLowerCase(); if (!toks.every((t) => L.includes(t))) continue; out.push({ d, s: (L.startsWith(q) ? 0 : L.includes(' ' + q) ? 1 : 2) + (d.kind === 'Station' ? 0.3 : 0) + L.length / 400 }); }
      return out.sort((a, b) => a.s - b.s).slice(0, 8).map((o) => Object.assign({}, o.d, { sub: o.d.kind }));
    }
    function render() {
      list.innerHTML = items.map((it, i) => it.action ? `<li role="option" id="${id}-o${i}" data-i="${i}" class="act${i === idx ? ' on' : ''}" aria-selected="${i === idx}">${it.html}</li>` : `<li role="option" id="${id}-o${i}" data-i="${i}" class="${i === idx ? 'on' : ''}" aria-selected="${i === idx}"><span>${esc(it.label)}</span><small>${esc(it.sub || '')}</small></li>`).join('');
      list.hidden = !items.length; input.setAttribute('aria-expanded', String(!list.hidden));
      if (idx >= 0) input.setAttribute('aria-activedescendant', `${id}-o${idx}`); else input.removeAttribute('aria-activedescendant');
    }
    function open(q) {
      items = find(q);
      if (id === 'from') items.push({ action: 'here', html: '<span>Use my location</span><small>stays in your browser</small>' });
      if (q.trim().length >= 3) items.push({ action: 'addr', q, html: `<span>Search an address: “${esc(q.trim())}”</span><small>sends your words to OpenStreetMap</small>` });
      idx = -1; render();
    }
    async function address(q) {
      const my = ++token; items = [{ action: 'wait', html: '<span>Searching…</span>' }]; render();
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&viewbox=-84.75,34.15,-83.95,33.45&bounded=1&q=' + encodeURIComponent(q));
        const rows = await r.json(); if (my !== token) return;
        items = rows.length ? rows.map((x) => ({ label: x.display_name.split(',').slice(0, 3).join(',').trim(), lat: +x.lat, lon: +x.lon, sub: 'Address' })) : [{ action: 'wait', html: '<span>No address found in metro Atlanta. Try fewer words.</span>' }];
      } catch (e) { items = [{ action: 'wait', html: '<span>Address search is not available right now.</span>' }]; }
      idx = -1; render();
    }
    function pick(i) {
      const it = items[i]; if (!it || it.action === 'wait') return;
      if (it.action === 'addr') return address(it.q);
      if (it.action === 'here') { UI.locate(); close(); return; }
      input.value = it.label; close(); onPick({ lat: it.lat, lon: it.lon, label: it.label });
    }
    function close() { items = []; idx = -1; list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    input.addEventListener('input', () => { onPick(null, true); open(input.value); });
    input.addEventListener('focus', () => { if (!input.value) open(''); else input.select(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(input.value); else { idx = (idx + 1) % items.length; render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; render(); }
      else if (e.key === 'Enter') { if (!list.hidden && items.length) { e.preventDefault(); pick(idx >= 0 ? idx : 0); } }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
    return { set(pt) { input.value = pt ? pt.label : ''; }, focus() { input.focus(); } };
  }

  /* ================= planning and results ================= */
  const UI = {};
  UI.setPoint = (which, pt) => {
    S[which] = pt; (which === 'from' ? UI.cFrom : UI.cTo).set(pt); S.route = null; msg('');
    const both = [S.from, S.to].filter(Boolean); both.length > 1 ? MAP.fit(both) : MAP.center(pt, 13.4); MAP.want();
  };
  UI.locate = () => {
    if (!navigator.geolocation) { msg('Your browser cannot share location. Pick a station instead.'); return; }
    msg('Finding you…');
    navigator.geolocation.getCurrentPosition((p) => { S.here = { lat: p.coords.latitude, lon: p.coords.longitude }; UI.setPoint('from', { lat: S.here.lat, lon: S.here.lon, label: 'My location' }); msg('Using your location. It stays in your browser.'); }, () => msg('Could not get your location. Type a place instead.'), { timeout: 10000 });
  };
  const msg = (t) => { $('#t-msg').textContent = t; };

  function request() {
    const mode = $('input[name=mode]:checked').value, now = new Date();
    let date = parseISO($('#i-date').value || dateISO(now)), tm = $('#i-time').value || '08:00', minutes = +tm.slice(0, 2) * 60 + +tm.slice(3, 5);
    if (mode === 'now') { date = new Date(now.getFullYear(), now.getMonth(), now.getDate()); minutes = now.getHours() * 60 + now.getMinutes(); }
    return { from: S.from, to: S.to, date, minutes, mode: mode === 'now' ? 'depart' : mode };
  }
  function run(req, opts) {
    const profile = Object.assign({}, S.A.PROFILES[profileKey()]), mw = +$('#i-walk').value; if (mw) profile.maxWalk = mw;
    return S.T.plan(req, { profile, climate: S.climate, avoid: S.avoid });
  }
  function go() {
    if (!S.from || !S.to) { msg(!S.from ? 'Choose where you are starting from the list.' : 'Choose a destination from the list.'); (!S.from ? $('#i-from') : $('#i-to')).focus(); return; }
    if (S.from.lat === S.to.lat && S.from.lon === S.to.lon) { msg('Your start and destination are the same place.'); return; }
    const req = request(), res = run(req); S.last = { req, res }; S.sel = 0; msg('');
    if (res.error) { S.route = null; $('#tresult').innerHTML = `<div class="t-empty"><h3>No train trip found</h3><p>${esc(res.error)}</p>${mobilityHTML()}</div>`; MAP.want(); return; }
    show(0, true); const h = $('#tresult h3'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    if (innerWidth < 960) $('#tresult').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  const mobilityHTML = () => '<p class="tiny">If you cannot use trains and buses, <a href="https://itsmarta.com/marta-mobility.aspx" rel="noopener">MARTA Mobility</a> gives door-to-door rides after you apply. MARTA buses are not in this planner yet.</p>';

  function legHTML(l, E) {
    if (l.type === 'walk') return `<li class="l-walk"><span class="lt"></span><div><b>Walk ${metres(l.metres)}</b> <span class="mut">${dur(l.min)}</span><br>to ${esc(l.to)}${l.metres > 700 && !E ? '<br><span class="mut">A long walk. Take it slow, and rest if you need to.</span>' : ''}</div></li>`;
    if (l.type === 'wait') return l.min >= 1 ? `<li class="l-wait"><span class="lt"></span><div>Wait about ${dur(l.min)} at ${esc(l.at)}</div></li>` : '';
    if (l.type === 'transfer') return `<li class="l-wait"><span class="lt"></span><div><b>Change at ${esc(l.at)}.</b> ${E ? 'Use the elevator.' : 'Take the elevator, not the stairs.'} Wait about ${dur(l.min)}.</div></li>`;
    const nm = l.line.charAt(0) + l.line.slice(1).toLowerCase();
    return `<li class="l-rail" style="--lc:${l.color}"><span class="lt"></span><div><b>${nm} line train</b> toward ${esc(l.toward)}<br>${esc(l.from)} → ${esc(l.to)}${E ? '' : ` · ${l.count} stop${l.count > 1 ? 's' : ''}`}<br><span class="tm">${fmt(l.dep)} → ${fmt(l.arr)}</span></div></li>`;
  }
  function flagsHTML(o, req) {
    const E = easy(), f = [], p = Object.assign({}, S.A.PROFILES[profileKey()], +$('#i-walk').value ? { maxWalk: +$('#i-walk').value } : {});
    if (o.kind === 'rail') f.push(o.tier === 'confirmed' ? '<li class="ok">MARTA lists these stations as step-free.</li>' : o.tier === 'unknown' || o.tier === 'limited' ? '<li class="warn">MARTA has not confirmed step-free access at one of these stations. Call MARTA first.</li>' : '');
    if (o.kind === 'rail') f.push('<li>Elevators break. <a href="https://itsmarta.com/" rel="noopener">Check MARTA alerts</a> before you leave.</li>');
    if (o.heat === 'danger' || o.heat === 'high') {
      const bh = S.A.bestHours(S.climate, req.date.getMonth(), p, { from: 6, to: 20 }).window;
      f.push(`<li class="warn">It will feel like ${Math.round(o.feels)}°F when you leave. ${E ? 'Bring water.' : 'Bring water, and rest in shade or inside.'}${bh ? ` <button type="button" class="linkbtn" data-try="${bh.start * 60}">Try ${fmt(bh.start * 60)}</button>` : ''}</li>`);
    } else if (o.heat === 'cold') f.push('<li class="warn">It will feel near freezing. Watch for ice on ramps and crossings.</li>');
    if (o.longWalk) f.push(`<li class="warn">${E ? 'One walk is long.' : `One walk is longer than the ${metres(p.maxWalk)} you said is comfortable.`} MARTA Mobility or a ride can cover that part.</li>`);
    if (!S.T.inFeed(req.date)) f.push('<li>This date is past MARTA\'s published schedule. We assume the usual service for that day.</li>');
    return f.filter(Boolean).join('');
  }
  function show(i, fit) {
    const { req, res } = S.last, E = easy(); S.sel = i; S.route = res.options[i];
    const cards = res.options.map((o, k) => {
      const on = k === i, door = o.total, ride = o.legs.filter((l) => l.type === 'rail').length;
      const head = `<div class="oh"><span class="badge b${k}">${esc(o.label)}</span><span class="when">Leave ${fmt(o.leave)}<i>→</i>arrive ${fmt(o.arrive)}</span></div>
        <p class="osum"><b>${dur(door)}</b> door to door · ${metres(o.walkM)} walking${o.transfers ? ` · ${o.transfers} change${o.transfers > 1 ? 's' : ''}` : ' · no changes'}${E ? '' : ` · ${o.kind === 'walk' ? 'walk only' : ride + ' train' + (ride > 1 ? 's' : '')}`}</p>`;
      if (!on) return `<article class="opt" data-k="${k}">${head}<button type="button" class="btn ghost small" data-pick="${k}">Show this trip</button></article>`;
      return `<article class="opt on" data-k="${k}" aria-current="true">${head}<p class="why">${esc(o.why)}</p><ol class="legs">${o.legs.map((l) => legHTML(l, E)).join('')}</ol><ul class="flags">${flagsHTML(o, req)}</ul>
        <div class="oacts"><button type="button" class="btn" data-sch="${k}">Schedule this trip</button><button type="button" class="btn ghost" data-read="${k}">Read aloud</button><button type="button" class="btn ghost" data-ics="${k}">Calendar file</button></div>
        <form class="sched" id="sched" hidden></form></article>`;
    }).join('');
    const dow = S.T.dayKind(req.date) === 'wk' ? 'weekday' : S.T.dayKind(req.date) === 'sa' ? 'Saturday' : 'Sunday';
    $('#tresult').innerHTML = `<h3 id="t-title">${esc(S.from.label)} to ${esc(S.to.label)}</h3><p class="tiny">${dayLabel(req.date)} · ${dow} train times${req.mode === 'arrive' ? ' · arriving by ' + fmt(req.minutes) : ''}</p>${cards}${res.notes.map((n) => `<p class="tiny note">${esc(n)}</p>`).join('')}<p class="tiny">Train times: MARTA's published schedule, valid ${esc(S.rail.valid[0])} to ${esc(S.rail.valid[1])}. Station access: MARTA's data; "unknown" means MARTA has not said. Sidewalk slopes, surfaces and curb ramps are not known. Includes MARTA rail only. Buses and live delays are not in this planner yet.${mobilityHTML()}</p>`;
    MAP.want(); if (fit) MAP.fit(routePoints());
  }

  /* ================= schedule, reminders, calendar ================= */
  const OFFS = [[60, 'An hour before you leave'], [15, '15 minutes before you leave'], [0, 'When it is time to leave']];
  const trips = () => store.get('trips', []);
  function schedForm(k) {
    const f = $('#sched'); const o = S.last.res.options[k], d = atMinutes(S.last.req.date, o.leave);
    f.hidden = false;
    f.innerHTML = `<fieldset><legend>Remind me</legend>${OFFS.map(([m, t], i) => `<label class="chk"><input type="checkbox" name="off" value="${m}" ${i < 2 ? 'checked' : ''}> ${t}</label>`).join('')}</fieldset>
      <label class="fld">Note for yourself (optional)<input type="text" id="s-note" maxlength="80" placeholder="Dr. Patel, 11:00"></label>
      <div class="oacts"><button type="submit" class="btn">Save trip</button><button type="button" class="btn ghost" id="s-cancel">Cancel</button></div>
      <p class="tiny">Saved on this device. You will leave ${esc(dayLabel(d))} at ${fmt(o.leave)}.</p>`;
    f.onsubmit = (e) => { e.preventDefault(); save(k, [...f.querySelectorAll('input[name=off]:checked')].map((x) => +x.value), $('#s-note').value.trim()); f.hidden = true; };
    $('#s-cancel').onclick = () => { f.hidden = true; };
    $('input', f).focus();
  }
  function stepsOf(o) { return o.legs.filter((l) => l.type !== 'wait').map((l) => l.type === 'walk' ? `Walk ${metres(l.metres)} to ${l.to}` : l.type === 'transfer' ? `Change at ${l.at}` : `${l.line.charAt(0) + l.line.slice(1).toLowerCase()} line toward ${l.toward}, ${l.from} to ${l.to}, ${fmt(l.dep)} to ${fmt(l.arr)}`); }
  function save(k, offs, note) {
    const { req } = S.last, o = S.last.res.options[k];
    const t = { id: Date.now().toString(36), from: S.from, to: S.to, date: dateISO(req.date), leave: Math.round(o.leave), arrive: Math.round(o.arrive), label: o.label, steps: stepsOf(o), offs, fired: {}, note, mode: req.mode, minutes: req.minutes, kind: o.kind };
    const all = trips(); all.push(t); store.set('trips', all); renderTrips(); toast('Trip saved', `${S.from.label} to ${S.to.label}, leaving ${dayLabel(req.date)} at ${fmt(o.leave)}. ${offs.length ? 'We will remind you while this page is open.' : ''}`, true);
    $('#mytrips').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  const leaveDate = (t) => atMinutes(parseISO(t.date), t.leave);
  const rel = (ms) => { const m = Math.round(ms / 60000); if (m < -1) return 'Past'; if (m < 1) return 'Time to go'; if (m < 60) return `In ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `In ${h} h ${pad(m % 60)} min`; const d = Math.floor(h / 24); return `In ${d} day${d > 1 ? 's' : ''}`; };
  function renderTrips() {
    const all = trips().sort((a, b) => leaveDate(a) - leaveDate(b)), ul = $('#t-list'), nowMs = Date.now();
    if (!all.length) { ul.innerHTML = '<li class="t-none">No trips yet. Plan a trip above and choose “Schedule this trip”.</li>'; return; }
    ul.innerHTML = all.map((t) => {
      const ld = leaveDate(t), past = ld - nowMs < -120000, d = parseISO(t.date);
      return `<li class="trip${past ? ' past' : ''}" data-id="${t.id}"><div class="tt"><div><h3>${esc(t.from.label)} to ${esc(t.to.label)}</h3><p>${dayLabel(d)} · leave <b>${fmt(t.leave)}</b>, arrive ${fmt(t.arrive)}${t.note ? ` · <em>${esc(t.note)}</em>` : ''}</p></div><span class="when-chip${past ? ' off' : ''}">${rel(ld - nowMs)}</span></div>
        <details><summary>Steps</summary><ol class="mini">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>
        <p class="rems">${t.offs.length ? t.offs.sort((a, b) => b - a).map((m) => `<span class="rem${t.fired[m] ? ' sent' : ''}">${t.fired[m] ? '✓ ' : ''}${m ? m + ' min before' : 'At leave time'}</span>`).join('') : '<span class="rem">No reminders</span>'}</p>
        <div class="oacts"><button type="button" class="btn ghost small" data-tshow="${t.id}">Check times and show on map</button><button type="button" class="btn ghost small" data-tics="${t.id}">Calendar file</button><button type="button" class="btn ghost small" data-tdel="${t.id}">Remove</button></div></li>`;
    }).join('');
  }
  /* reminders: checked every 20 seconds while the page is open */
  function toast(title, body, quiet) {
    let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'assertive'); document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', quiet ? 'status' : 'alert');
    el.innerHTML = `<div><b>${esc(title)}</b><p>${esc(body)}</p></div><button type="button" aria-label="Dismiss">×</button>`; box.appendChild(el);
    const kill = () => el.remove(); $('button', el).onclick = kill; setTimeout(kill, quiet ? 9000 : 90000);
  }
  function fire(t, m) {
    const first = t.steps[0] || '', head = m === 0 ? 'Time to leave' : `Leave in ${m} minutes`, body = `${t.from.label} to ${t.to.label}. ${first}.${t.note ? ' ' + t.note + '.' : ''}`;
    toast(head, body);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(head, { body }); } catch (e) {}
    if ($('#n-speak').checked && window.speechSynthesis) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(head + '. ' + body); u.rate = 0.9; speechSynthesis.speak(u); } catch (e) {} }
  }
  function tick() {
    const all = trips(), nowMs = Date.now(); let dirty = false;
    for (const t of all) { const ld = leaveDate(t).getTime(); for (const m of t.offs) { const at = ld - m * 60000; if (!t.fired[m] && nowMs >= at && nowMs < at + 10 * 60000) { t.fired[m] = true; dirty = true; fire(t, m); } } }
    if (dirty) store.set('trips', all);
    renderTrips();
  }
  const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function ics(t) {
    const st = (m) => { const d = atMinutes(parseISO(t.date), m); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`; };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', offs = t.offs.length ? t.offs : [15];
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SUNDIAL ATL//Trip//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${t.id}@sundial-atl`, `DTSTAMP:${stamp}`, `DTSTART:${st(t.leave)}`, `DTEND:${st(t.arrive)}`, `SUMMARY:${icsEsc('Trip: ' + t.from.label + ' to ' + t.to.label)}`, `LOCATION:${icsEsc(t.to.label)}`, `DESCRIPTION:${icsEsc((t.note ? t.note + '\n' : '') + t.steps.join('\n') + '\nCheck MARTA alerts for elevator outages before you leave.')}`];
    for (const m of offs) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${m ? 'Leave in ' + m + ' minutes' : 'Time to leave'}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    L.push('END:VEVENT', 'END:VCALENDAR');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' })); a.download = 'sundial-atl-trip.ics'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function readAloud(o) {
    if (!window.speechSynthesis) return; if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const txt = `${S.from.label} to ${S.to.label}. Leave at ${fmt(o.leave)}, arrive at ${fmt(o.arrive)}. ${stepsOf(o).join('. ')}.`;
    const u = new SpeechSynthesisUtterance(txt); u.rate = 0.9; speechSynthesis.speak(u);
  }

  /* ================= wiring ================= */
  function buildDest() {
    const st = S.T.stations.map((s) => ({ label: s.name.replace(/ Station$/, '') + ' Station', lat: s.lat, lon: s.lon, kind: 'Station' }));
    S.dest = [...LANDMARKS, ...st, ...(S.places || []).filter((p) => p.n && p.k !== 'toilets').map((p) => ({ label: p.n, lat: p.la, lon: p.lo, kind: PKIND[p.k] || 'Place' }))];
  }
  function chips() {
    const el = $('#t-needs'), n = needs(); el.innerHTML = '';
    NEEDS.forEach(([id, label]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label; b.setAttribute('aria-pressed', n.has(id)); b.onclick = () => { const s = needs(); s.has(id) ? s.delete(id) : s.add(id); store.set('needs', [...s]); window.dispatchEvent(new CustomEvent('needs-changed')); chips(); if (S.last) go(); }; el.appendChild(b); });
  }
  function avoidUI() {
    const sel = $('#a-sel'); sel.innerHTML = S.T.stations.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => `<option value="${s.id}">${esc(s.name.replace(/ Station$/, ''))}</option>`).join('');
    const draw = () => { $('#a-list').innerHTML = [...S.avoid].map((id) => `<li><span>${esc(S.T.byId.get(id).name.replace(/ Station$/, ''))}: elevator out</span><button type="button" data-av="${id}" aria-label="Stop avoiding ${esc(S.T.byId.get(id).name)}">Remove</button></li>`).join(''); store.set('avoid', [...S.avoid]); MAP.want(); };
    $('#a-add').onclick = () => { S.avoid.add(sel.value); draw(); if (S.last) go(); };
    $('#a-list').addEventListener('click', (e) => { const b = e.target.closest('[data-av]'); if (b) { S.avoid.delete(b.dataset.av); draw(); if (S.last) go(); } });
    draw();
  }
  function init() {
    buildDest(); chips(); avoidUI();
    UI.cFrom = combo('from', (pt, typing) => { if (typing) { S.from = null; S.route = null; } else if (pt) UI.setPoint('from', pt); });
    UI.cTo = combo('to', (pt, typing) => { if (typing) { S.to = null; S.route = null; } else if (pt) UI.setPoint('to', pt); });
    const now = new Date(), r = Math.ceil((now.getHours() * 60 + now.getMinutes() + 10) / 5) * 5;
    $('#i-date').value = dateISO(now); $('#i-date').min = dateISO(now); $('#i-time').value = `${pad(Math.floor(r / 60) % 24)}:${pad(r % 60)}`;
    const sync = () => { const m = $('input[name=mode]:checked').value; $('#i-date').disabled = $('#i-time').disabled = m === 'now'; };
    document.querySelectorAll('input[name=mode]').forEach((x) => x.addEventListener('change', sync)); sync();
    $('#tform').addEventListener('submit', (e) => { e.preventDefault(); go(); });
    $('#b-loc').onclick = UI.locate;
    $('#b-swap').onclick = () => { const a = S.from, b = S.to; S.from = b; S.to = a; UI.cFrom.set(b); UI.cTo.set(a); if (S.last) go(); else { S.route = null; MAP.want(); } };
    const tapSet = (w) => { S.tap = w; $('#mt-to').setAttribute('aria-pressed', w === 'to'); $('#mt-from').setAttribute('aria-pressed', w === 'from'); };
    $('#mt-to').onclick = () => tapSet('to'); $('#mt-from').onclick = () => tapSet('from');
    $('#tresult').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pick != null) show(+b.dataset.pick, true);
      else if (b.dataset.sch != null) schedForm(+b.dataset.sch);
      else if (b.dataset.read != null) readAloud(S.last.res.options[+b.dataset.read]);
      else if (b.dataset.ics != null) { const o = S.last.res.options[+b.dataset.ics]; ics({ id: Date.now().toString(36), from: S.from, to: S.to, date: dateISO(S.last.req.date), leave: o.leave, arrive: o.arrive, steps: stepsOf(o), offs: [60, 15], note: '' }); }
      else if (b.dataset.try != null) { const m = +b.dataset.try; $('#i-time').value = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; document.getElementById(S.last.req.mode === 'arrive' ? 'm-arr' : 'm-dep').checked = true; sync(); go(); }
    });
    $('#i-walk').addEventListener('change', () => { if (S.last) go(); });
    $('#t-list').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const all = trips();
      if (b.dataset.tdel) { store.set('trips', all.filter((t) => t.id !== b.dataset.tdel)); renderTrips(); }
      else if (b.dataset.tics) ics(all.find((t) => t.id === b.dataset.tics));
      else if (b.dataset.tshow) { const t = all.find((x) => x.id === b.dataset.tshow); S.from = t.from; S.to = t.to; UI.cFrom.set(t.from); UI.cTo.set(t.to); $('#i-date').value = t.date; $('#i-time').value = `${pad(Math.floor(t.minutes / 60) % 24)}:${pad(t.minutes % 60)}`; document.getElementById(t.mode === 'arrive' ? 'm-arr' : 'm-dep').checked = true; sync(); go(); $('#trip').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); }
    });
    const perm = $('#n-perm'); if (!('Notification' in window)) perm.hidden = true;
    else { const upd = () => { perm.textContent = Notification.permission === 'granted' ? 'Pop-up reminders are on' : Notification.permission === 'denied' ? 'Pop-ups are blocked in your browser' : 'Turn on pop-up reminders'; perm.disabled = Notification.permission !== 'default'; }; upd(); perm.onclick = () => Notification.requestPermission().then(upd); }
    const sp = $('#n-speak'); sp.checked = store.get('speak', false); sp.onchange = () => store.set('speak', sp.checked);
    window.addEventListener('needs-changed', chips);
    renderTrips(); tick(); setInterval(tick, 20000);
    // start somewhere useful so the map and form are not empty: Five Points to Decatur is the classic crosstown ride
    MAP.fit(S.T.stations.filter((s) => s.lat > 33.68 && s.lat < 33.9 && s.lon > -84.5 && s.lon < -84.25), 40);
    window.SDTRIP = { S, go, run, show, tick, MAP };
  }

  Promise.all([get('data/rail.json'), get('data/marta.json'), get('data/climate.json'), get('data/places.json').catch(() => ({ places: [] }))]).then(([rail, marta, climate, places]) => {
    S.rail = rail; S.marta = marta; S.climate = climate; S.places = places.places; S.A = window.ACCESS; S.T = window.TRANSIT.create(rail, marta); init();
  }).catch((e) => { console.error(e); const f = $('#tform'); if (f) f.insertAdjacentHTML('afterbegin', '<p><b>The trip planner could not load its data. Please refresh.</b></p>'); });
})();
