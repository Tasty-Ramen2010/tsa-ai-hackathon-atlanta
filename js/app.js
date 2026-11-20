/* SUNDIAL ATL app. Reuses SUNDIAL's sky (js/sky.js), sheet, dock and data-confidence idea. */
(function () {
  const d3 = window.d3, $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const LAT = 33.749, LON = -84.388;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  const NEEDS = [
    ['wheel', 'Wheelchair or scooter'], ['walk', "Can't walk far"], ['sight', 'Low vision or blind'],
    ['hear', 'Deaf or hard of hearing'], ['easy', 'Plain, simple words']
  ];
  const KINDS = [
    ['pharmacy', 'Pharmacy'], ['hospital', 'Hospital'], ['clinic', 'Clinic'], ['library', 'Library (cool, quiet)'],
    ['senior', 'Senior center'], ['community', 'Community center'], ['grocery', 'Grocery'], ['toilets', 'Restroom']
  ];
  const KNAME = { pharmacy: 'pharmacy', hospital: 'hospital', clinic: 'clinic', library: 'library', senior: 'senior center', community: 'community center', grocery: 'grocery store', toilets: 'restroom' };

  const S = {
    hour: store.get('hour', (new Date().getHours() + (new Date().getMinutes() >= 30 ? 0.5 : 0))), month: new Date().getMonth() + 1,
    needs: new Set(store.get('needs', [])), kind: store.get('kind', 'pharmacy'), origin: null, places: [], marta: null, climate: null, counties: null,
    selected: null, results: []
  };
  const dow = (new Date().getDay() + 6) % 7; // Mo=0

  /* ---------- helpers ---------- */
  const hmm = (h) => { const H = Math.floor(h), M = Math.round((h - H) * 60); const ap = H >= 12 ? 'PM' : 'AM'; return ((H + 11) % 12 + 1) + ':' + String(M).padStart(2, '0') + ' ' + ap; };
  const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const mi = (k) => k * 0.621371;
  const miText = (m) => m < 0.1 ? 'right here' : m.toFixed(1) + ' mi';
  const walkMph = () => (S.needs.has('walk') || S.needs.has('wheel') ? 2 : 3);
  const walkMin = (m) => Math.max(1, Math.round(m / walkMph() * 60));
  const easy = () => S.needs.has('easy');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- weather and light at the chosen hour ---------- */
  const hourIdx = () => Math.floor(S.hour) % 24;
  const feels = (h = S.hour, m = S.month) => S.climate ? S.climate.feels[m - 1][Math.floor(h) % 24] : 70;
  const isDay = (h, m) => SKY.sunAlt(LAT, m, h + (isDST(m) ? -1 : 0)) > -0.8;
  /* Clock hour is local civil time. Atlanta is on daylight time roughly March-October, so solar hour is 1 earlier. */
  const isDST = (m) => m >= 4 && m <= 10 || m === 3 && false;
  function sunTimes(m) { let rise = null, set = null, prev = isDay(0, m); for (let h = 0.25; h <= 24; h += 0.25) { const c = isDay(h, m); if (!prev && c && rise == null) rise = h; if (prev && !c && set == null) set = h; prev = c; } return { rise, set }; }
  function comfort(f) { // penalty: lower is better
    const hotAt = S.needs.has('walk') || S.needs.has('wheel') ? 80 : 84;
    return Math.max(0, f - hotAt) ** 1.4 + Math.max(0, 45 - f) ** 1.3;
  }
  function bestHours() {
    let best = null;
    for (let h = 7; h <= 18; h += 1) { if (!isDay(h, S.month)) continue; const c = comfort(feels(h)) + Math.abs(h - 11) * 0.4; if (!best || c < best.c) best = { h, c }; }
    return best ? best.h : 10;
  }
  function weatherAdvice(h = S.hour) {
    const f = feels(h), day = isDay(h, S.month), E = easy();
    const out = [];
    let cls = '';
    if (f >= 103) { cls = 'hot'; out.push(E ? 'Very hot. Stay inside if you can.' : 'Dangerous heat. Avoid being outside; if you must go, ride door to door and bring water.'); }
    else if (f >= 90) { cls = 'hot'; out.push(E ? 'Hot. Bring water. Rest often.' : 'Hot. Keep walks short, bring water and plan shade or an air-conditioned stop.'); }
    else if (f <= 32) { cls = 'cold'; out.push(E ? 'Freezing. Watch for ice. Wear warm clothes.' : 'Freezing. Watch for ice on ramps and curbs, wear layers and gloves.'); }
    else if (f <= 45) { cls = 'cold'; out.push(E ? 'Cold. Dress warm.' : 'Cold. Dress in layers; cold makes joints and mobility devices harder to manage.'); }
    else out.push(E ? 'This is a comfortable time to go.' : 'A comfortable time to be outside.');
    if (!day) { cls = cls || 'dark'; out.push(E ? 'It is dark. Use well-lit, busy routes.' : 'After dark: prefer lit, busy routes, and consider a ride.'); }
    return { text: out.join(' '), cls };
  }

  /* ---------- hero: sky, dial, curve ---------- */
  function paintSky() {
    const f = feels(), heat = clamp((f - 84) / 22, 0, 1);
    const sk = SKY.sky(LAT, S.month, S.hour + (isDST(S.month) ? -1 : 0), heat);
    const g = SKY.gradient(sk);
    $('#sky').style.background = g;
    $('#sheet').style.setProperty('--skybg', SKY.css(sk.mid));
    $('meta[name=theme-color]').content = SKY.css(sk.top);
  }
  function buildDial() {
    const svg = d3.select('#dial'); svg.selectAll('*').remove();
    const c = 110, r = 92, ang = (h) => (h / 24) * 2 * Math.PI - Math.PI; // midnight at bottom
    const pt = (h, rr) => [c + rr * Math.sin(ang(h) + Math.PI), c - rr * Math.cos(ang(h) + Math.PI)];
    svg.append('circle').attr('class', 'ring').attr('cx', c).attr('cy', c).attr('r', r);
    const st = sunTimes(S.month);
    const arc = (a, b, cls) => { if (a == null || b == null) return; const p = pt(a, r), q = pt(b, r); svg.append('path').attr('class', cls).attr('d', `M${c},${c}L${p[0]},${p[1]}A${r},${r} 0 ${b - a > 12 ? 1 : 0} 1 ${q[0]},${q[1]}Z`); };
    arc(0, 24, 'night'); arc(st.rise, st.set, 'day');
    for (let h = 0; h < 24; h += 3) { const a = pt(h, r - 8), b = pt(h, r); svg.append('line').attr('class', 'tk').attr('x1', a[0]).attr('y1', a[1]).attr('x2', b[0]).attr('y2', b[1]); }
    [[0, '12 AM'], [6, '6 AM'], [12, 'Noon'], [18, '6 PM']].forEach(([h, t]) => { const p = pt(h, r - 20); svg.append('text').attr('x', p[0]).attr('y', p[1] + 4).text(t); });
    svg.append('line').attr('class', 'gn').attr('id', 'gnomon').attr('x1', c).attr('y1', c);
    svg.append('circle').attr('cx', c).attr('cy', c).attr('r', 6).attr('fill', '#f3ead9');
    svg.node().__pt = pt; moveGnomon();
  }
  function moveGnomon() { const p = $('#dial').__pt(S.hour, 84); $('#gnomon').setAttribute('x2', p[0]); $('#gnomon').setAttribute('y2', p[1]); }
  function buildCurve() {
    const W = 640, H = 200, m = { l: 36, r: 10, t: 12, b: 28 }, el = $('#curve'); el.innerHTML = '';
    const fs = S.climate.feels[S.month - 1], lo = Math.min(30, Math.min(...fs) - 3), hi = Math.max(100, Math.max(...fs) + 3);
    const x = d3.scaleLinear([0, 24], [m.l, W - m.r]), y = d3.scaleLinear([lo, hi], [H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`);
    const st = sunTimes(S.month), off = isDST(S.month) ? 1 : 0;
    const band = (a, b, cls) => svg.append('rect').attr('class', cls).attr('x', x(a)).attr('width', x(b) - x(a)).attr('y', m.t).attr('height', H - m.b - m.t);
    if (st.rise != null) { band(0, st.rise, 'nightband'); band(st.set, 24, 'nightband'); }
    svg.append('rect').attr('class', 'hotband').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', y(Math.min(hi, 120))).attr('height', Math.max(0, y(90) - y(Math.min(hi, 120))));
    svg.append('text').attr('class', 'tx').attr('x', W - m.r - 4).attr('y', y(90) - 5).attr('text-anchor', 'end').text('feels 90°F or more');
    svg.append('line').attr('class', 'ax').attr('x1', m.l).attr('x2', W - m.r).attr('y1', H - m.b).attr('y2', H - m.b);
    [0, 6, 12, 18, 24].forEach((h) => svg.append('text').attr('class', 'tx').attr('x', x(h)).attr('y', H - 8).attr('text-anchor', h === 0 ? 'start' : h === 24 ? 'end' : 'middle').text(['12 AM', '6 AM', 'Noon', '6 PM', '12 AM'][h / 6]));
    [40, 60, 80, 100].filter((v) => v > lo && v < hi).forEach((v) => svg.append('text').attr('class', 'tx').attr('x', 2).attr('y', y(v) + 4).text(v + '°'));
    svg.append('path').attr('class', 'ln').attr('d', d3.line().curve(d3.curveCatmullRom)(fs.concat(fs[0]).map((v, i) => [x(i), y(v)])));
    svg.append('line').attr('class', 'mk').attr('id', 'cmk').attr('y1', m.t).attr('y2', H - m.b);
    el.__x = x; moveCurve();
  }
  function moveCurve() { const x = $('#curve').__x; if (!x) return; const v = x(S.hour); const l = $('#cmk'); l.setAttribute('x1', v); l.setAttribute('x2', v); }
  function paintTime() {
    const f = Math.round(feels()), a = weatherAdvice();
    $('#bigtime').textContent = hmm(S.hour);
    $('#feels').textContent = `Feels like ${f}°F · ${isDay(S.hour, S.month) ? 'daylight' : 'dark'}`;
    const adv = $('#advice'); adv.textContent = a.text; adv.className = 'advice ' + a.cls;
    const b = bestHours();
    $('#bestline').textContent = `Easiest time to be outside in ${MON[S.month - 1]}: around ${hmm(b)}.`;
    $('#hour').setAttribute('aria-valuetext', hmm(S.hour));
    paintSky(); moveGnomon(); moveCurve();
  }

  /* ---------- accessibility tiers (SUNDIAL's measured / blended / borrowed idea) ---------- */
  const TIER = {
    1: ['t1', 'Step-free access reported'], 2: ['t2', 'Partly accessible'], '-1': ['t3', 'Access not reported: call first'], 0: ['t0', 'Reported not accessible']
  };
  const tierOf = (p) => TIER[p.wc];

  /* ---------- opening hours (small parser for the common OSM patterns) ---------- */
  function openNow(oh, h) {
    if (!oh) return null;
    if (/^24\/7$/.test(oh.trim())) return true;
    const D = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let state = null;
    for (const part of oh.split(';')) {
      const m = part.trim().match(/^([A-Za-z,\- ]*?)\s*((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:,\s*)?)+|off|closed)$/i);
      if (!m) return null;
      let days = new Set();
      const spec = m[1].trim();
      if (!spec) D.forEach((_, i) => days.add(i));
      else for (const seg of spec.split(',')) { const r = seg.trim().split('-'); const a = D.indexOf(r[0]), b = r[1] ? D.indexOf(r[1]) : a; if (a < 0 || b < 0) return null; for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; } }
      if (!days.has(dow)) continue;
      if (/off|closed/i.test(m[2])) { state = false; continue; }
      state = false;
      for (const t of m[2].split(',')) { const q = t.trim().match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/); if (!q) continue; const s = +q[1] + q[2] / 60, e = +q[3] + q[4] / 60; if (e > s ? h >= s && h < e : h >= s || h < e) state = true; }
    }
    return state;
  }

  /* ---------- finding things ---------- */
  function nearestStop(la, lo) {
    const wantWC = S.needs.has('wheel') || S.needs.has('walk') || true;
    let rail = null, bus = null;
    for (const s of S.marta.stations) { if (!s.rail || s.wc !== 1) continue; const d = mi(km(la, lo, s.lat, s.lon)); if (!rail || d < rail.d) rail = { d, name: s.name, lines: s.lines }; }
    for (const b of S.marta.bus) { if (b[2] !== 1) continue; const d = mi(km(la, lo, b[0], b[1])); if (!bus || d < bus.d) bus = { d }; }
    return { rail, bus };
  }
  function score(p) {
    let s = mi(km(S.origin.lat, S.origin.lon, p.la, p.lo));
    const strict = S.needs.has('wheel');
    if (p.wc === 1) s -= 1.5; else if (p.wc === 2) s += strict ? 3 : 0.3; else if (p.wc === 0) s += strict ? 100 : 4; else s += strict ? 1.2 : 0;
    if (S.needs.has('hear') && p.hl) s -= 0.8;
    if (S.needs.has('sight') && p.tp) s -= 0.5;
    const o = openNow(p.h, S.hour); if (o === false) s += 3;
    return s;
  }
  function compute() {
    if (!S.origin) return;
    S.results = S.places.filter((p) => p.k === S.kind).map((p) => ({ p, d: mi(km(S.origin.lat, S.origin.lon, p.la, p.lo)), s: score(p) })).sort((a, b) => a.s - b.s).slice(0, easy() ? 5 : 10);
    renderBoard(); drawMap();
  }
  function renderBoard() {
    const kn = KNAME[S.kind];
    $('#res-title').textContent = `${easy() ? 'Nearby' : 'Best'} ${kn}s`;
    const need = [...S.needs].map((n) => NEEDS.find((x) => x[0] === n)[1].toLowerCase());
    $('#res-sub').textContent = `Starting from ${S.origin.label}, going at ${hmm(S.hour)}${need.length ? ', ranked for: ' + need.join(', ') : ''}.`;
    const ol = $('#board'); ol.innerHTML = '';
    if (!S.results.length) { ol.innerHTML = '<li class="hint">No places of this type were found in our data.</li>'; return; }
    S.results.forEach((r, i) => {
      const t = tierOf(r.p), o = openNow(r.p.h, S.hour), li = document.createElement('li');
      li.innerHTML = `<button type="button" data-i="${i}"><span class="nm">${esc(r.p.n)}</span><span class="dist">${miText(r.d)}</span>
        <span class="meta"><span class="tag ${t[0]}">${t[1]}</span>${o === true ? '<span class="tag open">Open at this time</span>' : o === false ? '<span class="tag shut">Closed at this time</span>' : ''}${r.p.a ? esc(r.p.a) : ''}</span></button>`;
      ol.appendChild(li);
    });
    $('#res-note').textContent = 'Access labels come from OpenStreetMap volunteers. "Not reported" means nobody has recorded it. Always call ahead.';
  }

  /* ---------- the place sheet ---------- */
  function openPlace(r) {
    S.selected = r; const p = r.p, t = tierOf(p), ns = nearestStop(p.la, p.lo), o = openNow(p.h, S.hour), f = Math.round(feels()), a = weatherAdvice();
    const tier = $('#s-tier'); tier.textContent = t[1]; tier.className = 'tier ' + t[0];
    $('#sheet-name').textContent = p.n;
    $('#s-sub').textContent = `${miText(r.d)} from ${S.origin.label}${p.a ? ' · ' + p.a : ''}`;
    $('#s-dir').href = `https://www.google.com/maps/dir/?api=1&destination=${p.la},${p.lo}&travelmode=transit`;
    const card = (h, body) => `<section class="gcard"><h3 class="gh">${h}</h3>${body}</section>`;
    const E = easy(), tips = [];
    if (S.needs.has('wheel')) tips.push(p.wc === 1 ? 'Reported step-free. Still ask about the entrance door and an accessible restroom.' : 'Ask if there is a ramp, a step-free door and an elevator before you go.');
    if (S.needs.has('sight')) tips.push(p.tp ? 'Tactile paving is reported nearby.' : 'No tactile paving is recorded. Ask a staff member to meet you at the door.');
    if (S.needs.has('hear')) tips.push(p.hl ? 'A hearing loop is reported.' : 'No hearing loop is recorded. Ask for written communication or bring a note.');
    if (S.needs.has('walk')) tips.push('Plan rests. Benches and a seat inside are worth asking about.');
    const getting = [];
    if (ns.rail) getting.push(`<li><b>${esc(ns.rail.name)}</b> MARTA rail station (${esc(ns.rail.lines.join(', ') || 'rail')}) is ${miText(ns.rail.d)} away, about ${walkMin(ns.rail.d)} min${ns.rail.d > 0.5 && (S.needs.has('walk') || S.needs.has('wheel')) ? '. <b>That is a long walk for you: consider a bus or MARTA Mobility.</b>' : '.'} MARTA lists it as accessible.</li>`);
    if (ns.bus) getting.push(`<li>The nearest bus stop MARTA lists as wheelchair accessible is ${miText(ns.bus.d)} away, about ${walkMin(ns.bus.d)} min.</li>`);
    getting.push('<li>Cannot use buses or trains? <a href="https://itsmarta.com/marta-mobility.aspx" rel="noopener">MARTA Mobility</a> gives door-to-door rides after you apply.</li>');
    getting.push('<li>Check that the station elevator is working before you leave.</li>');
    const best = bestHours();
    $('#cards').innerHTML =
      card('Is it open?', `<p><b>${o === true ? 'Open at ' + hmm(S.hour) + ' today.' : o === false ? 'Closed at ' + hmm(S.hour) + '.' : 'Hours not listed in our data.'}</b></p>${p.h ? `<p>Listed hours: ${esc(p.h)}</p>` : ''}${p.p ? `<p>Phone: <a href="tel:${esc(p.p.replace(/[^+\d]/g, ''))}">${esc(p.p)}</a></p>` : '<p>No phone number listed. Search the name and call to confirm.</p>'}`) +
      card('At ' + hmm(S.hour), `<p><b>Feels like ${f}°F, ${isDay(S.hour, S.month) ? 'daylight' : 'dark'}.</b></p><p>${esc(a.text)}</p><p>${E ? 'Easiest time' : 'Easiest time in ' + MON[S.month - 1]}: around ${hmm(best)}.</p>`) +
      card('Getting there', `<ul>${getting.join('')}</ul>`) +
      card('Access for you', `<p><b>${t[1]}.</b></p>${tips.length ? '<ul>' + tips.map((x) => `<li>${x}</li>`).join('') + '</ul>' : ''}<p class="note">From OpenStreetMap volunteers. Call to confirm: access changes and elevators break.</p>`);
    const sh = $('#sheet'); sh.classList.add('open'); sh.setAttribute('aria-hidden', 'false'); document.body.classList.add('sheet-open');
    $('#sheet-scroll').scrollTop = 0; $('#sheet-back').focus();
    S.lastFocus = document.activeElement;
  }
  function closePlace() { const sh = $('#sheet'); sh.classList.remove('open'); sh.setAttribute('aria-hidden', 'true'); document.body.classList.remove('sheet-open'); if (S.btn) S.btn.focus(); window.speechSynthesis && speechSynthesis.cancel(); }
  function readAloud() {
    if (!window.speechSynthesis) return;
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const txt = [$('#sheet-name').textContent, $('#s-tier').textContent, $('#s-sub').textContent, ...[...document.querySelectorAll('#cards .gcard')].map((c) => c.innerText)].join('. ');
    const u = new SpeechSynthesisUtterance(txt); u.rate = 0.9; speechSynthesis.speak(u);
  }

  /* ---------- map (canvas, pan + zoom) ---------- */
  const mp = { t: d3.zoomIdentity, proj: null, w: 0, h: 0 };
  function mapSetup() {
    const c = $('#map'), dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr; mp.w = r.width; mp.h = r.height; mp.dpr = dpr;
    mp.proj = d3.geoMercator().fitExtent([[12, 12], [mp.w - 12, mp.h - 12]], { type: 'FeatureCollection', features: S.counties.features });
  }
  const COL = { 1: '#3ecb6a', 2: '#ffc65a', '-1': '#b8afa0', 0: '#ff6b5e' };
  function drawMap() {
    if (!S.counties) return; const c = $('#map'), g = c.getContext('2d'), k = mp.t.k; if (!mp.proj) mapSetup();
    g.setTransform(mp.dpr, 0, 0, mp.dpr, 0, 0); g.clearRect(0, 0, mp.w, mp.h);
    g.fillStyle = '#1a1511'; g.fillRect(0, 0, mp.w, mp.h);
    g.save(); g.translate(mp.t.x, mp.t.y); g.scale(k, k);
    const path = d3.geoPath(mp.proj, g); g.lineWidth = 1 / k;
    S.counties.features.forEach((f) => { g.beginPath(); path(f); g.fillStyle = '#2a2119'; g.fill(); g.strokeStyle = 'rgba(243,234,217,0.35)'; g.stroke(); });
    g.restore();
    const P = (la, lo) => { const q = mp.proj([lo, la]); return [q[0] * k + mp.t.x, q[1] * k + mp.t.y]; };
    g.fillStyle = 'rgba(243,234,217,0.7)'; g.font = '600 11px Hanken Grotesk, sans-serif'; g.textAlign = 'center';
    S.counties.features.forEach((f) => { const q = d3.geoPath(mp.proj).centroid(f); g.fillText(f.properties.name, q[0] * k + mp.t.x, q[1] * k + mp.t.y); });
    S.marta.stations.filter((s) => s.rail).forEach((s) => { const [x, y] = P(s.lat, s.lon); g.fillStyle = '#7db2ff'; g.fillRect(x - 3.5, y - 3.5, 7, 7); if (k > 3) { g.fillStyle = '#cfe2ff'; g.fillText(s.name.replace(' Station', ''), x, y - 7); } });
    S.results.forEach((r, i) => { const [x, y] = P(r.p.la, r.p.lo); r.sx = x; r.sy = y; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fillStyle = COL[r.p.wc]; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.fillStyle = '#000'; g.font = '800 10px sans-serif'; g.fillText(i + 1, x, y + 3.5); });
    if (S.origin) { const [x, y] = P(S.origin.lat, S.origin.lon); g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = '#ff6a1a'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); }
  }
  function mapInit() {
    mapSetup();
    const sel = d3.select('#map');
    sel.call(d3.zoom().scaleExtent([1, 14]).on('zoom', (e) => { mp.t = e.transform; drawMap(); }));
    sel.on('click', (e) => { const [x, y] = d3.pointer(e); let b = null; S.results.forEach((r, i) => { const d = Math.hypot(r.sx - x, r.sy - y); if (d < 20 && (!b || d < b.d)) b = { d, i }; }); if (b) { S.btn = document.querySelector(`#board button[data-i="${b.i}"]`); openPlace(S.results[b.i]); } });
    window.addEventListener('resize', () => { mp.proj = null; drawMap(); });
  }

  /* ---------- UI wiring ---------- */
  function chips(el, list, pressed, on) {
    el.innerHTML = '';
    list.forEach(([id, label]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = label; b.setAttribute('aria-pressed', pressed(id)); b.onclick = () => { on(id); chips(el, list, pressed, on); }; el.appendChild(b); });
  }
  function init() {
    const mo = $('#month'); MON.forEach((m, i) => mo.add(new Option(m, i + 1))); mo.value = S.month;
    mo.onchange = () => { S.month = +mo.value; buildDial(); buildCurve(); paintTime(); compute(); };
    const hr = $('#hour'); hr.value = S.hour;
    hr.oninput = () => { S.hour = +hr.value; store.set('hour', S.hour); paintTime(); };
    hr.onchange = () => compute();
    const needChips = () => chips($('#needs'), NEEDS, (id) => S.needs.has(id), (id) => { S.needs.has(id) ? S.needs.delete(id) : S.needs.add(id); store.set('needs', [...S.needs]); paintTime(); compute(); window.dispatchEvent(new CustomEvent('needs-changed')); });
    needChips();
    window.addEventListener('needs-changed', () => { S.needs = new Set(store.get('needs', [])); needChips(); paintTime(); compute(); });   // the trip planner shares these choices
    chips($('#kinds'), KINDS, (id) => S.kind === id, (id) => { S.kind = id; store.set('kind', id); compute(); });
    const og = $('#origin');
    const st = S.marta.stations.filter((s) => s.rail).sort((a, b) => a.name.localeCompare(b.name));
    st.forEach((s) => og.add(new Option(s.name, s.id)));
    const setO = (id) => { const s = st.find((x) => x.id === id); S.origin = { lat: s.lat, lon: s.lon, label: s.name }; };
    og.value = (st.find((s) => /five points/i.test(s.name)) || st[0]).id; setO(og.value);
    og.onchange = () => { setO(og.value); compute(); };
    $('#locate').onclick = () => {
      const n = $('#origin-note');
      if (!navigator.geolocation) { n.textContent = 'Your browser cannot share location. Pick a station instead.'; return; }
      n.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition((p) => { S.origin = { lat: p.coords.latitude, lon: p.coords.longitude, label: 'your location' }; n.textContent = 'Using your location. It stays in your browser.'; compute(); }, () => { n.textContent = 'Could not get your location. Pick a station instead.'; }, { timeout: 10000 });
    };
    $('#board').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { S.btn = b; openPlace(S.results[+b.dataset.i]); } });
    $('#sheet-back').onclick = closePlace; $('#s-read').onclick = readAloud; $('#s-print').onclick = () => window.print();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sheet').classList.contains('open')) closePlace(); });
    // display options
    let ts = store.get('ts', 0); const ap = () => { document.body.classList.remove('tm1', 't1', 't2'); if (ts) document.body.classList.add(ts < 0 ? 'tm1' : 't' + ts); store.set('ts', ts); };
    $('#t-plus').onclick = () => { ts = Math.min(2, ts + 1); ap(); }; $('#t-minus').onclick = () => { ts = Math.max(-1, ts - 1); ap(); }; ap();
    const hc = $('#t-contrast'); const sh = (v) => { document.body.classList.toggle('hc', v); hc.setAttribute('aria-pressed', v); store.set('hc', v); };
    hc.onclick = () => sh(!document.body.classList.contains('hc')); sh(store.get('hc', matchMedia('(prefers-contrast: more)').matches));
    // dock highlight
    const links = [...document.querySelectorAll('#dock a')], secs = links.map((a) => document.querySelector(a.getAttribute('href')));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a, i) => a.classList.toggle('on', secs[i] === e.target)); }), { rootMargin: '-40% 0px -50% 0px' });
    secs.forEach((s) => io.observe(s));
    buildDial(); buildCurve(); paintTime(); mapInit(); compute();
  }

  const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
  Promise.all([get('data/marta.json'), get('data/climate.json'), get('data/counties.geojson'), get('data/places.json').catch(() => ({ places: [] }))]).then(([m, c, g, p]) => {
    S.marta = m; S.climate = c; S.counties = g; S.places = p.places.map((x) => x); init();
    if (!S.places.length) $('#res-sub').textContent = 'Place data did not load. Please refresh.';
    document.body.classList.remove('loading');
  }).catch((e) => { console.error(e); document.body.classList.remove('loading'); document.querySelector('#plan').insertAdjacentHTML('afterbegin', '<p class="wrap"><b>Could not load data. Please refresh.</b></p>'); });
})();
