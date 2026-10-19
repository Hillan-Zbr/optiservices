/* Tests des règles d'import CSV et des utilitaires de texte (sans DOM) — lancer : node --test tests/import.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../web/js/commun/texte-core.js');
const I = require('../web/js/import/import-core.js');

test('isoLocal : date locale, pas UTC (00h30 à Paris reste le jour même)', () => {
  const d = new Date(2026, 9, 16, 0, 30); // vendredi 16/10/2026 00h30 heure locale
  assert.equal(T.isoLocal(d), '2026-10-16');
});

test('parseDate : formats acceptés, dates impossibles refusées', () => {
  assert.equal(T.parseDate('16/10/2026'), '2026-10-16');
  assert.equal(T.parseDate('6/1/26'), '2026-01-06');
  assert.equal(T.parseDate('2026-10-16'), '2026-10-16');
  assert.equal(T.parseDate('32/10/2026'), null);
  assert.equal(T.parseDate('29/02/2026'), null);
  assert.equal(T.parseDate(''), null);
});

test('parseCsv : séparateur deviné, guillemets, BOM et lignes vides', () => {
  assert.deepEqual(T.parseCsv('﻿a;b\r\n"x;1";"di ""ok"""\r\n\r\n'), [['a', 'b'], ['x;1', 'di "ok"']]);
  assert.deepEqual(T.parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('csvCell / toCsv : formules Excel neutralisées, BOM et « ; »', () => {
  assert.equal(T.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(T.csvCell('+33 6'), '"\'+33 6"');
  assert.equal(T.csvCell('ligne 1\nligne 2'), '"ligne 1 ligne 2"');
  assert.equal(T.csvCell(12), '"12"');
  assert.equal(T.toCsv(['a', 'b'], [[1, null]]), '﻿a;b\r\n"1";""');
});

test('norm et pluriel', () => {
  assert.equal(T.norm('  Après-Midi '), 'apres midi');
  assert.equal(T.pluriel(1, 'RDV importé'), '1 RDV importé');
  assert.equal(T.pluriel(3, 'RDV importé'), '3 RDV importés');
  assert.equal(T.pluriel(2, 'nouveau', 'nouveaux'), '2 nouveaux');
  assert.equal(T.s(1) + T.s(2), 's');
});

test('hhmm et code postal', () => {
  assert.equal(I.hhmm('1900-01-01 8:15:00'), '08:15');
  assert.equal(I.hhmm(''), '');
  assert.equal(I.cpNormalise('4100'), '04100');
  assert.equal(I.cpNormalise('13 400'), '13400');
  assert.equal(I.cpNormalise('ABC'), null);
});

test('demi-journées : CSV du banc de test et Isadom', () => {
  assert.equal(I.parseCren('Après-midi'), 'am');
  assert.equal(I.parseCren('mi-journée'), 'mi');
  assert.equal(I.parseCren('soir'), null);
  assert.equal(I.crenFromIsadom('', '08:00', '12:30'), 'matin');
  assert.equal(I.crenFromIsadom('', '13:00', '17:00'), 'am');
  assert.equal(I.crenFromIsadom('', '10:00', '15:00'), 'jour');
  assert.equal(I.crenFromIsadom('', '', ''), 'jour');
  assert.equal(I.crenFromIsadom('Matin', '', ''), 'matin');
});

test('isadomGeo : W3W figées > lat/lon > W3W, hors zone ignoré', () => {
  const zone = ({ lat, lon }) => lat > 41 && lat < 46 && lon > 4 && lon < 10;
  const ligne = (o) => (c) => o[c] || '';
  assert.equal(I.isadomGeo(ligne({ w3wlat: '43,5', w3wlon: '5,5', w3wfigee: '1', lat: '44', lon: '6' }), zone).src, 'w3w');
  assert.equal(I.isadomGeo(ligne({ w3wlat: '43.5', w3wlon: '5.5', lat: '44', lon: '6' }), zone).src, 'isadom');
  assert.equal(I.isadomGeo(ligne({ w3wlat: '43.5', w3wlon: '5.5', lat: '48.8', lon: '2.3' }), zone).src, 'w3w');
  assert.equal(I.isadomGeo(ligne({ lat: '48.8', lon: '2.3' }), zone), null);
});

test('fusionIsadom : mise à jour par IdRdv, retrait des absents, saisies manuelles gardées', () => {
  const existants = [
    { idRdv: '1', date: '2026-10-16', v: 'ancien' },
    { idRdv: '2', date: '2026-10-16' },
    { idRdv: '3', date: '2026-10-17' },
    { date: '2026-10-16', patient: 'saisi à la main' }
  ];
  const nouveaux = new Map([['1', { idRdv: '1', date: '2026-10-16', v: 'nouveau' }], ['9', { idRdv: '9', date: '2026-10-16' }]]);
  const r = I.fusionIsadom(existants, nouveaux, new Set(['2026-10-16']));
  assert.deepEqual([r.updated, r.removed, r.added], [1, 1, 1]);
  assert.deepEqual(r.rdv.map((x) => x.idRdv || 'main'), ['3', 'main', '1', '9']);
  assert.equal(r.rdv.find((x) => x.idRdv === '1').v, 'nouveau');
});

test('prefPassage : une seule demi-journée cochée dans la fréquence O2', () => {
  assert.equal(I.prefPassage('1', '0'), 'matin');
  assert.equal(I.prefPassage('0', 'True'), 'am');
  assert.equal(I.prefPassage('1', '1'), null);
  assert.equal(I.prefPassage('', ''), null);
});

test('fenetrePref : fenêtre réduite à la demi-journée préférée, créneau Isadom gardé si incompatible', () => {
  const h = (x) => x * 3600;
  assert.deepEqual(I.fenetrePref([h(8), h(17.5)], [h(8), h(12)]), { w: [h(8), h(12)], conflit: false });
  assert.deepEqual(I.fenetrePref([h(10), h(15)], [h(13.5), h(17.5)]), { w: [h(13.5), h(15)], conflit: false });
  assert.deepEqual(I.fenetrePref([h(14), h(17)], [h(8), h(12)]), { w: [h(14), h(17)], conflit: true });
  assert.deepEqual(I.fenetrePref([h(8), h(12)], null), { w: [h(8), h(12)], conflit: false });
});
