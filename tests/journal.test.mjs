/* Tests du journal d'activité (sans DOM) — lancer : node --test tests/journal.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const J = require('../web/js/journal/journal-core.js');

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };

test('chaque ligne porte un niveau info / warn / crit, un niveau inconnu devient info', () => {
  J._useStore(memStore());
  J.info('import', 'Début', 'a.csv');
  J.warn('import', 'Ligne ignorée', 'Ligne 3 : ville vide');
  J.crit('import', 'Import refusé', 'colonnes absentes');
  J.log('debug', 'xxx', 'Autre', '');
  const e = J.entries();
  assert.deepEqual(e.map((x) => x.niveau), ['info', 'warn', 'crit', 'info']);
  assert.equal(e[3].categorie, 'systeme');
  assert.ok(e.every((x) => x.ts && x.id));
});

test('persistance et rechargement', () => {
  const s = memStore(); J._useStore(s);
  J.info('action', 'RDV ajouté', 'RDV 12');
  J._useStore(s);
  assert.equal(J.entries().length, 1);
  J.info('action', 'Second', '');
  assert.equal(J.entries()[1].id, 2);
});

test('filtres : niveaux, catégorie, texte sans accents, période', () => {
  J._useStore(memStore());
  J.info('import', 'Début de l’intégration', 'export.csv');
  J.warn('import', 'Type de visite inconnu ajouté', 'MAD 6');
  J.crit('optimisation', 'Échec de l’optimisation', 'VROOM ne répond pas');
  const all = J.entries();
  assert.equal(J.filter(all, { niveaux: ['warn', 'crit'] }).length, 2);
  assert.equal(J.filter(all, { categorie: 'import' }).length, 2);
  assert.equal(J.filter(all, { texte: 'echec' }).length, 1);
  assert.equal(J.filter(all, { texte: 'mad 6' }).length, 1);
  assert.equal(J.filter(all, { du: '2999-01-01' }).length, 0);
  assert.equal(J.filter(all, { au: '2000-01-01' }).length, 0);
  assert.equal(J.filter(all, {}).length, 3);
});

test('export CSV : BOM, séparateur ;, guillemets échappés, retours à la ligne neutralisés', () => {
  J._useStore(memStore());
  J.warn('import', 'Ligne ignorée', 'Ligne 4 : code postal invalide « 1300 »; "test"', { fichier: 'a;b.csv', note: 'x\ny' });
  const csv = J.toCsv(J.entries());
  assert.ok(csv.startsWith('﻿horodatage;niveau;categorie;action;message;details\r\n'));
  const line = csv.split('\r\n')[1];
  assert.match(line, /;"WARN";"Intégration CSV";"Ligne ignorée";/);
  assert.ok(line.includes('""test""'));
  assert.ok(!line.includes('\n'));
});

test('rotation au-delà de MAX_ENTREES et alertes non vues', () => {
  J._useStore(memStore());
  for (let i = 0; i < J.MAX_ENTREES + 10; i++) J.info('action', 'x' + i, '');
  assert.equal(J.entries().length, J.MAX_ENTREES);
  assert.equal(J.entries()[0].action, 'x10');
  assert.equal(J.unseen().length, 0);
  J.warn('import', 'w', ''); J.crit('import', 'c', '');
  assert.equal(J.unseen().length, 2);
  J.markSeen();
  assert.equal(J.unseen().length, 0);
});

test('vider le journal laisse une trace warn', () => {
  J._useStore(memStore());
  J.info('action', 'a', ''); J.clear();
  const e = J.entries();
  assert.equal(e.length, 1);
  assert.equal(e[0].niveau, 'warn');
});
