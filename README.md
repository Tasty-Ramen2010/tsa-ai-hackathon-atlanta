# MARTA Max — TSA AI Hackathon

**Prompt:** Build an application that makes navigating the Atlanta metropolitan area easier, safer, and more accessible for elderly individuals and people with disabilities.

**Live site:** https://tasty-ramen2010.github.io/tsa-ai-hackathon-atlanta/

## Trip planner (new)
The first screen is a metro platform: scroll and a train passes. The next page plans trips on **real MARTA rail timetables** (`data/rail.json`), with walks, transfers, arrive-by, "avoid this station" for broken elevators, scheduling and reminders (+ calendar file). Code: `js/station.js`, `js/transit.js`, `js/access.js`, `js/tripui.js`; tests: `node tests/transit.test.js`. See `COLLAB.md`.

## What it does
- Pick what helps you get around (wheelchair/scooter, can't walk far, low vision, deaf/hard of hearing, plain words) and what you need (pharmacy, hospital, clinic, library, senior center, community center, grocery, restroom).
- Ranks real places near you with an honest access label (step-free reported / partly / not reported / not accessible), opening hours at your chosen time, and the nearest wheelchair-accessible MARTA stop.
- Shows how hot, cold or dark it will be at the hour and month you choose (historical averages) with plain advice.
- **Helper chat:** type or say what you want and it sets the page up for you. Runs a 35B model on our own AGX Orin, reached over Tailscale, with retrieval over this site's data and prompt-injection defences (`chat/`).
- **Accessibility:** large text, high-contrast mode, mouse reader (speaks what the pointer is over), read-aloud for every place, colorblind-safe palette with symbols and marker shapes (never color alone), full keyboard use, printable trip card.

## Data (all open, no API keys) — `python3 tools/export_atlanta.py`
MARTA GTFS (stops + wheelchair flag), OpenStreetMap via Overpass (places + wheelchair tags), Open-Meteo ERA5 (hourly temperature 2021–2025), US Census counties.

## Layout
`index.html`, `styles.css`, `js/` (app, a11y mouse reader/colors, helper widget), `data/`, `tools/` (exporter), `chat/` (helper server `bot.py`, knowledge base, tests: `python3 chat/test_bot.py`).

AI helped write this project's code; sources are checked by the team. Not medical or legal advice; hours and access change, so call first.
