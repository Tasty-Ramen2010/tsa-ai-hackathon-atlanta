// Run: node tests/access.test.js   (no dependencies)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/access.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
const marta = load('marta.json'), climate = load('climate.json');
const pt = {
  midtown: { lat: 33.781, lon: -84.386 },    // near Midtown station
  grady: { lat: 33.7527, lon: -84.3823 },    // downtown
  decatur: { lat: 33.7745, lon: -84.2963 },
  buckhead: { lat: 33.8479, lon: -84.3674 },
};
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('distance sanity (Midtown to Decatur is about 8 km)', () => {
  const d = A.dist(pt.midtown, pt.decatur);
  assert.ok(d > 7000 && d < 9500, d);
});
t('tiers: GTFS yes is confirmed, OSM yes is only reported', () => {
  assert.equal(A.tier(1, 'gtfs'), 'confirmed');
  assert.equal(A.tier(1, 'osm'), 'reported');
  assert.equal(A.tier(-1, 'osm'), 'unknown');
  assert.equal(A.weakest(['confirmed', 'reported', 'unknown']), 'unknown');
});
t('best hours in July are early morning or evening, never mid-afternoon', () => {
  const r = A.bestHours(climate, 6, A.PROFILES.heart);
  assert.ok(r.window.start <= 9 || r.window.start >= 17, JSON.stringify(r.window));
  const worst = r.ranked[r.ranked.length - 1].hour;
  assert.ok(worst >= 13 && worst <= 17, worst);
});
t('heat slows walking more for heat-sensitive people', () => {
  const g = A.walkMinutes(800, A.PROFILES.general, 100);
  const h = A.walkMinutes(800, A.PROFILES.heart, 100);
  assert.ok(h > g * 1.3);
  assert.ok(A.walkMinutes(800, A.PROFILES.heart, 70) < h);
});
t('nearest rail station to Midtown is a Midtown-area station', () => {
  const [first] = A.nearestStations(pt.midtown, marta.stations);
  assert.match(first.station.name, /Midtown|Arts Center|North Ave/);
  assert.ok(first.m < 1500);
});
t('walker: Midtown to Buckhead is rail, not a 5 km walk', () => {
  const [best] = A.plan({ from: pt.midtown, to: pt.buckhead }, marta, { profile: A.PROFILES.walker, climate, month: 6, hour: 15 });
  assert.equal(best.kind, 'rail');
  assert.ok(best.caveats.some((c) => /outages/.test(c)));
  assert.ok(best.caveats.some((c) => /feel like/.test(c)), 'hot July afternoon must warn');
});
t('cross-line trip (Midtown to Decatur) tells the rider to change at Five Points', () => {
  const [best] = A.plan({ from: pt.midtown, to: pt.decatur }, marta, { profile: A.PROFILES.wheelchair, climate, month: 3, hour: 10 });
  assert.equal(best.kind, 'rail');
  assert.ok(best.legs[1].transfer);
  assert.ok(best.caveats.some((c) => /Five Points/.test(c)));
});
t('hot afternoon raises exposed-minute cost for heart profile vs cool morning', () => {
  const hot = A.plan({ from: pt.midtown, to: pt.grady }, marta, { profile: A.PROFILES.heart, climate, month: 6, hour: 15 });
  const cool = A.plan({ from: pt.midtown, to: pt.grady }, marta, { profile: A.PROFILES.heart, climate, month: 6, hour: 7 });
  assert.ok(hot[0].score > cool[0].score);
});
t('rankPlaces never puts a not-accessible place first for a wheelchair user', () => {
  const places = [
    { k: 'pharmacy', n: 'Near but no', la: 33.7812, lo: -84.3861, wc: 0 },
    { k: 'pharmacy', n: 'Farther, accessible', la: 33.7860, lo: -84.3860, wc: 1 },
    { k: 'pharmacy', n: 'Unknown', la: 33.7830, lo: -84.3860, wc: -1 },
  ];
  const r = A.rankPlaces(places, pt.midtown, { profile: A.PROFILES.wheelchair, climate, month: 3, hour: 10, kind: 'pharmacy' });
  assert.equal(r[0].place.n, 'Farther, accessible');
  assert.equal(r[r.length - 1].place.n, 'Near but no');
});
console.log(`\n${n} tests passed`);
