/* Tests des statistiques d'optimisation (sans DOM) — lancer : node --test tests/stats.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../web/js/stats/stats-core.js');

const typesOf = (rd) => rd.types;
const motifNonAffecte = () => 'créneau trop serré';
// jeu fictif : 4 RDV calculés, 1 écarté, 2 AMD dont un sans tournée
const R = {
  date: '2026-10-15',
  amds: [{ nom: 'AMD TEST A', code: 'A1', depot: 'aub' }, { nom: 'AMD TEST B', depot: 'sis' }],
  rdv: [
    { idRdv: '1', types: ['LIN'] },
    { idRdv: '2', types: ['LIN', 'O2L'] },
    { idRdv: '3', types: ['M'] },
    { idRdv: '4', types: ['O2L'] }
  ],
  excluded: [{ idRdv: '5', types: ['LIN'], motif: 'adresse introuvable' }],
  res: {
    routes: [{ vehicle: 1, distance: 42000, duration: 3600, steps: [{ type: 'start' }, { type: 'job', job: 1 }, { type: 'job', job: 2 }, { type: 'job', job: 3 }, { type: 'end' }] }],
    unassigned: [{ id: 4 }]
  }
};

test('totaux de la journée et répartition par type de visite', () => {
  const s = S.computeStats(R, { typesOf, motifNonAffecte });
  assert.equal(s.nRdv, 5);
  assert.equal(s.nAmd, 2);
  assert.equal(s.nAmdMobilises, 1);
  assert.equal(s.planifies, 3);
  assert.equal(s.distance, 42000);
  // RDV 2 à deux types : compté en LIN et en O2L
  assert.deepEqual(s.parType, [{ code: 'LIN', n: 3 }, { code: 'O2L', n: 2 }, { code: 'M', n: 1 }]);
});

test('détail par AMD : RDV, types et kilométrage', () => {
  const s = S.computeStats(R, { typesOf, motifNonAffecte });
  assert.equal(s.amd[0].n, 3);
  assert.equal(s.amd[0].distance, 42000);
  assert.deepEqual(s.amd[0].parType.map((x) => x.code), ['LIN', 'M', 'O2L']);
  assert.equal(s.amd[1].n, 0);
  assert.equal(s.amd[1].distance, 0);
});

test('non planifiés regroupés par motif avec leur détail', () => {
  const s = S.computeStats(R, { typesOf, motifNonAffecte });
  assert.equal(s.nonPlanifies.total, 2);
  assert.deepEqual(s.nonPlanifies.parMotif.map((m) => [m.motif, m.n]), [['adresse introuvable', 1], ['créneau trop serré', 1]]);
  assert.equal(s.nonPlanifies.parMotif[1].liste[0].rd.idRdv, '4');
  assert.equal(s.nonPlanifies.parMotif[1].liste[0].etape, 'non affecté');
});

test('résultat sans tournée ni écarté', () => {
  const s = S.computeStats({ date: '2026-10-15', amds: [], rdv: [], res: { routes: [], unassigned: [] } }, { typesOf, motifNonAffecte });
  assert.equal(s.nRdv, 0);
  assert.equal(s.nonPlanifies.total, 0);
  assert.deepEqual(s.parType, []);
});
