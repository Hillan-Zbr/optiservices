/* Tests de l'import CSV des AMD (sans DOM) — lancer : node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAmdImport, findDepot, parseDispo } from '../web/js/amd/amd-csv.js';

const params = {
  hmax: 5, kmmax: 250,
  depots: [
    { id: 'aub', nom: 'Siège · Aubagne (13)', isadom: 'ARARD 13', actif: true },
    { id: 'sis', nom: 'Antenne · Sisteron (04/05)', isadom: 'ARARD 04/05', actif: true },
    { id: 'stj', nom: 'Antenne · Saint-Jeannet (06)', isadom: 'ARARD 06', actif: false }
  ]
};
const base = () => [
  { nom: 'GALLIANO Jean-Marc', depot: 'aub', dispo: 'journee', hmax: 5, kmmax: 250, o2: false },
  { nom: 'IDOUDI Ayadi', code: 'IDOAY', depot: 'sis', dispo: 'matin', hmax: 4, kmmax: 200, o2: false }
];

test('crée un AMD avec les valeurs par défaut des paramètres', () => {
  const r = planAmdImport('code;nom;depart\nNEWAM;DUPONT Paul;ARARD 04/05\n', base(), params);
  assert.equal(r.created.length, 1);
  assert.deepEqual(r.amd[2], { nom: 'DUPONT Paul', depot: 'sis', dispo: 'journee', hmax: 5, kmmax: 250, o2: false, code: 'NEWAM' });
});

test('retrouve un AMD par code, puis par nom sans accents ni casse ; ne touche pas aux colonnes absentes', () => {
  const r = planAmdImport('code;nom;o2\nIDOAY;IDOUDI Ayadi;oui\n;galliano jean-marc;oui\n', base(), params);
  assert.equal(r.created.length, 0);
  assert.equal(r.updated.length, 2);
  assert.equal(r.amd[1].o2, true); assert.equal(r.amd[1].hmax, 4); assert.equal(r.amd[1].dispo, 'matin');
  assert.equal(r.amd[0].o2, true);
});

test('un AMD sans code peut recevoir son code Isadom via le nom', () => {
  const r = planAmdImport('code;nom\nGALJM;GALLIANO Jean-Marc\n', base(), params);
  assert.equal(r.amd[0].code, 'GALJM'); assert.equal(r.amd.length, 2);
});

test('les AMD absents du fichier sont conservés', () => {
  const r = planAmdImport('nom;depart\nDUPONT Paul;ARARD 13\n', base(), params);
  assert.equal(r.amd.length, 3);
});

test('lignes en erreur ignorées sans bloquer les autres', () => {
  const csv = 'code;nom;depart;disponible;heures_max;km_max;o2\n'
    + 'A1;OK Un;ARARD 13;matin;4,5;180;oui\n'
    + 'A2;Depart inconnu;MARS;journee;5;250;non\n'
    + 'A3;Dispo KO;ARARD 13;jamais;5;250;non\n'
    + 'A4;Heures KO;ARARD 13;journee;abc;250;non\n'
    + 'A5;O2 KO;ARARD 13;journee;5;250;peutetre\n'
    + ';;ARARD 13;journee;5;250;non\n';
  const r = planAmdImport(csv, [], params);
  assert.equal(r.created.length, 1);
  assert.equal(r.errors.length, 5);
  assert.deepEqual(r.amd[0], { nom: 'OK Un', depot: 'aub', dispo: 'matin', hmax: 4.5, kmmax: 180, o2: true, code: 'A1' });
});

test('départ vide : premier point de départ actif, avec avertissement', () => {
  const r = planAmdImport('nom\nSANS DEPART\n', [], params);
  assert.equal(r.amd[0].depot, 'aub'); assert.equal(r.warnings.length, 1);
});

test('doublon dans le fichier : la dernière ligne l\'emporte, avec avertissement', () => {
  const r = planAmdImport('code;nom;depart;hmax\nD1;DOUBLE;ARARD 13;3\nD1;DOUBLE;ARARD 13;6\n', [], params);
  assert.equal(r.amd.length, 1); assert.equal(r.amd[0].hmax, 6); assert.equal(r.warnings.length, 1);
});

test('BOM, séparateur virgule, CRLF, guillemets et en-têtes en alias', () => {
  const r = planAmdImport('\uFEFFcode_isadom,amdnom,antenne,dispo\r\nX1,"DURAND, Luc",ARARD 13,apres-midi\r\n', [], params);
  assert.equal(r.amd[0].nom, 'DURAND, Luc'); assert.equal(r.amd[0].dispo, 'am'); assert.equal(r.amd[0].depot, 'aub');
});

test('fichier vide ou sans colonne code/nom : erreur fatale, liste inchangée', () => {
  const b = base();
  assert.ok(planAmdImport('', b, params).fatal);
  const r = planAmdImport('depart;o2\nARARD 13;oui\n', b, params);
  assert.ok(r.fatal); assert.equal(r.amd, b);
});

test('l\'entrée n\'est pas modifiée', () => {
  const b = base(); planAmdImport('code;nom;o2\nIDOAY;IDOUDI Ayadi;oui\n', b, params);
  assert.equal(b[1].o2, false);
});

test('findDepot et parseDispo', () => {
  assert.equal(findDepot('aub', params.depots).id, 'aub');
  assert.equal(findDepot('sisteron', params.depots).id, 'sis');
  assert.equal(findDepot('ARARD', params.depots), null);
  assert.equal(parseDispo('Après-midi'), 'am'); assert.equal(parseDispo(''), 'journee'); assert.equal(parseDispo('x'), null);
});

test('export Isadom réel : NULL = vide, NOM + Prénom, aucune donnée de contact conservée', () => {
  const csv = 'IdAmd;AmdCode;Civilite;AmdNom;AmdPrenom;IdAntenne;AntenneCode;Antenne;Mail;TelGsm\n'
    + '105204;1086;M;GHILAS;Kylian;NULL;NULL;NULL;kghilas@arard.fr;0749374455\n'
    + '105205;1087;M;GALLIANO;Jean-Marc;12;A13;ARARD 13;jmg@arard.fr;0600000000\n';
  const r = planAmdImport(csv, base(), params);
  assert.equal(r.errors.length, 0);
  const g = r.amd.find((a) => a.code === '1086');
  assert.equal(g.nom, 'GHILAS Kylian'); assert.equal(g.depot, 'aub');
  assert.equal(r.warnings.length, 1);   // un seul avertissement agrégé : antenne absente
  // l'AMD existant « GALLIANO Jean-Marc » est retrouvé par son nom et reçoit son code ; pas de doublon
  assert.equal(r.amd.filter((a) => a.nom === 'GALLIANO Jean-Marc').length, 1);
  assert.equal(r.amd.find((a) => a.nom === 'GALLIANO Jean-Marc').code, '1087');
  assert.ok(!JSON.stringify(r.amd).match(/arard\.fr|0749374455|0600000000/));
});

test('AntenneCode utilisé si la colonne Antenne est vide', () => {
  const r = planAmdImport('AmdCode;AmdNom;AmdPrenom;AntenneCode;Antenne\n9;DURAND;Luc;ARARD 04/05;NULL\n', [], params);
  assert.equal(r.amd[0].depot, 'sis');
});
