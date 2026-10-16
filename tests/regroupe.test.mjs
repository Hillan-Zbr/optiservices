/* Tests du regroupement des RDV d'un même patient (sans DOM) — lancer : node --test tests/regroupe.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../web/js/optim/regroupe-core.js');

// données fictives : deux patients à la même adresse, le patient A a deux RDV
const P = { lon: 5.3600, lat: 43.2800 };
const lignes = [
  { cle: '0|A', ...P, fenetre: [28800, 61200] },
  { cle: '0|B', ...P, fenetre: [28800, 61200] },
  { cle: '0|A', lon: 5.3605, lat: 43.2802, fenetre: [28800, 43200] }
];
const jobs = lignes.map((l, j) => ({ id: j + 1, description: 'J' + (j + 1), location: [l.lon, l.lat], setup: 300, service: 600 + j * 60, time_windows: [l.fenetre] }));

test('les RDV d’un même patient chez le même AMD, à la même adresse, sont regroupés', () => {
  const g = G.grouper(lignes);
  assert.deepEqual(g.map((x) => x.membres), [[0, 2], [1]]);
  assert.deepEqual(g[0].fenetre, [28800, 43200]);
});

test('pas de regroupement : autre AMD, adresse éloignée, créneaux disjoints ou patient inconnu', () => {
  const base = { cle: '0|A', ...P, fenetre: [28800, 43200] };
  assert.equal(G.grouper([base, { ...base, cle: '1|A' }]).length, 2);
  assert.equal(G.grouper([base, { ...base, lat: P.lat + 0.01 }]).length, 2);
  assert.equal(G.grouper([base, { ...base, fenetre: [46800, 61200] }]).length, 2);
  assert.equal(G.grouper([{ ...base, cle: '' }, { ...base, cle: '' }]).length, 2);
});

test('le job fusionné additionne les durées et garde un seul stationnement', () => {
  const g = G.grouper(lignes);
  const f = G.fusionnerJobs(jobs, g);
  assert.equal(f.length, 2);
  assert.equal(f[0].id, 1);
  assert.equal(f[0].service, 600 + 720);
  assert.equal(f[0].setup, 300);
  assert.deepEqual(f[0].time_windows, [[28800, 43200]]);
});

test('la réponse VROOM est éclatée : les RDV du patient se suivent', () => {
  const g = G.grouper(lignes);
  const res = {
    routes: [{ vehicle: 1, steps: [
      { type: 'start', arrival: 28000 },
      { type: 'job', id: 2, job: 2, arrival: 29000, setup: 300, service: 660, waiting_time: 0, duration: 1000, distance: 5000 },
      { type: 'job', id: 1, job: 1, arrival: 30000, setup: 300, service: 1320, waiting_time: 100, duration: 1000, distance: 5000 },
      { type: 'end', arrival: 33000 }
    ] }],
    unassigned: []
  };
  const out = G.eclaterReponse(res, jobs, g);
  const st = out.routes[0].steps.filter((s) => s.type === 'job');
  assert.deepEqual(st.map((s) => s.job), [2, 1, 3]);
  assert.deepEqual([st[1].arrival, st[1].setup, st[1].service], [30000, 300, 600]);
  assert.deepEqual([st[2].arrival, st[2].setup, st[2].service, st[2].waiting_time], [30000 + 100 + 300 + 600, 0, 720, 0]);
});

test('un job fusionné non affecté rend tous ses RDV non affectés', () => {
  const g = G.grouper(lignes);
  const out = G.eclaterReponse({ routes: [], unassigned: [{ id: 1, type: 'job' }] }, jobs, g);
  assert.deepEqual(out.unassigned.map((u) => u.id), [1, 3]);
});

test('RDV sans créneau (horaires levés) : regroupés, job fusionné sans time_windows', () => {
  const sans = [{ cle: '0|A', lon: 5.5, lat: 43.3 }, { cle: '0|A', lon: 5.5, lat: 43.3 }];
  const g = G.grouper(sans);
  assert.equal(g.length, 1);
  const f = G.fusionnerJobs([{ id: 1, service: 60 }, { id: 2, service: 120 }], g);
  assert.equal(f.length, 1);
  assert.equal(f[0].service, 180);
  assert.equal('time_windows' in f[0], false);
});
