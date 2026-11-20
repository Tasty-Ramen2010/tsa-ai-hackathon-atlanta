# SUNDIAL ATL — TSA AI Hackathon

**Prompt:** Build an application that makes navigating the Atlanta metropolitan area easier, safer, and more accessible for elderly individuals and people with disabilities.

**Approach:** a remodel of our [SUNDIAL](https://github.com/Tasty-Ramen2010/sundial) site (globe-first, time-of-day sky, country sheets, data-confidence tiers, static GitHub Pages). SUNDIAL corrected fire counts for the time of day; SUNDIAL ATL uses the same idea so people can pick the right place *and* the right hour (heat, cold, daylight), with accessibility information shown honestly (confirmed / reported / unknown).

## Reused from SUNDIAL
fonts, colour tokens, loader, `sky.js` (sun-altitude sky gradient), d3 + topojson vendor libs, dock, place sheet, scoreboard-style lists, static-export tooling (`tools/export_static.py` -> `tools/export_atlanta.py`).

## Data (all open, no API keys) — `python3 tools/export_atlanta.py`
- MARTA GTFS: rail stations + bus stops with `wheelchair_boarding`
- OpenStreetMap (Overpass): hospitals, pharmacies, clinics, libraries, senior/community centres, restrooms, supermarkets with wheelchair tags
- Open-Meteo (ERA5): hourly temperature / feels-like by month, 2021-2025
- US Census (us-atlas): 10 core metro counties

## Trip planner
The first screen is a metro platform: scroll and a train passes. The next page is the planner: pick a start and destination (or tap the map), see the best MARTA trip from real timetables, schedule it, and get reminders plus a calendar file. See `COLLAB.md`.

## Status
- [x] Data exporters, MARTA / climate / counties data
- [ ] OSM places data (`data/places.json`)
- [ ] Site: index.html, js/, styles.css
- [ ] GitHub Pages deploy

AI helped write this project's code; sources are checked by the team.
