# Claude-to-Claude handoff

Second Claude session, working from branch `claude/access-engine`. It touches only the files below, so it should merge cleanly with the site work on `main`.

## Added
- `js/access.js`: pure logic, no DOM, no dependencies. Loads as `window.ACCESS` in the browser or `require()` in Node.
- `tests/access.test.js`: run `node tests/access.test.js` (9 tests, uses the real files in `data/`).

## Not touched (yours)
`index.html`, `styles.css`, other `js/` files, `tools/`, `data/`, `README.md`.

## API (`ACCESS.*`)
| Call | Returns |
|---|---|
| `PROFILES` | `general, walker, wheelchair, lowvision, heart`, each with `label, speed, heat, maxWalk, stepFree, needsRest` |
| `bestHours(climate, month0, profile, {from,to})` | `{hours[], ranked[], window:{start,end}}`: the "right hour" for a month. Each hour has `feels, hot90, level, score` |
| `plan({from,to}, marta, {profile, climate, month, hour})` | Options best first: walk, or walk + MARTA + walk. Each has `totalMin, walkMetres, exposedMin, legs[], tier, heat, caveats[]` |
| `rankPlaces(places, origin, {profile, climate, month, hour, kind})` | `places.json` entries ranked by walk time, heat, access tier and the person's comfortable walking limit |
| `nearestStations(pt, stations, {n, stepFree})` | Closest rail stations with walk metres |
| `tier(wc, 'gtfs'\|'osm')` | `confirmed / reported / limited / no / unknown` for the confidence badges |
| `heatLevel(feels, profile)`, `walkMinutes(m, profile, feels)` | `ok / moderate / high / danger / cold` and heat-adjusted minutes |

Points are `{lat, lon}`. `month0` is 0 to 11. `hour` is 0 to 23, local time.

## Honest limits (keep these visible in the UI)
- MARTA GTFS `wheelchair_boarding` says a station is accessible. It does **not** say whether today's elevator is working. `plan()` always adds a "check MARTA alerts" caveat.
- `plan()` estimates rail time from distance, not from the timetable, and has no sidewalk, slope or curb-ramp data, so it says so in the caveats.
- OSM wheelchair tags are volunteer-mapped, so they get tier `reported`, never `confirmed`.

## Open items
- `data/places.json` (your exporter step) is still missing. `rankPlaces` is ready for its shape (`k, n, la, lo, wc`).
- `data/climate.json` was exported before `cold32` was added to the exporter. Re-run `python3 tools/export_atlanta.py --only climate` if the UI needs it.
- Site UI: wire `ACCESS.bestHours` to the time-of-day sky, and `plan` / `rankPlaces` to the place sheet.
