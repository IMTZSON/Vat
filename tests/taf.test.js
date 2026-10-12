const test = require('node:test');
const assert = require('node:assert/strict');
const Taf = require('../js/taf.js');

const Z = (s) => Date.parse(`${s}Z`);

const EGLL = 'TAF EGLL 120458Z 1206/1312 24012KT 9999 SCT030 PROB30 TEMPO 1210/1214 7000 -SHRA BKN014 '
  + 'BECMG 1215/1218 30008KT FM130000 VRB03KT 4000 BR BKN006 TEMPO 1303/1308 0800 FG=';

test('parse: intestazione, validità e gruppi', () => {
  const t = Taf.parse(EGLL, Z('2026-10-12T06:00'));
  assert.equal(t.station, 'EGLL');
  assert.equal(t.issued, Z('2026-10-12T04:58'));
  assert.equal(t.from, Z('2026-10-12T06:00'));
  assert.equal(t.to, Z('2026-10-13T12:00'));
  assert.deepEqual(t.periods.map((p) => p.kind), ['BASE', 'PROB', 'BECMG', 'FM', 'TEMPO']);
  const [base, prob, becmg, fm] = t.periods;
  assert.equal(base.category, 'VFR');
  assert.equal(base.to, fm.from, 'FM chiude il periodo prevalente');
  assert.equal(prob.prob, 30);
  assert.equal(prob.tempo, true);
  assert.equal(prob.category, 'MVFR');
  assert.deepEqual(becmg.wind, { dir: 300, speed: 8, gust: null });
  assert.equal(becmg.category, 'VFR', 'BECMG del solo vento eredita la categoria');
  assert.equal(fm.category, 'IFR');
});

test('at: condizioni prevalenti più cambiamenti temporanei', () => {
  const t = Taf.parse(EGLL, Z('2026-10-12T06:00'));
  let c = Taf.at(t, Z('2026-10-12T08:00'));
  assert.equal(c.main.category, 'VFR');
  assert.equal(c.changes.length, 0);
  assert.equal(c.worst, 'VFR');
  assert.equal(c.inside, true);

  c = Taf.at(t, Z('2026-10-12T11:00'));
  assert.equal(c.main.category, 'VFR');
  assert.equal(c.changes.length, 1);
  assert.equal(c.worst, 'MVFR');

  c = Taf.at(t, Z('2026-10-12T16:00'));
  assert.equal(c.main.wind.dir, 240, 'durante il BECMG prevale ancora il vento di prima');
  assert.equal(c.changes[0].kind, 'BECMG');

  c = Taf.at(t, Z('2026-10-12T20:00'));
  assert.equal(c.main.wind.dir, 300, 'dopo il BECMG');
  assert.equal(c.main.visibility, 10000, 'gli altri elementi restano');

  c = Taf.at(t, Z('2026-10-13T02:00'));
  assert.equal(c.main.category, 'IFR');
  assert.equal(c.main.wind.dir, null);

  c = Taf.at(t, Z('2026-10-13T05:00'));
  assert.equal(c.worst, 'LIFR');
  assert.equal(Taf.at(t, Z('2026-10-13T13:00')).inside, false);
});

test('date: cambio di mese e ora 24', () => {
  const a = Taf.parse('TAF LIRF 302300Z 0100/0206 VRB02KT CAVOK', Z('2026-09-30T23:10'));
  assert.equal(a.issued, Z('2026-09-30T23:00'));
  assert.equal(a.from, Z('2026-10-01T00:00'));
  assert.equal(a.to, Z('2026-10-02T06:00'));
  assert.equal(a.periods[0].category, 'VFR');

  const b = Taf.parse('TAF KJFK 121720Z 1218/1324 18010KT P6SM FEW250 FM130200 20008KT 1 1/2SM BR OVC004', Z('2026-10-12T17:30'));
  assert.equal(b.to, Z('2026-10-14T00:00'));
  assert.equal(b.periods[0].visibility, 10000);
  assert.equal(b.periods[1].visibility, 2414);
  assert.equal(b.periods[1].category, 'LIFR');
});

test('CAVOK, NSW, MPS, TEMPO con temporale', () => {
  const t = Taf.parse('TAF UUEE 121100Z 1212/1312 18005MPS 6000 BKN010 TEMPO 1212/1216 2000 +TSRA BKN008CB BECMG 1216/1218 NSW CAVOK', Z('2026-10-12T11:30'));
  assert.equal(t.periods[0].wind.speed, 10);
  const ts = Taf.at(t, Z('2026-10-12T13:00'));
  assert.equal(ts.worst, 'IFR');
  assert.equal(Taf.icon(ts.changes[0].full), 'cloud-lightning');
  const after = Taf.at(t, Z('2026-10-12T20:00')).main;
  assert.equal(after.cavok, true);
  assert.deepEqual(after.wx, []);
  assert.equal(after.category, 'VFR');
  assert.equal(Taf.visShort(after), 'CAVOK');
});

test('testi brevi e descrizione', () => {
  assert.equal(Taf.windShort({ dir: 270, speed: 12, gust: 25 }), '270/12G25');
  assert.equal(Taf.windShort({ dir: null, speed: 3, gust: null }), 'VRB/3');
  assert.equal(Taf.windShort({ dir: 0, speed: 0 }), '00000');
  assert.equal(Taf.visShort({ visibility: 800 }), '800 m');
  assert.equal(Taf.visShort({ visibility: 6000 }), '6 km');
  assert.equal(Taf.visShort({ visibility: 10000 }), '10 km+');
  assert.match(Taf.describe({ wx: ['-SHRA'], clouds: [{ cover: 'BKN', base: 1400, type: null }] }), /1400 ft/);
});

test('icone in stile app meteo', () => {
  assert.equal(Taf.icon({ wx: [], clouds: [] }, false), 'sun');
  assert.equal(Taf.icon({ wx: [], clouds: [] }, true), 'moon');
  assert.equal(Taf.icon({ wx: [], clouds: [{ cover: 'SCT' }] }, false), 'cloud-sun');
  assert.equal(Taf.icon({ wx: [], clouds: [{ cover: 'FEW' }] }, true), 'cloud-moon');
  assert.equal(Taf.icon({ wx: [], clouds: [{ cover: 'OVC' }] }), 'cloud');
  assert.equal(Taf.icon({ wx: ['-DZ'] }), 'cloud-drizzle');
  assert.equal(Taf.icon({ wx: ['-RA'] }), 'cloud-drizzle');
  assert.equal(Taf.icon({ wx: ['SHRA'] }), 'cloud-rain');
  assert.equal(Taf.icon({ wx: ['SN'] }), 'cloud-snow');
  assert.equal(Taf.icon({ wx: ['BR'] }), 'cloud-fog');
  assert.equal(Taf.icon({ wx: ['HZ'] }), 'haze');
  assert.equal(Taf.icon({ wx: ['VCTS'] }), 'cloud-lightning');
});

test('notte e giorno dalla posizione del sole', () => {
  assert.equal(Taf.isNight(Z('2026-06-21T12:00'), 41.8, 12.25), false);
  assert.equal(Taf.isNight(Z('2026-06-21T23:00'), 41.8, 12.25), true);
  assert.equal(Taf.isNight(Z('2026-06-21T23:00'), 69.68, 18.92), false, 'sole di mezzanotte');
  assert.equal(Taf.isNight(Z('2026-12-21T11:00'), 69.68, 18.92), true, 'notte polare');
  assert.equal(Taf.isNight(Z('2026-06-21T12:00'), NaN, 0), false);
});

test('timeline a passi di ore piene dentro la validità', () => {
  const t = Taf.parse(EGLL, Z('2026-10-12T06:00'));
  const tl = Taf.timeline(t, Z('2026-10-12T07:20'), 3, 20);
  assert.equal(tl[0].t, Z('2026-10-12T08:00'));
  assert.equal(tl[1].t, Z('2026-10-12T11:00'));
  assert.equal(tl[tl.length - 1].t < t.to, true);
  assert.equal(tl.length, 10);
  assert.equal(Taf.timeline(t, Z('2026-10-12T07:20'), 3, 4).length, 4);
});

test('input non valido, NIL e cancellato', () => {
  assert.equal(Taf.parse(''), null);
  assert.equal(Taf.parse('qualcosa di strano'), null);
  assert.equal(Taf.parse('TAF EGLL 120458Z NIL'), null);
  const c = Taf.parse('TAF AMD EGLL 120600Z 1206/1312 CNL', Z('2026-10-12T06:10'));
  assert.equal(c.cancelled, true);
  assert.equal(c.amended, true);
  assert.equal(Taf.at(c, Z('2026-10-12T08:00')), null);
});
