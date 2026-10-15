/* Tests des échanges avec MJ2 (sans DOM) — lancer : node --test tests/mj2.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../web/js/mj2/mj2-core.js');

// jeu fictif : un AMD avec 2 RDV, un second AMD sans tournée
const R = {
  date: '2026-10-16',
  amds: [{ nom: 'AMD TEST A', code: 'A1', depot: 'aub' }, { nom: 'AMD TEST B', code: 'B2', depot: 'sis' }],
  rdv: [
    { idRdv: '101', patient: 'PATIENT Un', patientCode: 'P1', adresse: '1 rue Fictive', cp: '13400', ville: 'Aubagne', geo: { lat: 43.2927123, lon: 5.5708456 },
      types: ['LIN'], typeVisite: 'Livraison', typePrestation: 'Nutrition', besoin: 'Planifié', acces: { tel1: '0400000000' } },
    { idRdv: '102', patient: 'PATIENT Deux', patientCode: 'P2', cp: '13400', ville: 'Aubagne', geo: { lat: 43.3, lon: 5.58 }, types: ['LIN', 'M'], besoin: 'Manuel' }
  ],
  force: [{ service: 80 }],
  res: {
    routes: [{ vehicle: 1, distance: 42150, duration: 3720, steps: [
      { type: 'start', arrival: 28800 },
      { type: 'job', job: 2, arrival: 30600, waiting_time: 0 },
      { type: 'break', arrival: 43200, service: 3600 },
      { type: 'job', job: 1, arrival: 50400, waiting_time: 600 },
      { type: 'end', arrival: 57600 }
    ] }],
    unassigned: []
  }
};
const opts = {
  version: 3, publieeLe: '2026-10-15T17:42:00+02:00', commentaire: ' essai ',
  antenne: (a) => ({ code: a.depot, nom: 'Antenne ' + a.depot }),
  fenetre: (rd) => (rd.idRdv === '101' ? [28800, 43200] : [28800, 61200]),
  creneauNom: () => 'Matin',
  duree: (rd) => (rd.idRdv === '101' ? 5 : 12),
  typesOf: (rd) => rd.types,
  typeLibelle: (c) => ({ LIN: 'Livraison nutrition', M: 'Maintenance' }[c] || c),
  forceLibelle: (rg) => (rg ? `temps sur place ${rg.service} %` : '')
};

test("tournée d'un AMD : en-tête, pause et totaux", () => {
  const t = M.tournee(R, 0, opts);
  assert.equal(t.version_contrat, '1.0');
  assert.equal(t.date, '2026-10-16');
  assert.equal(t.version, 3);
  assert.equal(t.modifiee_jour_meme, false);
  assert.equal(t.commentaire, 'essai');
  assert.deepEqual(t.amd, { code: 'A1', nom: 'AMD TEST A' });
  assert.deepEqual(t.antenne, { code: 'aub', nom: 'Antenne aub' });
  assert.equal(t.depart.heure, '08:00');
  assert.equal(t.retour.heure, '16:00');
  assert.deepEqual(t.pause, { heure: '12:00', duree_min: 60 });
  assert.equal(t.distance_km, 42.2);
  assert.equal(t.conduite_min, 62);
  assert.equal(t.placement_force, 'temps sur place 80 %');
  assert.deepEqual(M.controleTournee(t), []);
});

test("étapes dans l'ordre de passage, avec champ commentaire", () => {
  const t = M.tournee(R, 0, opts);
  assert.deepEqual(t.etapes.map((e) => [e.ordre, e.id_rdv, e.heure_estimee]), [[1, '102', '08:30'], [2, '101', '14:00']]);
  const e = t.etapes[1];
  assert.equal(e.commentaire, '');
  assert.equal(e.attente_min, 10);
  assert.equal(e.duree_sur_place_min, 5);
  assert.deepEqual(e.creneau, { nom: 'Matin', debut: '08:00', fin: '12:00' });
  assert.equal(e.hors_creneau, true);
  assert.deepEqual(e.patient, { nom: 'PATIENT Un', code: 'P1' });
  assert.deepEqual(e.adresse, { ligne: '1 rue Fictive', code_postal: '13400', ville: 'Aubagne', lat: 43.292712, lon: 5.570846 });
  assert.deepEqual(e.types_visite, [{ code: 'LIN', libelle: 'Livraison nutrition' }]);
  assert.equal(e.acces.tel1, '0400000000');
  assert.equal(e.acces.porte, '');
  assert.equal(t.etapes[0].hors_creneau, false);
  assert.equal(t.etapes[0].types_visite.length, 2);
});

test('AMD sans tournée : liste vide (retrait de la tournée chez MJ2)', () => {
  const t = M.tournee(R, 1, opts);
  assert.deepEqual(t.etapes, []);
  assert.equal(t.pause, null);
  assert.equal(t.distance_km, 0);
  assert.deepEqual(M.controleTournee(t), []);
});

test('contrôle de tournée : code AMD et n° de RDV obligatoires', () => {
  const t = M.tournee(Object.assign({}, R, { amds: [{ nom: 'SANS CODE' }] }), 0, opts);
  t.etapes[0].id_rdv = '';
  const e = M.controleTournee(t);
  assert.ok(e.some((x) => x.includes("code de l'AMD")));
  assert.ok(e.some((x) => x.includes('étape 1')));
});

test('message : valeurs par défaut et commentaire', () => {
  const m = M.message({ type: 'flash', valideDu: '2026-10-16', texte: '  Route coupée à Riez  ', commentaire: 'interne' });
  assert.match(m.id, /^[0-9a-f-]{36}$/);
  assert.equal(m.valide_au, '2026-10-16');
  assert.equal(m.priorite, 'normale');
  assert.deepEqual(m.cible, { type: 'tous', codes: [] });
  assert.equal(m.texte, 'Route coupée à Riez');
  assert.equal(m.commentaire, 'interne');
  assert.equal(m.auteur, 'Responsable');
  assert.match(m.cree_le, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.deepEqual(M.controleMessage(m), []);
});

test("message : l'identifiant fourni est conservé (renvoi sans doublon)", () => {
  const m = M.message({ id: 'abc', type: 'debut_tournee', cible: { type: 'antenne', codes: ['aub', ' '] }, valideDu: '2026-10-16', valideAu: '2026-10-20', texte: 'Rappel' });
  assert.equal(m.id, 'abc');
  assert.deepEqual(m.cible.codes, ['aub']);
});

test('contrôle de message : type, cible, dates, texte', () => {
  const m = M.message({ type: 'autre', cible: { type: 'amd', codes: [] }, valideDu: '2026-10-20', valideAu: '2026-10-16', priorite: 'urgente', texte: '' });
  const e = M.controleMessage(m);
  assert.ok(e.some((x) => x.includes('type')));
  assert.ok(e.some((x) => x.includes('cible sans')));
  assert.ok(e.some((x) => x.includes('précède')));
  assert.ok(e.some((x) => x.includes('priorité')));
  assert.ok(e.some((x) => x.includes('texte vide')));
  const long = M.message({ type: 'flash', valideDu: '2026-10-16', texte: 'x'.repeat(2001), titre: 'y'.repeat(81) });
  assert.equal(M.controleMessage(long).length, 2);
});

test("chemins de l'API relayés par nginx", () => {
  assert.equal(M.chemins.tournee('2026-10-16', 'A 1'), '/mj2/api/v1/tournees/2026-10-16/A%201');
  assert.equal(M.chemins.message('abc'), '/mj2/api/v1/messages/abc');
  assert.equal(M.chemins.accuses('2026-10-16T07:00:00+02:00'), '/mj2/api/v1/accuses?depuis=2026-10-16T07%3A00%3A00%2B02%3A00');
});
