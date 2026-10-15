/* Tests du placement forcé des RDV par AMD (sans DOM) — lancer : node --test tests/force.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../web/js/optim/force-core.js');

test('paliers : réduction par 10 % jusqu’au minimum, puis limites, fin de journée, créneaux, horaires levés', () => {
  const p = F.paliers(50);
  assert.deepEqual(p.map((x) => x.coef), [100, 90, 80, 70, 60, 50, 50, 50, 50, 50]);
  assert.deepEqual(p.slice(-5).map((x) => [x.limites, x.fin, x.creneau, x.libre]), [[false, false, false, false], [true, false, false, false], [true, true, false, false], [true, true, true, false], [true, true, true, true]]);
  assert.deepEqual(F.paliers(65).map((x) => x.coef).slice(0, 5), [100, 90, 80, 70, 65]);
  assert.equal(F.paliers('abc')[5].coef, F.MIN_DEFAUT);
});

test('libellé : vide au réglage normal, détaillé sinon', () => {
  assert.equal(F.libelle(F.NORMAL), '');
  assert.equal(F.estForce(F.NORMAL), false);
  assert.equal(F.libelle({ coef: 70, limites: true, fin: false, creneau: false }), 'temps sur place réduit à 70 % · heures et km max levés');
  assert.equal(F.libelle({ coef: 50, limites: true, fin: true, creneau: true, libre: true }), 'temps sur place réduit à 50 % · heures et km max levés · fin de journée repoussée · horaires levés : RDV placés hors créneau si besoin');
});

/* solveur factice : l'AMD i tient ses RDV quand son temps sur place descend à seuil[i] % */
const solveur = (seuils, jobsParAmd) => {
  const vus = [];
  const resoudre = async (reglages) => {
    vus.push(reglages.map((r) => r.coef));
    const unassigned = [];
    jobsParAmd.forEach((ids, i) => { if (reglages[i].coef > seuils[i]) ids.forEach((id) => unassigned.push({ id })); });
    return { unassigned };
  };
  const amdDuJob = (id) => jobsParAmd.findIndex((ids) => ids.includes(id));
  return { resoudre, amdDuJob, vus };
};

test('seul l’AMD saturé est desserré, et juste ce qu’il faut', async () => {
  const s = solveur([100, 70], [[1, 2], [3, 4, 5]]);
  const r = await F.forcer(s.resoudre, s.amdDuJob, 2, 50);
  assert.equal(r.res.unassigned.length, 0);
  assert.equal(r.reglages[0].coef, 100);
  assert.equal(r.reglages[1].coef, 70);
  assert.equal(r.appels, 4);
  assert.deepEqual(s.vus.map((v) => v[0]), [100, 100, 100, 100]);
});

test('au-delà du minimum : limites, fin de journée, créneaux puis horaires levés, et arrêt au dernier palier', async () => {
  const resoudre = async () => ({ unassigned: [{ id: 1 }] }); // jamais plaçable
  const r = await F.forcer(resoudre, () => 0, 1, 50);
  assert.equal(r.appels, F.paliers(50).length);
  assert.deepEqual(r.reglages[0], { coef: 50, limites: true, fin: true, creneau: true, libre: true });
  assert.equal(r.res.unassigned.length, 1);
});

test('aucun RDV non placé : un seul calcul, réglage normal', async () => {
  const r = await F.forcer(async () => ({ unassigned: [] }), () => 0, 3, 50);
  assert.equal(r.appels, 1);
  assert.ok(r.reglages.every((x) => !F.estForce(x)));
});
