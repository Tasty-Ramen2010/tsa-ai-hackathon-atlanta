# Handoff (for whoever is renaming/finishing "MARTA Max")

State at commit fa58416: site is plain/neutral (no SUNDIAL theming), still branded "ATL Access" in `index.html`, `README.md`, `js/bot.js` (button "Ask the helper"), `chat/bot.py` (system prompt), `chat/knowledge.md`, `tools/export_atlanta.py`.

## Rename to MARTA Max
1. Site: `<title>`, `.brand` link, hero/about text, footer in `index.html`; README title.
2. Helper (runs on the AGX, NOT on GitHub Pages): change the name in `chat/bot.py` (SYSTEM prompt line 1) and `chat/knowledge.md`, run `python3 chat/test_bot.py` (28 tests must pass), then redeploy:
   `B=/mnt/persistent/data/atl-bot; cat chat/bot.py | ssh agx-vpn "cat > $B/bot.py"; cat chat/knowledge.md | ssh agx-vpn "cat > $B/data/knowledge.md"; ssh agx-vpn 'kill $(pgrep -f "[a]tl-bot/bot.py")'` (a supervisor, `run.sh`, restarts it in ~5 s; never `pkill -f` without the `[a]` bracket trick over ssh).
3. Do not name MARTA as the operator: this is a student project, not affiliated with MARTA (keep a short disclaimer in the footer/about).

## Moving parts
- Public helper endpoint: `https://agx-orin.tail705d7c.ts.net:8443` (Tailscale Funnel -> `127.0.0.1:8090` bot -> `127.0.0.1:8088` llama-server, model on the board is `agx-model` = 35bk). Off switch: `tailscale funnel --https=8443 off` on the board, or `touch /mnt/persistent/data/atl-bot/paused`. If you move the site to another origin, add it to `BOT_ORIGINS` (env in `run.sh`), otherwise CORS blocks the helper.
- Reaching the board from the Mac on a network that blocks Tailscale: connect "VPN Proxy Master", run `ts-vpn-up`, then `ssh agx-vpn`.
- Helper -> page actions: `window.ATL.apply(actions)` in `js/app.js`; actions are derived server-side from the visitor's words only (`derive_actions` in `chat/bot.py`). Keep it that way (anti prompt injection).
- Data: `python3 tools/export_atlanta.py` (Overpass is flaky; `overpass.openstreetmap.fr` was the reliable mirror).
- Not verified in a real browser: layout, mouse reader audio, map markers, chat widget. Please open the live page and click through once.
