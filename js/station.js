/* SUNDIAL ATL hero: an empty metro platform. Scroll and a train rushes past; the camera chases it down the platform,
   it stops, people board, then it pulls into the tunnel. Drawn procedurally on one canvas, driven only by scroll.
   The title is SUNDIAL's: huge and centred, then it shrinks and docks top left as you scroll. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cv = $('#station'); if (!cv) return;
  const g = cv.getContext('2d');
  const hero = $('#hero'), title = $('#title'), heroLine = $('#heroline'), cue = hero.querySelector('.scroll-cue'), chin = hero.querySelector('.chin');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fract = (x) => x - Math.floor(x);
  const rnd = (i) => fract(Math.sin(i * 127.1 + 311.7) * 43758.5453);
  const mod = (a, n) => ((a % n) + n) % n;

  /* ---------- smooth monotone curves through keyframes (no stutter between segments) ---------- */
  function curve(keys) {
    const n = keys.length, x = keys.map((k) => k[0]), y = keys.map((k) => k[1]), d = [], m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (p) => {
      p = clamp(p, x[0], x[n - 1]); let i = 0; while (i < n - 2 && p > x[i + 1]) i++;
      const h = x[i + 1] - x[i], t = (p - x[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  // world units are "u" (about one screen height). Train front, camera left edge, door opening.
  const XF = curve([[0, -0.45], [0.07, -0.45], [0.22, 3.4], [0.36, 11], [0.58, 16], [0.8, 16], [1, 31]]);
  const CAM = curve([[0, 0], [0.07, 0.12], [0.36, 1.5], [0.66, 11.5], [0.8, 12.1], [1, 17.7]]);
  const DOOR = curve([[0, 0], [0.62, 0], [0.68, 1], [0.8, 1], [0.85, 0], [1, 0]]);
  const BOARD = curve([[0, 0], [0.66, 0], [0.8, 1], [1, 1]]);   // how far along the walk to the door the passengers are
  const LC = 1.5, GAP = 0.05, CARS = 4, TRAIN = CARS * LC + (CARS - 1) * GAP, XP = 18.6; // car length, gap, cars, tunnel mouth

  const COL = { ink: '#0a0908', bone: '#f3ead9', ember: '#ff6a1a', sun: '#ffc65a' };
  const COATS = ['#2c3a3f', '#4b2a1d', '#5d4a22', '#33313a', '#40281f', '#2a3b2c', '#58332c', '#3a3a3a'];
  const SKINS = ['#7b5a45', '#a07456', '#5b3f31', '#c09a7a', '#6c4a39'];
  const LINES = [['#CE242B', 'RED'], ['#D4A723', 'GOLD'], ['#0075B2', 'BLUE'], ['#009D4B', 'GREEN']];

  let W = 0, H = 0, dpr = 1, u = 1, trackY = 0, floorFar = 0, nearFloor = 0, ceilY = 0;
  let C = 0, X = 0, pS = 0, pRaw = 0, now = 0, speed = 0, rel = 0, lastX = 0, lastC = 0, vig = null;
  const dust = Array.from({ length: 70 }, (_, i) => ({ x: rnd(i) * 40, y: rnd(i + 99), f: 0.25 + rnd(i + 7) * 1.1, s: 0.6 + rnd(i + 3) * 1.6 }));
  let sparks = [];

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    u = Math.min(H, W * 0.9); trackY = H * 0.8; floorFar = trackY - 0.068 * u; nearFloor = trackY + 0.075 * u;
    ceilY = Math.max(H * 0.05, trackY - 0.8 * u);
    vig = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    layoutTitle();
  }
  const sx = (wx, f) => (wx - C * f) * u;           // world x to screen x for a layer that moves at fraction f of the camera
  const range = (f, S, pad) => { const a = C * f, b = a + W / u; return [Math.floor(a / S) - (pad || 1), Math.ceil(b / S) + (pad || 1)]; };
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const lg = (x0, y0, x1, y1, stops) => { const q = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => q.addColorStop(o, c)); return q; };

  /* ---------- back wall, ceiling lights, signs, pillars ---------- */
  function backWall() {
    g.fillStyle = lg(0, 0, 0, floorFar, [[0, '#0a0807'], [0.5, '#17100c'], [1, '#2a1e16']]); g.fillRect(0, 0, W, floorFar + 2);
    // tile joints
    g.strokeStyle = 'rgba(243,234,217,0.045)'; g.lineWidth = 1;
    const S = 0.13, [a, b] = range(0.5, S);
    g.beginPath(); for (let k = a; k <= b; k++) { const x = Math.round(sx(k * S, 0.5)) + 0.5; g.moveTo(x, ceilY); g.lineTo(x, floorFar); } g.stroke();
    for (let y = floorFar; y > ceilY; y -= 0.075 * u) { g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke(); }
    // trim band with the ember line
    const ty = floorFar - 0.2 * u;
    g.fillStyle = 'rgba(255,106,26,0.16)'; g.fillRect(0, ty, W, 0.022 * u);
    g.fillStyle = 'rgba(255,198,90,0.55)'; g.fillRect(0, ty + 0.009 * u, W, 2);
    // lit alcoves with a line-colour bar and big station name
    const AS = 5.2, [a2, b2] = range(0.55, AS, 1);
    for (let k = a2; k <= b2; k++) {
      const x = sx(k * AS + 1.2, 0.55), w = 2.1 * u, y0 = floorFar - 0.64 * u, h = 0.4 * u, ln = LINES[mod(k, 4)];
      const bg = g.createRadialGradient(x + w / 2, y0 + h / 2, 0, x + w / 2, y0 + h / 2, w * 0.7);
      bg.addColorStop(0, 'rgba(255,190,110,0.20)'); bg.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = bg; g.fillRect(x - w * 0.2, y0 - h * 0.3, w * 1.4, h * 1.6);
      rr(x, y0, w, h, 0.02 * u); g.fillStyle = 'rgba(8,6,5,0.78)'; g.fill(); g.strokeStyle = 'rgba(255,198,90,0.28)'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = ln[0]; g.fillRect(x + 0.05 * u, y0 + 0.05 * u, 0.03 * u, h - 0.1 * u);
      g.fillStyle = COL.bone; g.textBaseline = 'alphabetic';
      g.font = `800 ${0.07 * u}px "Hanken Grotesk", system-ui, sans-serif`; g.fillText(['FIVE POINTS', 'PEACHTREE CENTER', 'NORTH AVE', 'GEORGIA STATE'][mod(k, 4)], x + 0.13 * u, y0 + 0.16 * u);
      g.fillStyle = 'rgba(243,234,217,0.7)'; g.font = `600 ${0.042 * u}px "Hanken Grotesk", system-ui, sans-serif`;
      g.fillText(['Elevator to the street →', 'Step-free to the platform', 'Exit and elevator ←', 'Next train in 4 min'][mod(k, 4)], x + 0.13 * u, y0 + 0.26 * u);
      // accessibility symbol tile
      g.fillStyle = '#1d5fa8'; rr(x + w - 0.16 * u, y0 + 0.07 * u, 0.1 * u, 0.1 * u, 0.012 * u); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 0.008 * u; g.lineCap = 'round'; const cx = x + w - 0.11 * u, cy = y0 + 0.13 * u;
      g.beginPath(); g.arc(cx - 0.004 * u, cy + 0.008 * u, 0.02 * u, 0.4, 5.4); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(cx - 0.004 * u, cy - 0.035 * u, 0.006 * u, 0, 7); g.fill();
    }
  }
  function ceiling() {
    g.fillStyle = lg(0, 0, 0, ceilY + 0.12 * u, [[0, '#050404'], [1, 'rgba(5,4,4,0)']]); g.fillRect(0, 0, W, ceilY + 0.12 * u);
    const S = 2.3, [a, b] = range(0.42, S, 1);
    for (let k = a; k <= b; k++) {
      const x = sx(k * S, 0.42), w = 1.2 * u, y = ceilY + 0.02 * u, flick = reduce ? 1 : (rnd(k * 3) > 0.93 ? 0.55 + 0.45 * Math.sin(now / 90 + k) ** 2 : 1);
      const beam = lg(0, y, 0, y + 0.8 * u, [[0, `rgba(255,214,150,${0.1 * flick})`], [1, 'rgba(255,214,150,0)']]);
      g.fillStyle = beam; g.beginPath(); g.moveTo(x + 0.05 * u, y); g.lineTo(x + w - 0.05 * u, y); g.lineTo(x + w + 0.45 * u, y + 0.8 * u); g.lineTo(x - 0.4 * u, y + 0.8 * u); g.closePath(); g.fill();
      rr(x, y, w, 0.018 * u, 0.009 * u); g.fillStyle = `rgba(255,236,200,${0.95 * flick})`; g.fill();
    }
  }
  function pillars() {
    const S = 3.4, [a, b] = range(0.8, S, 1);
    for (let k = a; k <= b; k++) {
      const x = sx(k * S, 0.8), w = 0.085 * u;
      g.fillStyle = lg(x, 0, x + w, 0, [[0, '#120c09'], [0.35, '#3a2b20'], [0.55, '#2b1f17'], [1, '#0f0a07']]); g.fillRect(x, 0, w, floorFar + 2);
      g.fillStyle = 'rgba(255,190,110,0.22)'; g.fillRect(x + w * 0.34, 0, 2, floorFar);
    }
  }

  /* ---------- people ---------- */
  function person(x, fy, h, o) {
    const sway = reduce ? 0 : Math.sin(now / 760 + o.seed * 9) * h * 0.006, dir = o.dir || 1, st = o.style || 'stand';
    g.save(); g.translate(x + sway, fy); g.globalAlpha = o.a == null ? 1 : o.a;
    const coat = o.coat, skin = o.skin, pants = o.pants || '#14100d', rim = 'rgba(255,176,96,0.42)';
    if (st === 'wheel') {
      const r = h * 0.2;
      g.strokeStyle = '#0b0807'; g.lineWidth = h * 0.025; g.beginPath(); g.arc(0, -r, r, 0, 7); g.stroke();
      g.strokeStyle = rim; g.lineWidth = h * 0.008; g.beginPath(); g.arc(0, -r, r, -2.4, -0.7); g.stroke();
      g.fillStyle = '#0b0807'; g.beginPath(); g.arc(dir * h * 0.3, -h * 0.045, h * 0.045, 0, 7); g.fill();
      g.fillRect(-h * 0.11, -h * 0.34, h * 0.26 * dir, h * 0.03);
      g.fillStyle = pants; g.fillRect(dir > 0 ? h * 0.06 : -h * 0.3, -h * 0.34, h * 0.24, h * 0.07);
      g.fillRect(dir > 0 ? h * 0.24 : -h * 0.3, -h * 0.34, h * 0.06, h * 0.26);
      rr(-h * 0.13, -h * 0.74, h * 0.26, h * 0.42, h * 0.07); g.fillStyle = coat; g.fill(); g.strokeStyle = rim; g.lineWidth = h * 0.01; g.stroke();
      g.fillStyle = skin; g.beginPath(); g.arc(0, -h * 0.82, h * 0.075, 0, 7); g.fill();
      g.strokeStyle = '#0b0807'; g.lineWidth = h * 0.02; g.beginPath(); g.moveTo(-dir * h * 0.12, -h * 0.55); g.lineTo(-dir * h * 0.2, -h * 0.72); g.stroke();
      g.restore(); return;
    }
    if (st === 'cane' || st === 'walker') g.rotate(0.07 * dir);
    // legs
    g.fillStyle = pants; rr(-h * 0.1, -h * 0.5, h * 0.085, h * 0.5, h * 0.03); g.fill(); rr(h * 0.015, -h * 0.5, h * 0.085, h * 0.5, h * 0.03); g.fill();
    // bag behind
    if (st === 'bag') { rr(-dir * h * 0.2, -h * 0.8, h * 0.13, h * 0.3, h * 0.04); g.fillStyle = '#17110d'; g.fill(); }
    // torso
    rr(-h * 0.16, -h * 0.86, h * 0.32, h * 0.42, h * 0.08); g.fillStyle = coat; g.fill(); g.strokeStyle = rim; g.lineWidth = h * 0.01; g.beginPath(); g.moveTo(dir * h * 0.16, -h * 0.78); g.lineTo(dir * h * 0.16, -h * 0.5); g.stroke();
    // head + hair
    g.fillStyle = skin; g.beginPath(); g.arc(0, -h * 0.945, h * 0.075, 0, 7); g.fill();
    g.fillStyle = o.hair || '#17110d'; g.beginPath(); g.arc(-dir * h * 0.01, -h * 0.965, h * 0.077, Math.PI * 1.02, Math.PI * 2.05); g.fill();
    g.strokeStyle = '#0b0807'; g.lineWidth = h * 0.022; g.lineCap = 'round';
    if (st === 'cane') { g.beginPath(); g.moveTo(dir * h * 0.14, -h * 0.74); g.lineTo(dir * h * 0.24, -h * 0.5); g.lineTo(dir * h * 0.25, 0); g.stroke(); g.beginPath(); g.arc(dir * h * 0.275, -h * 0.5, h * 0.03, Math.PI, Math.PI * 2); g.stroke(); }
    if (st === 'walker') {
      g.lineWidth = h * 0.016; g.beginPath(); g.moveTo(dir * h * 0.32, -h * 0.56); g.lineTo(dir * h * 0.52, -h * 0.56); g.moveTo(dir * h * 0.32, -h * 0.56); g.lineTo(dir * h * 0.32, 0); g.moveTo(dir * h * 0.52, -h * 0.56); g.lineTo(dir * h * 0.52, 0); g.stroke();
      g.lineWidth = h * 0.02; g.beginPath(); g.moveTo(dir * h * 0.13, -h * 0.74); g.lineTo(dir * h * 0.34, -h * 0.57); g.stroke();
    }
    if (st === 'phone') { g.beginPath(); g.moveTo(dir * h * 0.13, -h * 0.74); g.lineTo(dir * h * 0.1, -h * 0.9); g.stroke(); }
    g.restore();
  }
  const mk = (i, style, scale) => ({ seed: i, style, coat: COATS[Math.floor(rnd(i * 5) * COATS.length)], skin: SKINS[Math.floor(rnd(i * 11) * SKINS.length)], dir: rnd(i * 13) > 0.5 ? 1 : -1, hair: rnd(i * 17) > 0.55 ? '#cfc8bd' : '#17110d', scale: scale || 1 });
  // far platform crowd (behind the train)
  const FAR = []; for (let i = 0; i < 30; i++) { const s = rnd(i * 3) > 0.9 ? 'cane' : rnd(i * 3) > 0.8 ? 'wheel' : rnd(i * 3) > 0.62 ? 'bag' : rnd(i * 3) > 0.5 ? 'phone' : 'stand'; FAR.push(Object.assign(mk(i + 40, s, 0.9 + rnd(i) * 0.2), { x: 0.4 + i * 0.6 + rnd(i * 7) * 0.4 })); }
  // near platform: waiting people, and the passengers who board
  const NEAR = [
    Object.assign(mk(3, 'cane', 1.12), { x: 1.1 }), Object.assign(mk(8, 'bag', 1.08), { x: 2.6 }), Object.assign(mk(21, 'stand', 1.1), { x: 4.1 }), Object.assign(mk(25, 'phone', 1.1), { x: 6.3 }),
    Object.assign(mk(61, 'wheel', 1.1), { x: 12.05, door: 12.15 }), Object.assign(mk(64, 'cane', 1.14), { x: 12.55, door: 12.7 }),
    Object.assign(mk(67, 'walker', 1.12), { x: 13.0, door: 13.16 }), Object.assign(mk(70, 'bag', 1.1), { x: 13.55, door: 13.7 }),
    Object.assign(mk(73, 'stand', 1.1), { x: 15.3 }), Object.assign(mk(76, 'phone', 1.1), { x: 17.1 })
  ];
  function farPlatform() {
    // platform face + tactile edge
    g.fillStyle = lg(0, floorFar, 0, trackY, [[0, '#2a2018'], [1, '#0d0907']]); g.fillRect(0, floorFar, W, trackY - floorFar + 1);
    g.fillStyle = '#c99a2e'; g.fillRect(0, floorFar, W, Math.max(3, 0.01 * u));
    g.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = -(C * 0.8 * u) % 7; x < W; x += 7) g.fillRect(x, floorFar, 2, Math.max(3, 0.01 * u));
    // benches
    const BS = 4.1, [a, b] = range(0.8, BS, 1);
    for (let k = a; k <= b; k++) { const x = sx(k * BS + 1.7, 0.8); g.fillStyle = '#17110d'; g.fillRect(x, floorFar - 0.05 * u, 0.3 * u, 0.012 * u); g.fillRect(x + 0.02 * u, floorFar - 0.04 * u, 0.012 * u, 0.04 * u); g.fillRect(x + 0.27 * u, floorFar - 0.04 * u, 0.012 * u, 0.04 * u); }
    for (const p of FAR) { const x = sx(p.x, 0.8); if (x < -80 || x > W + 80) continue; person(x, floorFar + 0.004 * u, 0.116 * u * p.scale, p); }
  }
  function trackBed() {
    g.fillStyle = lg(0, trackY - 0.002 * u, 0, nearFloor, [[0, '#120d0a'], [1, '#070504']]); g.fillRect(0, trackY - 1, W, nearFloor - trackY + 2);
    g.fillStyle = 'rgba(200,190,175,0.55)'; g.fillRect(0, trackY, W, 2);                 // rail head catching the light
    g.fillStyle = 'rgba(255,170,80,0.12)'; g.fillRect(0, trackY + 3, W, 0.012 * u);
  }

  /* ---------- the train ---------- */
  function car(x0, k, open, blur) {
    const L = LC * u, top = trackY - 0.275 * u, bot = trackY - 0.032 * u, h = bot - top;
    // body
    g.fillStyle = lg(0, top, 0, bot, [[0, '#4e463d'], [0.06, '#8e867a'], [0.12, '#d8d1c5'], [0.6, '#b0a89b'], [0.64, COL.ember], [0.7, COL.ember], [0.73, '#8d8579'], [1, '#403a33']]);
    rr(x0, top, L, h, 0.02 * u); g.fill();
    // windows band
    const wy = top + h * 0.22, wh = h * 0.40;
    g.fillStyle = '#120d0a'; g.fillRect(x0 + 0.01 * u, wy, L - 0.02 * u, wh);
    const nPane = 8;
    for (let i = 0; i < nPane; i++) {
      const wx = x0 + L * (0.03 + i * 0.1175), ww = L * 0.095, door = (i === 1 || i === 4 || i === 6) ? 1 : 0;
      if (door) continue;
      const glow = g.createLinearGradient(0, wy, 0, wy + wh); glow.addColorStop(0, '#ffe0a8'); glow.addColorStop(1, '#ff9a3a');
      g.fillStyle = glow; g.globalAlpha = 0.95; g.fillRect(wx, wy + 0.008 * u, ww, wh - 0.016 * u); g.globalAlpha = 1;
      if (rnd(k * 31 + i) > 0.42) { g.fillStyle = 'rgba(20,12,8,0.82)'; const px = wx + ww * (0.3 + rnd(k + i) * 0.4); g.beginPath(); g.arc(px, wy + wh * 0.5, 0.017 * u, 0, 7); g.fill(); rr(px - 0.024 * u, wy + wh * 0.5 + 0.012 * u, 0.048 * u, wh, 0.02 * u); g.fill(); }
    }
    // doors: three per car, leaves slide apart as they open
    const DW = 0.1 * u, doorTop = wy - 0.012 * u, doorBot = bot - 0.012 * u;
    [1, 4, 6].forEach((i) => {
      const cx = x0 + L * (0.03 + i * 0.1175) + L * 0.0475 - (i === 1 ? 0 : 0), dx = cx - DW / 2, gap = open * DW * 0.46;
      g.fillStyle = open > 0.02 ? lg(0, doorTop, 0, doorBot, [[0, '#fff0cf'], [1, '#ffb055']]) : '#120d0a'; g.fillRect(dx, doorTop, DW, doorBot - doorTop);
      if (open > 0.02) { g.fillStyle = 'rgba(20,12,8,0.8)'; g.beginPath(); g.arc(dx + DW * 0.5, doorTop + (doorBot - doorTop) * 0.45, 0.016 * u, 0, 7); g.fill(); }
      g.fillStyle = '#9a9286'; g.fillRect(dx, doorTop, DW / 2 - gap, doorBot - doorTop); g.fillRect(dx + DW / 2 + gap, doorTop, DW / 2 - gap, doorBot - doorTop);
      g.fillStyle = 'rgba(30,24,20,0.7)'; g.fillRect(dx + 3, doorTop + 3, Math.max(0, DW / 2 - gap - 6), (doorBot - doorTop) * 0.55); g.fillRect(dx + DW / 2 + gap + 3, doorTop + 3, Math.max(0, DW / 2 - gap - 6), (doorBot - doorTop) * 0.55);
      g.fillStyle = COL.sun; g.fillRect(dx - 3, doorTop, 3, doorBot - doorTop); g.fillRect(dx + DW, doorTop, 3, doorBot - doorTop);
    });
    // bogies and skirt
    g.fillStyle = '#0c0907'; g.fillRect(x0 + L * 0.12, bot, L * 0.16, 0.03 * u); g.fillRect(x0 + L * 0.72, bot, L * 0.16, 0.03 * u);
    g.fillStyle = '#16100c'; g.beginPath(); g.arc(x0 + L * 0.16, trackY - 0.012 * u, 0.018 * u, 0, 7); g.arc(x0 + L * 0.24, trackY - 0.012 * u, 0.018 * u, 0, 7); g.arc(x0 + L * 0.76, trackY - 0.012 * u, 0.018 * u, 0, 7); g.arc(x0 + L * 0.84, trackY - 0.012 * u, 0.018 * u, 0, 7); g.fill();
    // blur streaks across the glass
    if (blur > 0.02) { g.fillStyle = `rgba(255,236,200,${0.18 * blur})`; for (let i = 0; i < 6; i++) g.fillRect(x0 + rnd(k * 9 + i) * L, wy + rnd(i + k) * wh, L * 0.16 * blur, 2); }
  }
  function train() {
    const open = DOOR(pS), v = Math.min(1, speed / (0.05 * u)), gapW = GAP * u;
    for (let pass = reduce ? 0 : 3; pass >= 0; pass--) {
      if (pass > 0 && v < 0.18) continue;
      g.save(); g.globalAlpha = pass ? 0.16 * v : 1; g.translate(-pass * v * 0.06 * u * (rel >= 0 ? 1 : -1), 0);   // ghosts trail behind the motion
      for (let i = 0; i < CARS; i++) {
        const frontWx = X - i * (LC + GAP), x0 = (frontWx - LC - C) * u;
        if (x0 > W + 40 || x0 + LC * u < -40) continue;
        car(x0, i, open, pass ? 0 : v);
      }
      g.restore();
    }
    // lights: headlamp throws forward, tail lamps glow red
    const hx = (X - C) * u;
    if (hx > -60 && hx < W + 400 * 1) { const gl = g.createRadialGradient(hx, trackY - 0.1 * u, 0, hx, trackY - 0.1 * u, 0.5 * u); gl.addColorStop(0, 'rgba(255,244,210,0.55)'); gl.addColorStop(1, 'rgba(255,244,210,0)'); g.fillStyle = gl; g.fillRect(hx - 0.5 * u, trackY - 0.6 * u, 1 * u, 1 * u); }
    const tx = (X - TRAIN - C) * u;
    if (tx > -60 && tx < W + 60) { const gl = g.createRadialGradient(tx, trackY - 0.1 * u, 0, tx, trackY - 0.1 * u, 0.25 * u); gl.addColorStop(0, 'rgba(255,40,30,0.7)'); gl.addColorStop(1, 'rgba(255,40,30,0)'); g.fillStyle = gl; g.fillRect(tx - 0.25 * u, trackY - 0.35 * u, 0.5 * u, 0.5 * u); }
  }

  /* ---------- tunnel mouth, near platform, passengers ---------- */
  function tunnel() {
    const x = (XP - C) * u; if (x > W + 40) return;
    const top = trackY - 0.52 * u;
    g.fillStyle = '#030202'; g.beginPath(); g.moveTo(x, nearFloor); g.lineTo(x, top + 0.3 * u); g.quadraticCurveTo(x, top, x + 0.3 * u, top); g.lineTo(W + 10, 0); g.lineTo(W + 10, nearFloor); g.closePath(); g.fill();
    g.fillStyle = '#2a2019'; g.fillRect(x - 0.03 * u, top + 0.3 * u, 0.03 * u, nearFloor - top - 0.3 * u);
    g.fillStyle = 'rgba(255,190,110,0.25)'; g.fillRect(x - 2, top + 0.3 * u, 2, nearFloor - top - 0.3 * u);
    // signal lamp on a post
    g.fillStyle = '#17110d'; g.fillRect(x - 0.3 * u, trackY - 0.3 * u, 0.012 * u, 0.3 * u);
    const sig = pS > 0.84 ? '#3ecb6a' : '#ff4a3a', gl = g.createRadialGradient(x - 0.294 * u, trackY - 0.3 * u, 0, x - 0.294 * u, trackY - 0.3 * u, 0.08 * u);
    gl.addColorStop(0, sig); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(x - 0.4 * u, trackY - 0.4 * u, 0.2 * u, 0.2 * u);
    // tail lamps vanishing down the tunnel
    const tx = X - TRAIN;
    if (tx > XP) { const d = tx - XP, a = clamp(1 - d / 7, 0, 1), r = Math.max(1.5, 0.03 * u * (1 - d / 8)), px = (XP - C) * u + (0.22 + d * 0.035) * u; g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,50,40,${0.9 * a})`; g.beginPath(); g.arc(px, trackY - 0.12 * u, r * 2.4, 0, 7); g.fill(); g.fillStyle = `rgba(255,170,150,${a})`; g.beginPath(); g.arc(px, trackY - 0.12 * u, r * 0.8, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; }
  }
  function nearPlatform() {
    g.fillStyle = lg(0, nearFloor, 0, H, [[0, '#2f241b'], [0.06, '#1b130f'], [1, '#080605']]); g.fillRect(0, nearFloor, W, H - nearFloor + 1);
    // tactile edge strip, yellow with bumps
    const sh = Math.max(7, 0.028 * u);
    g.fillStyle = '#d6a735'; g.fillRect(0, nearFloor, W, sh); g.fillStyle = 'rgba(70,50,10,0.55)';
    for (let x = -((C * u) % 9); x < W; x += 9) for (let y = nearFloor + 2; y < nearFloor + sh - 2; y += 5) { g.beginPath(); g.arc(x + 3, y + 1, 1.6, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,190,110,0.18)'; g.fillRect(0, nearFloor + sh, W, 2);
    // reflected strip lights on the floor
    const S = 2.3, [a, b] = range(1, S, 1);
    for (let k = a; k <= b; k++) { const x = sx(k * S + 0.3, 1); g.fillStyle = lg(0, nearFloor + sh, 0, H, [[0, 'rgba(255,200,130,0.10)'], [1, 'rgba(255,200,130,0)']]); g.fillRect(x, nearFloor + sh, 1.2 * u, H - nearFloor); }
    const bd = BOARD(pS);
    for (const p of NEAR) {
      const stand = Math.min(H * 0.985, nearFloor + 0.105 * u); let x = sx(p.x, 1), fy = stand, h = 0.15 * u * p.scale, al = 1;
      if (p.door != null) { x = sx(lerp(p.x, p.door, clamp(bd * 1.4, 0, 1)), 1); fy = lerp(stand, trackY - 0.02 * u, clamp((bd - 0.25) / 0.75, 0, 1)); h = lerp(h, 0.12 * u, clamp((bd - 0.25) / 0.75, 0, 1)); al = 1 - clamp((bd - 0.8) / 0.2, 0, 1); }
      if (x < -120 || x > W + 120 || al <= 0) continue;
      const q = Object.assign({}, p, { a: al, dir: p.door != null ? (p.door >= p.x ? 1 : 1) : p.dir });
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, fy + 2, h * 0.28, h * 0.05, 0, 0, 7); g.fill();
      person(x, fy, h, q);
    }
  }
  function foreground() {
    const S = 9, [a, b] = range(1.45, S, 1);
    for (let k = a; k <= b; k++) { const x = sx(k * S + 2.5, 1.45), w = 0.16 * u; g.fillStyle = lg(x, 0, x + w, 0, [[0, 'rgba(4,3,2,0.97)'], [0.7, 'rgba(10,7,5,0.97)'], [1, 'rgba(4,3,2,0.9)']]); g.fillRect(x, 0, w, H); g.fillStyle = 'rgba(255,170,90,0.25)'; g.fillRect(x + w * 0.1, 0, 2, H); }
  }

  /* ---------- air: dust in the light, sparks off the rail ---------- */
  function air(dt) {
    g.globalCompositeOperation = 'lighter';
    for (const d of dust) {
      const x = mod((d.x - C * d.f * 0.6) * u * 0.5 + now * (reduce ? 0 : 4) * d.f * 0.01, W + 40) - 20, y = mod(d.y * H + (reduce ? 0 : Math.sin(now / 1800 + d.x) * 6), H);
      g.fillStyle = `rgba(255,214,160,${0.1 + 0.18 * (d.f / 1.35)})`; g.beginPath(); g.arc(x, y, d.s * (0.6 + d.f * 0.5), 0, 7); g.fill();
    }
    if (!reduce) {
      const v = Math.min(1, speed / (0.05 * u));
      if (v > 0.25) for (let i = 0; i < Math.floor(v * 3); i++) { const wx = C + Math.random() * (W / u); if (wx < X && wx > X - TRAIN) sparks.push({ x: wx, y: trackY - 0.005 * u, vx: (Math.random() - 0.3) * 0.3 * v, vy: -(0.05 + Math.random() * 0.3) * u, life: 0.5 + Math.random() * 0.5, t: 0 }); }
      sparks = sparks.filter((s) => (s.t += dt) < s.life);
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 0.5 * u * dt; const a = 1 - s.t / s.life; g.fillStyle = `rgba(255,${Math.round(120 + 90 * a)},40,${a})`; g.beginPath(); g.arc((s.x - C) * u, s.y, 1.5 + a, 0, 7); g.fill(); }
    }
    g.globalCompositeOperation = 'source-over';
  }

  /* ---------- the title: SUNDIAL's own, huge then docked top left ---------- */
  let tw = 1, th = 1;
  function layoutTitle() {
    title.style.fontSize = Math.min(innerWidth * 0.1, innerHeight * 0.24) + 'px'; title.style.transform = 'none';
    tw = title.offsetWidth || 1; th = title.offsetHeight || 1;
    const fit = innerWidth * 0.9; if (tw > fit) { title.style.fontSize = (parseFloat(title.style.fontSize) * fit / tw) + 'px'; tw = title.offsetWidth || tw; th = title.offsetHeight || th; }
    placeTitle();
  }
  function placeTitle() {
    const Wi = innerWidth, Hi = innerHeight, mobile = Wi < 860;
    tw = title.offsetWidth || tw; th = title.offsetHeight || th;
    const big = parseFloat(title.style.fontSize) || 100, small = mobile ? 17 : 22, s = small / big;
    const pp = clamp((pRaw - 0.02) / 0.2, 0, 1), e = pp < 0.5 ? 4 * pp * pp * pp : 1 - Math.pow(-2 * pp + 2, 3) / 2;
    const gut = Math.max(16, Math.min(Wi * 0.04, 54)), cy = mobile ? Hi * 0.44 : Hi * 0.47;
    const x0 = (Wi - tw) / 2, y0 = cy - th / 2, x1 = gut, y1 = mobile ? 14 : 16;
    title.style.transform = `translate(${x0 + (x1 - x0) * e}px,${y0 + (y1 - y0) * e}px) scale(${1 + (s - 1) * e})`;
    title.classList.toggle('docked', pp > 0.95);
  }

  /* ---------- frame ---------- */
  let visible = true, raf = 0, lastT = 0, running = false;
  function progress() { const r = hero.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - innerHeight), 0, 1); }
  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t; now = t;
    pRaw = progress();
    pS += (pRaw - pS) * (reduce ? 1 : 1 - Math.pow(0.0009, dt));   // eased, so a flick of the wheel still feels like a camera move
    if (Math.abs(pRaw - pS) < 0.0004) pS = pRaw;
    C = CAM(pS); X = XF(pS) + 0;
    rel = (X - lastX) - (C - lastC); speed = Math.abs(rel) * u; lastX = X; lastC = C;     // on-screen speed of the train, px per frame
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    backWall(); ceiling(); pillars(); farPlatform(); trackBed(); train(); tunnel(); nearPlatform(); foreground(); air(dt);
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
    // overlay text and the page's chin
    const fade = 1 - clamp(pRaw / 0.05, 0, 1);
    heroLine.style.opacity = fade; cue.style.opacity = fade; cue.style.pointerEvents = fade < 0.1 ? 'none' : 'auto';
    chin.style.transform = `translateY(${(1 - clamp((pRaw - 0.88) / 0.12, 0, 1)) * 101}%)`;
    placeTitle();
    document.body.classList.toggle('on-hero', pRaw < 0.98 && visible);
    if (visible && (Math.abs(pRaw - pS) > 0.0004 || sparks.length || !reduce)) raf = requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!raf && visible) { running = true; raf = requestAnimationFrame(frame); } }

  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) kick(); }, { rootMargin: '200px 0px' }).observe(hero);
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => { resize(); kick(); });
  addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('kbd'); });
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => { resize(); kick(); });
  function lerp(a, b, t) { return a + (b - a) * t; }
  window.SDSTATION = { get p() { return pS; }, get raw() { return pRaw; }, get cam() { return C; }, get x() { return X; } };   // read-only, for checking the scene
  resize(); kick();
})();
