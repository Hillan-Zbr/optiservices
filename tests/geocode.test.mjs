/* Tests du géocodage en cascade (sans DOM ni réseau) — lancer : node --test tests/geocode.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../web/js/geo/geocode-core.js');

test('nettoie : compléments retirés, abréviations développées', () => {
  assert.equal(G.nettoie('7 AVE DES LILAS residence Le Parc Fleuri APPART B2'), '7 AVENUE DES LILAS');
  assert.equal(G.nettoie('15 RUE DES CERISIERS LE VALLON BAT C etage 3 appart 41'), '15 RUE DES CERISIERS LE VALLON');
  assert.equal(G.nettoie('Maison de repos Les Oliviers BP 12'), 'MAISON DE REPOS LES OLIVIERS');
  assert.equal(G.nettoie('RESIDENCE LES TILLEULS 4 BIS CHE DU MOULIN'), '4 BIS CHEMIN DU MOULIN');
  assert.equal(G.nettoie('300 ROU DE ST JEAN'), '300 ROUTE DE SAINT JEAN');
  assert.equal(G.nettoie('LD LES GRANGES'), 'LES GRANGES');
  assert.equal(G.nettoie('APPT 12'), '');
  assert.equal(G.nettoie('CHE des Aubépines Centre de Soins Les Aubépines 3ieme etage'), 'CHEMIN DES AUBEPINES');
  assert.equal(G.nettoie('2 RUE DU CENTRE'), '2 RUE DU CENTRE');
  assert.equal(G.nettoie('AVENUE DE LA CLINIQUE CLINIQUE DES PINS'), 'AVENUE DE LA CLINIQUE');
});

test('raccourcies : retire les derniers mots, garde au moins un mot de la voie', () => {
  assert.deepEqual(G.raccourcies('450 ROUTE DES CHENES LA FERME BLANCHE'), ['450 ROUTE DES CHENES LA FERME', '450 ROUTE DES CHENES']);
  assert.deepEqual(G.raccourcies('3 RUE DE LA REPUBLIQUE'), []);
  assert.deepEqual(G.raccourcies('MAISON DE REPOS LES OLIVIERS'), []); // pas de voie : on ne coupe pas
});

test('villeOk : même commune malgré un nom abrégé ou complété', () => {
  assert.ok(G.villeOk({ city: "Plan-d'Aups-Sainte-Baume" }, { ville: "PLAN D'AUPS" }));
  assert.ok(G.villeOk({ city: 'Saint-Rémy-de-Provence' }, { ville: 'ST REMY DE PROVENCE' }));
  assert.ok(G.villeOk({ city: 'Marseille' }, { ville: 'MARSEILLE CEDEX 04' }));
  assert.ok(!G.villeOk({ city: 'Autreville' }, { ville: 'BOURGFICTIF' }));
});

/* fausse BAN : réponses fixées par requête (q|postcode|type) ; enregistre les requêtes faites */
function fausseBan(reponses) {
  const vues = [];
  const chercher = async ({ q, postcode, type }) => { const k = [q, postcode || '', type || ''].join('|'); vues.push(k); return reponses[k] || []; };
  return { chercher, vues };
}
const f = (o) => Object.assign({ lon: 5.4, lat: 43.3, score: 0.8, type: 'street' }, o);

test('une adresse avec complément est trouvée après nettoyage', async () => {
  const ban = fausseBan({ '7 AVENUE DES LILAS MARSEILLE|13010|': [f({ label: 'Avenue des Lilas 13010 Marseille', name: 'Avenue des Lilas', city: 'Marseille', score: 0.82 })] });
  const g = await G.localise({ adresse: '7 AVE DES LILAS residence Le Parc APPART B2', cp: '13010', ville: 'MARSEILLE' }, ban.chercher);
  assert.equal(g.precision, 'rue');
  assert.equal(g.etape, 'adresse nettoyée');
  assert.equal(ban.vues.length, 2); // brute puis nettoyée, puis arrêt (score suffisant)
});

test('un lieu-dit collé à la voie est retiré mot à mot', async () => {
  const ban = fausseBan({
    '450 ROUTE DES CHENES LA FERME BLANCHE VILLEFICTIVE|83999|': [f({ name: 'Allée des Pins', city: 'Villefictive', score: 0.5 })],
    '450 ROUTE DES CHENES VILLEFICTIVE|83999|': [f({ type: 'housenumber', name: '450 Route des Chênes', city: 'Villefictive', score: 0.9 })]
  });
  const g = await G.localise({ adresse: '450 RTE DES CHENES LA FERME BLANCHE', cp: '83999', ville: 'VILLEFICTIVE' }, ban.chercher);
  assert.equal(g.precision, 'adresse');
  assert.equal(g.etape, 'adresse raccourcie');
});

test('une rue au hasard de la commune est rejetée : repli sur la commune', async () => {
  const ban = fausseBan({
    'MAISON DE REPOS LES OLIVIERS BOURGFICTIF|04999|': [f({ name: 'Route de la Gare', city: 'Bourgfictif', score: 0.5 })],
    'BOURGFICTIF|04999|municipality': [f({ type: 'municipality', label: 'Bourgfictif', name: 'Bourgfictif', city: 'Bourgfictif', score: 0.93 })]
  });
  const g = await G.localise({ adresse: 'Maison de repos Les Oliviers BP 12', cp: '04999', ville: 'BOURGFICTIF' }, ban.chercher);
  assert.equal(g.precision, 'commune');
  assert.equal(g.label, 'Bourgfictif');
});

test('autre commune au même code postal, score trop faible ou hors zone : rejetés', async () => {
  const rd = { adresse: '3 RUE DU FOUR', cp: '04999', ville: 'BOURGFICTIF' };
  const ban = fausseBan({
    '3 RUE DU FOUR BOURGFICTIF|04999|': [f({ name: 'Rue du Four', city: 'Autreville' }), f({ name: 'Rue du Four', city: 'Bourgfictif', score: 0.3 })]
  });
  assert.equal(await G.localise(rd, ban.chercher), null);
  const loin = fausseBan({ '3 RUE DU FOUR BOURGFICTIF|04999|': [f({ name: 'Rue du Four', city: 'Bourgfictif', lat: 48.8 })] });
  const g = await G.localise(rd, loin.chercher, { dansZone: (x) => x.lat < 45 });
  assert.ok(g.none && g.horsZone);
});

test('code postal erroné : nouvelle recherche sans code postal, commune vérifiée', async () => {
  const ban = fausseBan({ '9 RUE DES ECOLES VILLEFICTIVE||': [f({ type: 'housenumber', name: '9 Rue des Écoles', city: 'Villefictive', postcode: '83998' })] });
  const g = await G.localise({ adresse: '9 R DES ECOLES', cp: '83999', ville: 'VILLEFICTIVE' }, ban.chercher);
  assert.equal(g.precision, 'adresse');
  assert.equal(g.etape, 'sans code postal');
});
