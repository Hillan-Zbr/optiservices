/* Tests de la vue Agenda (sans DOM) — lancer : node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgendaDay, pairColumns, summarize, secToMin, dureeMin } from '../web/js/agenda/agenda-model.js';
import { probableReason, fetchTrajetsAntennes, MOTIFS } from '../web/js/agenda/agenda-reasons.js';

const reelle = JSON.parse(readFileSync(new URL('./fixtures/vroom-reponse-reelle.json', import.meta.url)));

const ho = (deb, fin) => ({ debutMin: deb * 60, finMin: fin * 60 });
const ctx = {
  vehicles: [
    { id: 1, name: 'AMD 1', antenne: 'aub', antenneNom: 'Aubagne', heuresOuvrees: ho(8, 17.5) },
    { id: 2, name: 'AMD 2', antenne: 'sis', antenneNom: 'Sisteron', heuresOuvrees: ho(8, 17.5) },
    { id: 3, name: 'AMD 3', antenne: 'sis', antenneNom: 'Sisteron', heuresOuvrees: ho(8, 12) }
  ],
  jobsById: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [String(i), {
    patient: 'P' + i, ville: 'V' + i, intervention: i === 4 ? 'Installation oxygène' : 'Livraison', o2: i === 4,
    creneau: i === 3 || i === 5 ? { debutMin: 810, finMin: 1050, label: 'am' } : { debutMin: 480, finMin: 720, label: 'matin' }
  }])),
  params: {}
};

test('réponse réelle : chaque job apparaît une fois comme RDV, aux bonnes heures', () => {
  const day = buildAgendaDay(reelle, ctx);
  const rdv = day.colonnes.flatMap((c) => c.segments.filter((s) => s.kind === 'rdv'));
  const jobs = reelle.routes.flatMap((r) => r.steps.filter((s) => s.type === 'job'));
  assert.equal(rdv.length, jobs.length);
  assert.equal(new Set(rdv.map((s) => s.jobId)).size, jobs.length);
  for (const st of jobs) {
    const s = rdv.find((x) => x.jobId === String(st.job));
    const debut = st.arrival + st.waiting_time + st.setup;
    assert.equal(s.startMin, secToMin(debut));
    assert.equal(s.endMin, secToMin(debut + st.service));
    assert.equal(s.arriveeMin, secToMin(st.arrival));
  }
});

test('réponse réelle : somme des segments = durée totale de la route (± 1 min)', () => {
  const day = buildAgendaDay(reelle, ctx);
  for (const r of reelle.routes) {
    const col = day.colonnes.find((c) => c.id === String(r.vehicle));
    const somme = col.segments.reduce((a, s) => a + dureeMin(s), 0);
    // VROOM : route.duration = conduite seule ; durée totale = conduite + stationnement + service + attente
    const total = (r.duration + r.setup + r.service + r.waiting_time) / 60;
    assert.ok(Math.abs(somme - total) <= 1, `véhicule ${r.vehicle} : ${somme} vs ${total}`);
    assert.equal(somme, col.endMin - col.startMin);
    // trajets + retour = conduite VROOM
    assert.ok(Math.abs(col.trajetTotalMin - r.duration / 60) <= 1);
  }
});

test('réponse réelle : AMD sans route -> colonne vide, non affectés = unassigned', () => {
  const day = buildAgendaDay(reelle, ctx);
  const c3 = day.colonnes.find((c) => c.id === '3');
  assert.equal(c3.vide, true); assert.equal(c3.segments.length, 0); assert.equal(c3.retourMin, null);
  assert.equal(day.nonAffectes.length, reelle.unassigned.length);
  assert.equal(day.nonAffectes[0].jobId, '7');
  assert.equal(day.sansSolution, false);
});

/* route synthétique : trajet -> attente -> stationnement -> RDV, pause, retour tardif */
const synth = {
  code: 0, unassigned: [],
  routes: [{
    vehicle: 1, duration: 3600, setup: 1200, service: 4500, waiting_time: 1800,
    steps: [
      { type: 'start', arrival: 28800, duration: 0, setup: 0, service: 0, waiting_time: 0 },
      { type: 'job', job: 1, arrival: 30000, duration: 1200, setup: 600, service: 1800, waiting_time: 1800 },  // 8h20, attente 30 min
      { type: 'break', arrival: 34800, duration: 1800, setup: 0, service: 1800, waiting_time: 0 },             // trajet 10 min puis pause 9h40
      { type: 'job', job: 2, arrival: 37200, duration: 2400, setup: 600, service: 2700, waiting_time: 0 },     // 10h20 = fin du créneau
      { type: 'end', arrival: 42300, duration: 4200, setup: 0, service: 0, waiting_time: 0 }                   // retour 30 min, 11h45
    ]
  }]
};
const ctxSynth = {
  vehicles: [{ id: 1, name: 'AMD', antenne: 'aub', antenneNom: 'Aubagne', heuresOuvrees: ho(8, 10.5) }],
  jobsById: {
    1: { patient: 'A', creneau: { debutMin: 540, finMin: 720, label: 'x' } },
    2: { patient: 'B', creneau: { debutMin: 480, finMin: 620, label: 'y' } }
  }
};

test('ordre des segments et alertes', () => {
  const day = buildAgendaDay(synth, ctxSynth);
  const col = day.colonnes[0];
  assert.deepEqual(col.segments.map((s) => s.kind), ['trajet', 'attente', 'setup', 'rdv', 'trajet', 'pause', 'trajet', 'setup', 'rdv', 'retour']);
  const [r1, r2] = col.segments.filter((s) => s.kind === 'rdv');
  assert.equal(r1.startMin, 540); assert.equal(r1.trajetPrecedentMin, 20); assert.equal(r1.warn, false);
  assert.equal(r2.warn, true); // début 10h20, fin de créneau 10h20 : marge < 15 min
  assert.equal(col.depasseHeuresOuvrees, true); // retour 11h45 > 10h30
  assert.equal(col.retourMin, 705);
  assert.equal(col.trajetTotalMin, 20 + 10 + 10 + 30);
});

test('trajet placé avant une pause de fin de journée = retour', () => {
  const r = { code: 0, unassigned: [], routes: [{ vehicle: 1, duration: 2400, setup: 0, service: 1800, waiting_time: 0, steps: [
    { type: 'start', arrival: 36000, setup: 0, service: 0, waiting_time: 0 },
    { type: 'job', job: 1, arrival: 37200, setup: 0, service: 1800, waiting_time: 0 },
    { type: 'break', arrival: 40200, setup: 0, service: 3600, waiting_time: 0 },
    { type: 'end', arrival: 43800, setup: 0, service: 0, waiting_time: 0 }
  ] }] };
  const col = buildAgendaDay(r, ctxSynth).colonnes[0];
  assert.deepEqual(col.segments.map((s) => s.kind), ['trajet', 'rdv', 'retour', 'pause']);
  assert.equal(col.depasseHeuresOuvrees, true);
  assert.equal(col.trajetTotalMin, 40);
});

test('bornes : heures ouvrées ± 1 h, étendues aux segments qui dépassent', () => {
  const day = buildAgendaDay(reelle, ctx);
  assert.deepEqual(day.bornes, { debutMin: 420, finMin: 1140 });
  const tard = buildAgendaDay(synth, { vehicles: [{ ...ctxSynth.vehicles[0], heuresOuvrees: ho(8, 9) }], jobsById: ctxSynth.jobsById });
  assert.equal(tard.bornes.finMin, 12 * 60); // retour 11h45 -> axe jusqu'à 12h
});

test('aucune solution VROOM', () => {
  const day = buildAgendaDay({ code: 0, routes: [], unassigned: [{ id: 1, type: 'job' }] }, ctx);
  assert.equal(day.sansSolution, true);
  assert.equal(day.nonAffectes.length, 1);
  assert.ok(day.colonnes.every((c) => c.vide));
});

test('comparaison : appariement par véhicule et totaux', () => {
  const opt = buildAgendaDay(reelle, ctx);
  const act = buildAgendaDay({ routes: [reelle.routes[0]], unassigned: [] }, ctx);
  const pairs = pairColumns(opt, act);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].act.id, '1'); assert.equal(pairs[1].act.vide, true);
  assert.equal(pairColumns(opt, null)[0].act, null);
  const s = summarize(opt.colonnes);
  assert.equal(s.nbRdv, 6);
  assert.equal(s.trajetsMin, opt.colonnes.reduce((a, c) => a + c.trajetTotalMin, 0));
});

/* ---------- motifs probables ---------- */
const vehs = [
  { id: 1, o2: false, fenetre: { debutMin: 480, finMin: 1050 }, maxDistance: 250000, maxTravelTime: 18000, speedFactor: 0.87 },
  { id: 2, o2: false, fenetre: { debutMin: 480, finMin: 720 }, maxDistance: 250000, maxTravelTime: 18000, speedFactor: 0.87 }
];
const matin = { debutMin: 480, finMin: 720 };

test('motifs : adresse, O2, créneau, limites, saturation', () => {
  assert.equal(probableReason({ jobId: 1, localise: false, o2: false, creneau: matin }, { vehicles: vehs }), MOTIFS.adresse);
  assert.equal(probableReason({ jobId: 1, localise: true, o2: true, creneau: matin }, { vehicles: vehs }), MOTIFS.o2);
  assert.equal(probableReason({ jobId: 1, localise: true, o2: false, creneau: { debutMin: 1080, finMin: 1200 } }, { vehicles: vehs }), MOTIFS.creneau);
  const loin = { aller: () => ({ distance: 140000, duration: 5000 }), retour: () => ({ distance: 140000, duration: 5000 }) };
  assert.equal(probableReason({ jobId: 1, localise: true, o2: false, creneau: matin }, { vehicles: vehs, ...loin }), MOTIFS.limites);
  const long = { aller: () => ({ distance: 1000, duration: 8000 }), retour: () => ({ distance: 1000, duration: 8000 }) }; // 16000 / 0,87 > 18000
  assert.equal(probableReason({ jobId: 1, localise: true, o2: false, creneau: matin }, { vehicles: vehs, ...long }), MOTIFS.limites);
  const proche = { aller: () => ({ distance: 10000, duration: 900 }), retour: () => ({ distance: 10000, duration: 900 }) };
  assert.equal(probableReason({ jobId: 1, localise: true, o2: false, creneau: matin }, { vehicles: vehs, ...proche }), MOTIFS.sature);
  const horsReseau = { aller: () => null, retour: () => null };
  assert.equal(probableReason({ jobId: 1, localise: true, o2: true, creneau: matin }, { vehicles: vehs, ...horsReseau }), MOTIFS.adresse);
});

test('matrice OSRM : requête sans donnée patient et lecture des cellules', async () => {
  let url = '';
  const fakeFetch = async (u) => { url = u; return { json: async () => ({ code: 'Ok', durations: [[0, 100], [110, 0]], distances: [[0, 1000], [1100, 0]] }) }; };
  const t = await fetchTrajetsAntennes([{ key: 'A1', lonlat: [5.5, 43.3] }], [{ key: 'P7', lonlat: [7.2, 43.9] }], fakeFetch);
  assert.match(url, /^\/osrm\/table\/v1\/driving\/5\.500000,43\.300000;7\.200000,43\.900000\?/);
  assert.deepEqual(t.aller(1, 7), { duration: 100, distance: 1000 });
  assert.deepEqual(t.retour(7, 1), { duration: 110, distance: 1100 });
  assert.equal(t.aller(9, 7), undefined);
});
