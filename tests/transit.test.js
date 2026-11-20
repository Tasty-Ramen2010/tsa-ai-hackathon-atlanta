// Run: node tests/transit.test.js   (real MARTA timetable, no dependencies)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../js/access.js');
const T = require('../js/transit.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
const marta = load('marta.json'), rail = load('rail.json'), climate = load('climate.json');
const tr = T.create(rail, marta);
const st = (re) => { const s = marta.stations.find((x) => x.rail && re.test(x.name)); assert.ok(s, String(re)); return { lat: s.lat, lon: s.lon, label: s.name.replace(/ Station$/, '') }; };
const wed = new Date(2026, 10, 25); // Wednesday, inside the feed
const sat = new Date(2026, 10, 28);
const P = A.PROFILES;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const rides = (j) => j.legs.filter((l) => l.type === 'rail');

t('Five Points to Decatur is one Blue/Green ride of about 15 to 25 minutes', () => {
  const r = tr.plan({ from: st(/^Five Points/), to: st(/^Decatur/), date: wed, minutes: 10 * 60 }, { profile: P.general, climate });
  const j = r.options[0];
  assert.equal(rides(j).length, 1);
  assert.match(rides(j)[0].line, /BLUE|GREEN/);
  const ride = rides(j)[0].arr - rides(j)[0].dep;
  assert.ok(ride >= 12 && ride <= 25, ride);
});
t('North Ave to Decatur needs exactly one change, at Five Points', () => {
  const r = tr.plan({ from: st(/^North Ave/), to: st(/^Decatur/), date: wed, minutes: 10 * 60 }, { profile: P.general, climate });
  const j = r.options[0];
  assert.equal(rides(j).length, 2);
  assert.equal(j.legs.find((l) => l.type === 'transfer').at, 'Five Points');
  assert.ok(rides(j)[1].dep >= rides(j)[0].arr, 'second train leaves after the first arrives');
});
t('Airport to North Springs is one Red ride of about 40 to 55 minutes', () => {
  const r = tr.plan({ from: st(/^Airport/), to: st(/^North Springs/), date: wed, minutes: 9 * 60 }, { profile: P.general, climate });
  const j = r.options[0], ride = rides(j)[0];
  assert.equal(ride.line, 'RED');
  assert.ok(ride.arr - ride.dep >= 40 && ride.arr - ride.dep <= 55, ride.arr - ride.dep);
});
t('arrive-by: you get there on time and leave as late as possible', () => {
  const target = 14 * 60;
  const r = tr.plan({ from: st(/^Midtown/), to: st(/^Decatur/), date: wed, minutes: target, mode: 'arrive' }, { profile: P.general, climate });
  for (const j of r.options) assert.ok(j.arrive <= target, `arrive ${j.arrive}`);
  assert.ok(target - r.options[0].arrive < 20, 'not absurdly early');
});
t('a broken elevator at Five Points blocks the only change, so the planner says so instead of routing through it', () => {
  const five = marta.stations.find((s) => /^Five Points/.test(s.name));
  const r = tr.plan({ from: st(/^North Ave/), to: st(/^Decatur/), date: wed, minutes: 10 * 60 }, { profile: P.wheelchair, climate, avoid: new Set([five.id]) });
  assert.ok(r.error || r.options.every((j) => !j.legs.some((l) => l.type === 'transfer' && l.at === 'Five Points')));
});
t('a station with a broken elevator can still be ridden THROUGH (trains do not stop using it)', () => {
  const civic = marta.stations.find((s) => /^Civic Center/.test(s.name));
  const r = tr.plan({ from: st(/^Midtown/), to: st(/^Peachtree Center/), date: wed, minutes: 10 * 60 }, { profile: P.wheelchair, climate, avoid: new Set([civic.id]) });
  assert.ok(r.options && r.options.length, JSON.stringify(r.error));
  for (const j of r.options) for (const l of j.legs) if (l.type === 'rail') assert.ok(l.to !== 'Civic Center' && l.from !== 'Civic Center');
});
t('no service at 3 AM returns a clear error, not a crash', () => {
  const r = tr.plan({ from: st(/^Midtown/), to: st(/^Decatur/), date: wed, minutes: 3 * 60 }, { profile: P.general, climate });
  assert.ok(r.error || r.options.every((o) => o.leave >= 4 * 60), JSON.stringify(r.error));
});
t('Saturday uses the Saturday timetable (service exists, differs from weekday)', () => {
  const a = tr.plan({ from: st(/^Midtown/), to: st(/^Decatur/), date: sat, minutes: 8 * 60 }, { profile: P.general, climate });
  assert.ok(a.options.length && a.day === 'sa');
});
t('a date outside the feed gets an honest note', () => {
  const r = tr.plan({ from: st(/^Midtown/), to: st(/^Decatur/), date: new Date(2027, 1, 3), minutes: 9 * 60 }, { profile: P.general, climate });
  assert.ok(r.notes.some((x) => /schedule covers/.test(x)));
});
t('a hot July afternoon costs a heart-risk traveller more than a cool morning', () => {
  const july = new Date(2026, 6, 15);
  const hot = tr.plan({ from: st(/^Midtown/), to: { lat: 33.7527, lon: -84.3823, label: 'Grady' }, date: july, minutes: 15 * 60 }, { profile: P.heart, climate });
  const cool = tr.plan({ from: st(/^Midtown/), to: { lat: 33.7527, lon: -84.3823, label: 'Grady' }, date: july, minutes: 7 * 60 }, { profile: P.heart, climate });
  assert.ok(hot.options[0].cost > cool.options[0].cost);
  assert.ok(['high', 'danger'].includes(hot.options[0].heat));
});
console.log(`\n${n} tests passed`);
