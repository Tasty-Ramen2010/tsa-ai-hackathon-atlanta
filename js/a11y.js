/* Mouse reader: speaks what is under the pointer (after a short dwell) and plays a soft
   spatial tick when the pointer enters a new control. Off by default, remembered in localStorage.
   Clicks are never intercepted. Needs window.ATL from js/app.js for the map markers. */
(function () {
  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const KEY = 'mreader', DWELL = 250;
  const INTER = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[tabindex]:not([tabindex="-1"])';
  const SYMBOLS = /[✓◐✕●○]/g;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let on = false, ac = null, timer = 0, lastTarget = null, lastInter = null, curKey = null, lastKey = null;

  /* ---------- speech ---------- */
  function say(text) {
    if (!text || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(SYMBOLS, '').replace(/\s+/g, ' ').trim());
      u.lang = 'en-US'; u.rate = 1;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function quiet() { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} }

  /* ---------- accessible name: aria-labelledby, aria-label, form label, alt, visible text, title ---------- */
  function nameOf(el, shallow) {
    if (!el || !el.getAttribute) return '';
    let s = '';
    const lb = el.getAttribute('aria-labelledby');
    if (lb) s = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ''; }).join(' ');
    if (!s) s = el.getAttribute('aria-label') || '';
    if (!s && el.tagName === 'IMG') s = el.getAttribute('alt') || '';
    if (!s && el.labels && el.labels.length) { // label text, without the controls inside the label
      const c = el.labels[0].cloneNode(true);
      c.querySelectorAll('select,input,textarea,button,svg').forEach((n) => n.remove());
      s = c.textContent;
    }
    if (el.tagName === 'SELECT' && s) { const o = el.options[el.selectedIndex]; if (o) s += ', ' + o.text; }
    if (el.tagName === 'INPUT' && el.type === 'range' && s) s += ', ' + (el.getAttribute('aria-valuetext') || el.value);
    if (!s && !shallow) s = el.innerText || '';
    if (!s) s = el.getAttribute('title') || '';
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const p = el.getAttribute('aria-pressed');
    if (p === 'true') s += ', on'; else if (p === 'false') s += ', off';
    return s.length > 240 ? s.slice(0, 240).replace(/\s\S*$/, '') + '…' : s;
  }
  // The control under the pointer, or the nearest ancestor with a name.
  function speakable(start) {
    let el = start;
    for (let i = 0; el && el !== document.body && i < 5; i++, el = el.parentElement) {
      const text = nameOf(el, i > 0);
      if (text) return { key: el, text };
    }
    return null;
  }

  /* ---------- spatial tick: pitch rises toward the top, pans with x, very quiet ---------- */
  function ensureAudio() {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
    } catch (e) { ac = null; }
  }
  function tick(x, y) {
    if (!ac) return;
    try {
      if (ac.state === 'suspended') return;
      const now = ac.currentTime, osc = ac.createOscillator(), gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = 520 + (1 - clamp(y / window.innerHeight, 0, 1)) * 900;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.03, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      osc.connect(gain);
      if (ac.createStereoPanner) {
        const pan = ac.createStereoPanner();
        pan.pan.value = clamp((x / window.innerWidth) * 2 - 1, -1, 1) * 0.9;
        gain.connect(pan); pan.connect(ac.destination);
      } else gain.connect(ac.destination);
      osc.start(now); osc.stop(now + 0.08);
    } catch (e) {}
  }

  /* ---------- dwell: speak after 250 ms on the same thing; skip a repeat of the same thing ---------- */
  function aim(tg) {
    const key = tg ? tg.key : null;
    if (key === curKey) return;
    curKey = key;
    clearTimeout(timer);
    if (!tg) { lastKey = null; return; }
    timer = setTimeout(() => {
      if (tg.key === lastKey) return;
      lastKey = tg.key;
      say(tg.text);
    }, DWELL);
  }
  function onMove(e) {
    if (!on || e.pointerType === 'touch') return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const x = e.clientX, y = e.clientY;
    const inter = t.closest(INTER);
    if (inter !== lastInter) { lastInter = inter; if (inter) tick(x, y); }

    const map = t.closest('#map');
    if (map) { // map canvas: speak a marker only when the pointer is within 30 px of it
      const rc = map.getBoundingClientRect();
      const hit = window.ATL && window.ATL.nearestResult(x - rc.left, y - rc.top, 30);
      lastTarget = null;
      aim(hit ? { key: 'marker' + hit.number, text: `Number ${hit.number}, ${hit.name}, ${hit.distance}, ${hit.access}.` } : null);
      return;
    }
    if (t === lastTarget) return;
    lastTarget = t;
    const sp = speakable(inter || t);
    aim(sp);
  }
  function onFocus(e) { // keyboard focus only (focus-visible), so mouse clicks stay quiet
    if (!on) return;
    let vis = false;
    try { vis = e.target.matches(':focus-visible'); } catch (err) {}
    if (!vis) return;
    const sp = speakable(e.target);
    if (!sp) return;
    clearTimeout(timer); curKey = null; lastKey = sp.key;
    say(sp.text);
  }

  /* ---------- on / off ---------- */
  function setOn(v, announce) {
    on = !!v;
    const b = $('#t-mouse');
    if (b) b.setAttribute('aria-pressed', String(on));
    store.set(KEY, on);
    clearTimeout(timer); curKey = null; lastKey = null; lastTarget = null; lastInter = null;
    if (on) {
      ensureAudio();
      if (announce) say('Mouse reader on. Move the mouse over anything to hear it. Press Escape to stop speaking.');
    } else quiet();
  }

  function init() {
    const b = $('#t-mouse');
    if (b) b.addEventListener('click', () => setOn(!on, true));
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', (e) => { if (on && e.key === 'Escape') { quiet(); clearTimeout(timer); curKey = null; lastKey = null; } });
    // Audio needs a user gesture: unlock it on the first press or key after a restored "on".
    const unlock = () => { if (on) ensureAudio(); };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    setOn(store.get(KEY, false) === true, false);
  }
  init();
})();
