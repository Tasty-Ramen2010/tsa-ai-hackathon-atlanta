/* SUNDIAL ATL assistant widget. Talks to the AGX-hosted model through chat/bot.py (Tailscale Funnel). Replies are shown as plain text only. */
(function () {
  const URL = window.ATL_BOT_URL || 'https://agx-orin.tail705d7c.ts.net:8443';
  const ld = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const css = document.createElement('style');
  css.textContent = `
  #bot-btn{position:fixed;right:max(1rem,env(safe-area-inset-right));bottom:6.2rem;z-index:35;min-height:3.4rem;padding:0 1.3rem;border-radius:99px;border:2px solid #fff;background:var(--emberDeep,#b8420a);color:#fff;font:700 1.05rem var(--sans,sans-serif);cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35)}
  #bot{position:fixed;z-index:70;right:max(.8rem,env(safe-area-inset-right));bottom:.8rem;width:min(30rem,calc(100vw - 1.6rem));max-height:min(46rem,calc(100svh - 1.6rem));display:none;flex-direction:column;background:#fffaf0;color:#1c1510;border:3px solid #1c1510;border-radius:22px;box-shadow:0 12px 48px rgba(0,0,0,.5);font:400 1.1rem/1.45 var(--sans,sans-serif)}
  #bot.open{display:flex} body.hc #bot{background:#fff;border-color:#000}
  #bot header{display:flex;align-items:center;gap:.5rem;padding:.7rem .9rem;border-bottom:2px solid #1c1510}
  #bot h2{font:700 1.15rem var(--sans,sans-serif);margin:0;flex:1}
  #bot header button,#bot .row button{font:700 1rem var(--sans,sans-serif);min-height:2.75rem;min-width:2.75rem;padding:0 .9rem;border-radius:99px;border:2px solid #1c1510;background:#fff;color:#1c1510;cursor:pointer}
  #bot-log{flex:1;overflow-y:auto;padding:.8rem .9rem;display:flex;flex-direction:column;gap:.6rem;min-height:9rem}
  #bot-log p{margin:0;padding:.6rem .8rem;border-radius:16px;max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere}
  #bot-log .me{align-self:flex-end;background:#1c1510;color:#fff} #bot-log .ai{align-self:flex-start;background:#f0e4cc;border:2px solid #1c1510}
  #bot .sug{display:flex;flex-wrap:wrap;gap:.4rem;padding:0 .9rem .5rem} #bot .sug button{font:600 .95rem var(--sans,sans-serif);min-height:2.6rem;padding:.2rem .8rem;border-radius:99px;border:2px solid #1c1510;background:#fff;cursor:pointer}
  #bot form{display:flex;gap:.4rem;padding:.6rem .9rem;border-top:2px solid #1c1510} #bot input[type=text]{flex:1;min-width:0;font:400 1.1rem var(--sans,sans-serif);min-height:3rem;padding:0 .8rem;border-radius:14px;border:2px solid #1c1510;background:#fff;color:#1c1510}
  #bot form button{min-height:3rem;padding:0 1rem;border-radius:14px;border:2px solid #1c1510;background:var(--emberDeep,#b8420a);color:#fff;font:700 1rem var(--sans,sans-serif);cursor:pointer}
  #bot .row{display:flex;align-items:center;gap:.6rem;padding:0 .9rem .6rem;font-size:.9rem} #bot .note{font-size:.8rem;padding:0 .9rem .7rem;margin:0;color:#4d4439}
  #bot :focus-visible,#bot-btn:focus-visible{outline:3px solid #ffc65a;outline-offset:2px;box-shadow:0 0 0 5px #000}
  @media print{#bot,#bot-btn{display:none!important}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button'); btn.id = 'bot-btn'; btn.type = 'button'; btn.textContent = 'Ask SUNDIAL'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
  const box = document.createElement('section'); box.id = 'bot'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ask SUNDIAL, the helper'); box.setAttribute('aria-modal', 'false');
  box.innerHTML = `<header><h2>Ask SUNDIAL</h2><button type="button" id="bot-clear">Clear</button><button type="button" id="bot-x" aria-label="Close helper">Close</button></header>
    <div id="bot-log" role="log" aria-live="polite" aria-label="Conversation"></div>
    <div class="sug" id="bot-sug"></div>
    <div class="row"><label><input type="checkbox" id="bot-say"> Read answers aloud</label><button type="button" id="bot-mic" hidden aria-label="Speak your question">🎤 Speak</button></div>
    <form id="bot-form" autocomplete="off"><label class="sr" for="bot-in" style="position:absolute;left:-999px">Your question</label><input id="bot-in" type="text" maxlength="500" placeholder="Ask about places, MARTA, heat…" enterkeyhint="send"><button type="submit">Send</button></form>
    <p class="note">AI helper running on our own computer. It can be wrong: call places to confirm. Not medical advice. In an emergency call 911.</p>`;
  document.body.append(btn, box);
  const $ = (s) => box.querySelector(s), log = $('#bot-log'), inp = $('#bot-in');
  let hist = [], busy = false, online = null;

  const add = (t, who) => { const p = document.createElement('p'); p.className = who; p.textContent = t; log.appendChild(p); log.scrollTop = log.scrollHeight; return p; };
  const speak = (t) => { if ($('#bot-say').checked && window.speechSynthesis) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 0.92; speechSynthesis.speak(u); } };
  const ctx = () => { const c = { needs: ld('needs', []), kind: ld('kind', null), hour: ld('hour', null) }; if (window.ATL_STATE) try { Object.assign(c, window.ATL_STATE()); } catch (e) {} return c; };

  async function send(text) {
    text = text.trim().slice(0, 500); if (!text || busy) return;
    busy = true; add(text, 'me'); inp.value = '';
    const wait = add('Thinking…', 'ai');
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 70000);
      const r = await fetch(URL + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history: hist.slice(-3), ctx: ctx() }), signal: ac.signal });
      clearTimeout(to);
      const j = await r.json().catch(() => ({}));
      wait.textContent = j.reply || 'Sorry, something went wrong. Please try again, or use the list of places.';
      if (j.reply) hist.push(text);
      if (j.actions && typeof j.actions === 'object') {
        // Close the panel first so it does not cover the results. open(false) moves focus to the helper button,
        // so apply() runs after it and its focus on the results heading wins.
        try { open(false); if (window.ATL && window.ATL.apply(j.actions)) { add('I set that up for you. The results are on the page.', 'ai'); } } catch (e) {}
      }
      if (j.reply) speak(j.reply);
    } catch (e) { wait.textContent = 'I cannot reach the helper right now. The list of places above still works. Please try again later.'; }
    busy = false; inp.focus();
  }
  const open = (v) => { box.classList.toggle('open', v); btn.setAttribute('aria-expanded', v); btn.style.display = v ? 'none' : ''; if (v) { if (!log.children.length) hello(); inp.focus(); } else { btn.focus(); window.speechSynthesis && speechSynthesis.cancel(); } };
  function hello() {
    add('Hello! I can help you find accessible places in metro Atlanta, plan around the heat, or explain MARTA options. What would you like to know?', 'ai');
    const s = $('#bot-sug'); s.innerHTML = '';
    ['Where is the nearest pharmacy with step-free access?', 'When is the best time to go out in summer?', 'How do I get MARTA Mobility?', 'Where can I cool off?'].forEach((q) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.onclick = () => send(q); s.appendChild(b); });
  }
  btn.onclick = () => open(true); $('#bot-x').onclick = () => open(false);
  $('#bot-clear').onclick = () => { log.innerHTML = ''; hist = []; hello(); };
  $('#bot-form').onsubmit = (e) => { e.preventDefault(); send(inp.value); };
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  $('#bot-say').checked = !!ld('botsay', false); $('#bot-say').onchange = (e) => { try { localStorage.setItem('botsay', JSON.stringify(e.target.checked)); } catch (x) {} };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) { const mic = $('#bot-mic'); mic.hidden = false; mic.onclick = () => { const r = new SR(); r.lang = 'en-US'; r.onresult = (e) => { inp.value = e.results[0][0].transcript; send(inp.value); }; r.onerror = () => {}; try { r.start(); mic.textContent = '🎤 Listening…'; r.onend = () => (mic.textContent = '🎤 Speak'); } catch (x) {} }; }
})();
