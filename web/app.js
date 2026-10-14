/* Opriservices — banc de test des tournées AMD (VROOM + OSRM)
   Application statique : les appels passent par le proxy nginx
   /vroom/ -> VROOM, /osrm/ -> OSRM, /geocode/ -> Géoplateforme IGN (BAN). */
'use strict';

/* ---------- utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm2s = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };
const s2hm = (s) => { s = Math.round(s / 60); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtDur = (s) => { const m = Math.round(s / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const fmtKm = (m) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' km';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clone = (o) => JSON.parse(JSON.stringify(o));
/* journal d'activité (js/journal/journal-core.js) : sans effet s'il n'est pas chargé */
const J = window.OptiJournal || { log() {}, info() {}, warn() {}, crit() {} };
/* référence d'un RDV dans le journal : n° Isadom plutôt que le nom du patient (données de santé) */
// référence d'un RDV dans le journal : n° Isadom, jamais le nom du patient (RGPD)
const rdvRef = (rd) => (rd && rd.idRdv ? 'RDV ' + rd.idRdv : 'RDV saisi à la main' + (rd && rd.cp ? ' (' + rd.cp + ' ' + (rd.ville || '') + ')' : ''));
/* libellé d'un champ de formulaire pour le journal */
const fieldLabel = (el) => ((el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('aria-label') || el.dataset.k || el.id || '').trim();
const COLORS = ['#1d4f91', '#2e8b7a', '#c26a1a', '#7a5bb5', '#b5476a', '#4f7a1f', '#8a6d00', '#0f7c9c', '#a33b3b', '#555f6e'];

const CRENEAUX = [
  { code: 'matin', nom: 'Matin', badge: 'b-matin' },
  { code: 'mi', nom: 'Mi-journée', badge: 'b-mi' },
  { code: 'am', nom: 'Après-midi', badge: 'b-am' },
  { code: 'jour', nom: 'Journée', badge: 'b-jour' }
];
const crenOf = (c) => CRENEAUX.find((x) => x.code === c) || CRENEAUX[0];
/* fenêtre de passage d'un RDV (secondes) : heures réelles Isadom si présentes, sinon créneau paramétré */
function rdvWindow(rd, p = state.params) {
  if (rd.hDeb && rd.hFin && hm2s(rd.hFin) > hm2s(rd.hDeb)) return [hm2s(rd.hDeb), hm2s(rd.hFin)];
  const c = p.creneaux[rd.cren] || p.creneaux.jour;
  return [hm2s(c[0]), hm2s(c[1])];
}
function rdvWindowLabel(rd, p = state.params) {
  const w = rdvWindow(rd, p);
  return crenOf(rd.cren).nom + ' ' + s2hm(w[0]) + '–' + s2hm(w[1]);
}
/* codes d'intervention du RDV (Isadom : plusieurs codes possibles) */
const rdvTypes = (rd) => (rd.types && rd.types.length ? rd.types : [rd.type]);
/* durée sur place : un type -> sa durée ; plusieurs -> somme × coefficient paramétré (défaut 80 %) */
function rdvDuree(rd, p = state.params) {
  const ds = rdvTypes(rd).map((c) => { const t = typeOf(c); return t ? Number(t.duree) || 0 : 0; });
  const sum = ds.reduce((a, b) => a + b, 0);
  return ds.length > 1 ? Math.round(sum * (Number(p.multiCoef) || 100) / 100) : sum;
}
const rdvO2 = (rd) => rdvTypes(rd).some((c) => { const t = typeOf(c); return t && t.o2; });
/* type(s) de visite affiché(s) : « CODE – libellé » (code Isadom sFKTypeVisite + libellé des paramètres) */
const typeLabel = (c) => { const t = typeOf(c); return t && t.nom && t.nom !== c ? c + ' – ' + t.nom : c; };
const rdvTypeNom = (rd) => rdvTypes(rd).map(typeLabel).join(' + ');
/* regroupements des types de visite (14/10/2026) : une couleur par groupe dans l'agenda, les tournées et les stats.
   Code absent de ces listes -> groupe « autre », affiché en gris. */
const GROUPES_TYPE = {
  PNI: ['LP', 'LIN', 'LD'],
  OXY: ['LIVO2L', 'AJT', 'O2G', 'CLC', 'DEP', 'M', 'MEP'],
  DES: ['DES', 'RET']
};
const groupeType = (c) => { const k = String(c ?? '').trim().toUpperCase(); return Object.keys(GROUPES_TYPE).find((g) => GROUPES_TYPE[g].includes(k)) || 'AUTRE'; };
// groupe d'un RDV à plusieurs types : celui du premier type
const rdvGroupe = (rd) => groupeType(rdvTypes(rd)[0]);
const tvBadge = (c) => `<span class="tv tv-${groupeType(c).toLowerCase()}" title="${esc(typeLabel(c) + ' · ' + (groupeType(c) === 'AUTRE' ? 'autre' : groupeType(c)))}">${esc(c)}</span>`;
// pastilles colorées + libellés des types d'un RDV
const rdvTypeHtml = (rd) => rdvTypes(rd).map((c) => { const t = typeOf(c); return tvBadge(c) + (t && t.nom && t.nom !== c ? ' ' + esc(t.nom) : ''); }).join(' + ');
// libellé patient des tournées, de la carte, de l'agenda et des exports : NOM Prénom (code patient Isadom)
/* « Visite | Prestation » : TypeVisite et TypePrestation bruts de l'export Isadom, séparés par « | » */
const rdvVisitePrest = (rd) => (rd.typeVisite || rd.typePrestation ? (rd.typeVisite || '') + '|' + (rd.typePrestation || '') : '');
const patientLib = (rd) => rd.patient + (rd.patientCode ? ' (' + rd.patientCode + ')' : '');
/* informations d'accès Isadom (AnnAdresse) : affichées au RP à la demande, destinées ensuite à MJ2 */
function rdvInfos(rd) {
  const a = rd.acces || {};
  return [['Tél.', a.tel1], ['Tél. 2', a.tel2], ['Bâtiment', a.batiment], ['Étage', a.etage], ['Porte', a.porte], ['Interphone', a.interphone], ['Infos', a.info]]
    .filter(([, v]) => v);
}
const infoTitle = (rd) => rdvInfos(rd).map(([k, v]) => k + ' : ' + v).join('\n');
const DISPOS = [
  { code: 'journee', nom: 'Journée' },
  { code: 'matin', nom: 'Matin seulement' },
  { code: 'am', nom: 'Après-midi seulement' },
  { code: 'absent', nom: 'Absent' }
];

/* ---------- valeurs par défaut ---------- */
const DEFAULT_PARAMS = {
  creneaux: { matin: ['08:00', '12:00'], mi: ['11:00', '14:00'], am: ['13:30', '17:30'], jour: ['08:00', '17:30'] },
  pauseDeb: '12:00', pauseFin: '13:30', pauseDuree: 60, stationnement: 10, multiCoef: 80,
  ampDeb: '08:00', ampFin: '17:30', hmax: 5, kmmax: 250, coef: 15,
  types: [
    { code: 'LIV', nom: 'Livraison simple', duree: 15, o2: false },
    { code: 'O2', nom: 'Installation oxygène', duree: 45, o2: true },
    { code: 'PPC', nom: 'Installation PPC', duree: 40, o2: false },
    { code: 'LIT', nom: 'Installation lit médicalisé', duree: 60, o2: false },
    { code: 'REC', nom: 'Récupération de matériel', duree: 20, o2: false },
    { code: 'CTL', nom: 'Visite de contrôle', duree: 30, o2: false }
  ],
  depots: [
    { id: 'aub', nom: 'Siège · Aubagne (13)', adr: "Parc d'activités de Napollon, 100 avenue des Templiers, 13676 Aubagne", actif: true, isadom: 'ARARD 13' },
    { id: 'sis', nom: 'Antenne · Sisteron (04/05)', adr: 'Parc d’activités de Sisteron Val de Durance, 14 allée des Romarins, 04200 Sisteron', actif: true, isadom: 'ARARD 04/05' },
    { id: 'stj', nom: 'Antenne · Saint-Jeannet (06)', adr: 'ZAC de Saint-Estève, route de la Baronne, 06640 Saint-Jeannet', actif: true, isadom: 'ARARD 06' },
    { id: 'cue', nom: 'Antenne · Cuers (83)', adr: 'ZAC des Bousquets, 593 avenue des Bousquets, 83390 Cuers', actif: true, isadom: 'ARARD 83' },
    { id: 'cau', nom: 'Antenne · Caumont-sur-Durance (84)', adr: 'ZAC des Balarucs, 15 rue Toussaint Fléchaire, 84510 Caumont-sur-Durance', actif: true, isadom: 'ARARD 84' },
    { id: 'bas', nom: 'Antenne · Bastia (20)', adr: 'Zone industrielle Furiani, immeuble Agostini, 20200 Bastia', actif: true, isadom: 'ARARD 2B' },
    { id: 'aja', nom: 'Antenne · Ajaccio (20)', adr: '13 avenue Maréchal Juin, résidence Les Fleurs, 20090 Ajaccio', actif: true, isadom: 'ARARD 2A' }
  ]
};
/* types de visite Isadom (OrdRendezVousTypeVisite.sFKTypeVisite) : durées estimées par le métier (12/10/2026).
   « Aléatoire » -> 20 min. O2 liquide : 14 min par cuve, 1 cuve par défaut. Code absent de cette liste -> 20 min. */
const DUREE_TYPE_DEFAUT = 20;
const ISADOM_TYPES = [
  ['AJT', 'Ajout de matériel', 10], ['CLC', 'Complément de liv. consommables', 10], ['CD', 'Contrôle dossier', 5],
  ['DES', 'Désappareillage', 20], ['ECH', 'Échange de dispositif médical', 10], ['EQ', 'Enquête O2', 5],
  ['LD', 'Livraison diabétologie', 10], ['MAD 1', 'Livraison MAD 1 : ret / petit MAD / objets / inconnu', 10],
  ['MAD 2', 'Livraison MAD 2 : gros MAD (hors lit)', 20], ['MAD 3', 'Livraison MAD 3 : combiné gros + petit MAD', 30],
  ['MAD 4', 'Livraison MAD 4 : livr/ret lit et combiné lit', 40], ['MAD 5', 'Livraison MAD 5 : vérification matelas à air', 50],
  ['LNF', 'Livraison non effectuée avec déplacement', 5], ['LNF1', 'Livraison non effectuée sans déplacement', 0],
  ['LIN', 'Livraison nutrition', 10], ['O2G', 'Livraison O2 gazeux', 10], ['OGL', 'Livraison O2 gazeux et liquide', 24],
  ['LIVO2L', 'Livraison O2 liquide (14 min/cuve)', 14], ['O2L', 'Livraison O2 liquide (14 min/cuve)', 14],
  ['LP', 'Livraison perfusion', 10], ['M', 'Maintenance', 20], ['RET', 'Retrait partiel de dispositif', 10]
];
// liste vide au départ, comme les RDV : les AMD sont importés par CSV à chaque test
const DEFAULT_AMD = [];
// tous les AMD sont habilités O2 : pas de compétence O2 côté VROOM. Les compétences servent à bloquer chaque RDV sur son AMD Isadom.
// Un AMD décoché « Actif » est ignoré par l'optimisation.
const amdActif = (a) => a.actif !== false;
const DEMO_RDV = [
  ['Patient test 01', '04100', 'Manosque', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 02', '04110', 'Reillanne', 'PPC', 'matin', 'GALLIANO'],
  ['Patient test 03', '04800', 'Saint-Martin-de-Brome', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 04', '04210', 'Brunet', 'REC', 'matin', 'GALLIANO'],
  ['Patient test 05', '04270', "Bras-d'Asse", 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 06', '04500', 'Riez', 'CTL', 'matin', 'GALLIANO'],
  ['Patient test 07', '04500', 'Montagnac-Montpezat', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 08', '04120', 'La Palud-sur-Verdon', 'LIT', 'am', 'GALLIANO'],
  ['Patient test 09', '83630', 'Aiguines', 'LIV', 'am', 'GALLIANO'],
  ['Patient test 10', '04000', 'Digne-les-Bains', 'O2', 'matin', 'GUINET FONTAINE'],
  ['Patient test 11', '04000', 'La Robine-sur-Galabre', 'LIV', 'matin', 'GUINET FONTAINE']
];
const CSV_COLS = [
  ['date', 'Oui', 'JJ/MM/AAAA. Seules les lignes de la date planifiée sont optimisées.', '16/10/2026'],
  ['patient', 'Oui', 'Nom ou identifiant de test', 'Patient test 01'],
  ['code_postal', 'Oui', '5 chiffres', '04100'],
  ['ville', 'Oui', 'Nom de la commune', 'Manosque'],
  ['adresse', 'Non', 'Numéro et rue. Vide : centre de la commune', '12 rue Exemple'],
  ['intervention', 'Oui', 'Code défini dans les paramètres (voir liste ci-dessous)', 'O2'],
  ['demi_journee', 'Oui', 'matin · mi-journee · apres-midi', 'matin'],
  ['amd_actuel', 'Oui', 'Nom de l’AMD prévu (Isadom). Le RDV reste chez cet AMD ; sans AMD reconnu, il ressort en alerte', 'GALLIANO']
];

/* ---------- état et persistance ---------- */
const KEY = 'opriservices.v1';
let state;
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
  state = Object.assign({ params: clone(DEFAULT_PARAMS), amd: clone(DEFAULT_AMD), rdv: [], results: {}, geo: {}, date: null }, s || {});
  state.params = Object.assign(clone(DEFAULT_PARAMS), state.params);
  migrateParams(state.params);
  // ancien format : un seul résultat
  if (state.result) { state.results[state.result.date] = state.result; delete state.result; }
  // ancien libellé patient « NOM Prénom (code) » : le code est retiré du nom
  const sansCode = (rd) => { const suf = rd.patientCode ? ' (' + rd.patientCode + ')' : ''; if (suf && String(rd.patient || '').endsWith(suf)) rd.patient = rd.patient.slice(0, -suf.length); };
  state.rdv.forEach(sansCode);
  Object.values(state.results).forEach((R) => [R.rdv, R.excluded, R.horsAmd].forEach((l) => (l || []).forEach(sansCode)));
  // 14/10/2026 : cache du géocodage en cascade (clés « v2| ») ; l'ancien cache, échecs compris, est oublié
  Object.keys(state.geo).forEach((k) => { if (!k.startsWith('v2|')) delete state.geo[k]; });
}
/* complète une configuration enregistrée avant l'import Isadom (créneau Journée, antennes Isadom, coefficient multi-types) */
function migrateParams(p) {
  p.creneaux = Object.assign(clone(DEFAULT_PARAMS.creneaux), p.creneaux);
  if (p.multiCoef == null) p.multiCoef = DEFAULT_PARAMS.multiCoef;
  p.depots.forEach((d) => {
    if (d.isadom == null) { const def = DEFAULT_PARAMS.depots.find((x) => x.id === d.id); d.isadom = def ? def.isadom : ''; }
  });
  // 14/10/2026 : toutes les antennes entrent dans le test (une seule fois : on peut ensuite en décocher)
  if (!p.toutesAntennes) { p.depots.forEach((d) => { d.actif = true; }); p.toutesAntennes = true; }
}
let saveTimer;
function save(flag) {
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); break; } catch (e) {
      // stockage plein : on oublie le résultat le plus ancien et on réessaie
      const old = Object.values(state.results).sort((a, b) => a.at.localeCompare(b.at));
      if (old.length < 2) { console.warn('Sauvegarde impossible', e); J.crit('systeme', 'Sauvegarde impossible', 'Stockage du navigateur plein : les dernières modifications ne seront pas conservées après rechargement', e); break; }
      J.warn('systeme', 'Résultat purgé', `Stockage plein : résultat du ${frDate(old[0].date)} supprimé pour libérer de la place`);
      delete state.results[old[0].date];
    }
  }
  if (flag) {
    const fs = $$('.saved'); fs.forEach((f) => { f.textContent = 'Enregistré'; f.hidden = false; }); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { fs.forEach((f) => { f.hidden = true; }); }, 1500);
  }
}
const typeOf = (code) => state.params.types.find((t) => t.code === code);
const depotOf = (id) => state.params.depots.find((d) => d.id === id);
/* point de départ correspondant à l'antenne Isadom d'un RDV (libellé AnnAnnuaire.sNom, ex. « ARARD 13 ») */
const depotOfAntenne = (antenne) => state.params.depots.find((d) => d.isadom && norm(d.isadom) === norm(antenne));
/* un RDV Isadom n'est optimisé que si son antenne correspond à un point de départ inclus dans le test */
const rdvInScope = (rd) => { if (!rd.antenne) return true; const d = depotOfAntenne(rd.antenne); return !!(d && d.actif); };

/* ---------- navigation ---------- */
const VIEWS = ['parametres', 'parametres-rdv', 'trajet', 'planification', 'resultat'];
function route() {
  let v = location.hash.replace('#', '') || 'parametres';
  if (!VIEWS.includes(v)) v = 'parametres';
  VIEWS.forEach((x) => { $('#v-' + x).hidden = x !== v; });
  document.body.dataset.view = v;
  const tab = v === 'trajet' ? 'parametres' : v;
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (v === 'parametres' || v === 'parametres-rdv') renderParams();
  // les tableaux AMD et RDV sont sur les écrans de paramètres, les RDV écartés sur Planification
  if (v === 'parametres' || v === 'parametres-rdv' || v === 'planification') renderPlan();
  if (v === 'resultat') renderResult();
  if (v === 'trajet') initTrajet();
  window.scrollTo(0, 0);
}

/* ---------- géocodage (BAN via Géoplateforme) ---------- */
/* une recherche BAN : jusqu'à 5 résultats, mis en cache dans state.geo */
async function chercherBan({ q, postcode, type }) {
  const key = 'v2|' + norm(q) + '|' + (postcode || '') + '|' + (type || '');
  if (state.geo[key]) return state.geo[key];
  let url = '/geocode/search?limit=5&q=' + encodeURIComponent(q);
  if (postcode) url += '&postcode=' + encodeURIComponent(postcode);
  if (type) url += '&type=' + encodeURIComponent(type);
  const r = await fetch(url);
  if (r.status === 400) return []; // requête refusée par la BAN (trop courte, caractères) : rien à trouver
  if (!r.ok) throw new Error('Géocodage indisponible (HTTP ' + r.status + ')');
  const j = await r.json();
  const res = (j.features || []).map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties.label, score: f.properties.score,
    type: f.properties.type, name: f.properties.name, city: f.properties.city, postcode: f.properties.postcode }));
  state.geo[key] = res;
  return res;
}
/* premier résultat d'une recherche simple (antennes, test de trajet) */
async function geocode(q, postcode) {
  const f = (await chercherBan({ q, postcode }))[0];
  return f ? { lon: f.lon, lat: f.lat, label: f.label, score: f.score } : { none: true };
}
/* zone couverte par la carte OSRM (extrait PACA + Corse) : un point hors zone fait échouer tout le calcul VROOM */
const ZONE_CARTE = [
  { nom: 'PACA', lat: [42.95, 45.15], lon: [4.2, 7.75] },
  { nom: 'Corse', lat: [41.3, 43.05], lon: [8.5, 9.6] }
];
const inZone = (g) => !!g && !g.none && ZONE_CARTE.some((z) => g.lat >= z.lat[0] && g.lat <= z.lat[1] && g.lon >= z.lon[0] && g.lon <= z.lon[1]);
const MOTIF_HORS_ZONE = 'hors zone de la carte (PACA / Corse)';
const MOTIF_COMMUNE = 'adresse localisée seulement à la commune';
/* RDV : recherche en cascade (web/js/geo/geocode-core.js). Une position à la commune seulement
   est gardée (lat/lon) mais marquée none : le RDV est écarté du calcul. v: 2 = géocodé en cascade */
async function geocodeRdv(r) {
  const g = await OptiGeocode.localise(r, chercherBan, { dansZone: inZone });
  r.geo = !g ? { none: true, v: 2 } : Object.assign(g, { v: 2 }, g.precision === 'commune' ? { none: true, commune: true } : {});
}
/* à (re)géocoder : sans position, géocodé avant la cascade, ou pas localisé précisément (les recherches déjà faites
   sont en cache : seules les nouvelles variantes partent vers la BAN). Les coordonnées Isadom ne sont pas touchées */
const aGeocoder = (r) => !r.geo || (!r.geo.src && (r.geo.v !== 2 || !!r.geo.none));
async function geocodeDepot(d) {
  const cp = (d.adr.match(/\b\d{5}\b/) || [])[0];
  const g = await geocode(d.adr, cp);
  d.geo = g.none ? { none: true } : g;
}
async function pool(items, fn, n = 5) {
  const q = items.slice(); const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { errs.push(e); } }
  }));
  if (errs.length) throw errs[0];
}
function geoBadge(g) {
  if (!g) return '<span class="geo no">À localiser</span>';
  if (g.horsZone) return `<span class="geo ko" title="${esc(g.label || '')}">Hors zone carte</span>`;
  if (g.commune) return `<span class="geo ko" title="Seule la commune a été trouvée : ${esc(g.label || '')}">Commune seulement</span>`;
  if (g.none) return '<span class="geo ko">Introuvable</span>';
  if (g.src) return `<span class="geo ok" title="${esc(g.label)}">Isadom${g.src === 'w3w' ? ' (W3W)' : ''}</span>`;
  const title = `${esc(g.label)} · score ${g.score.toFixed(2)}${g.etape ? ' · ' + esc(g.etape) : ''}`;
  if (g.score < 0.6) return `<span class="geo low" title="${title}">À vérifier</span>`;
  if (g.precision === 'rue') return `<span class="geo low" title="${title} · numéro non trouvé, point placé sur la voie">Rue seulement</span>`;
  return `<span class="geo ok" title="${title}">Localisé</span>`;
}

/* lignes du tableau des RDV écartés (écran Planification : prévision ; écran Résultat : résultat) */
function ecartesRows(list) {
  return list.map((rd) => `<tr><td class="mono gras">${esc(frDate(rd.date))}</td><td class="mono gras">${esc(rd.patientCode || '')}</td><td class="mono gras">${esc(rd.idRdv || '')}</td><td><b>${esc(rd.patient)}</b>${rd.antenne ? `<div class="hint">${esc(rd.antenne)}</div>` : ''}</td>
    <td class="mono">${esc(rd.cp)}</td><td>${esc(rd.ville || '?')}</td><td>${esc(rd.adresse)}</td><td>${rdvTypeHtml(rd)}</td>
    <td class="mono">${esc(rd.hDeb ? rd.hDeb + '–' + rd.hFin : crenOf(rd.cren).nom)}</td><td>${esc(rd.amdActuel)}</td>
    <td><b style="color:var(--danger)">${esc(rd.motif)}</b>${rd.geo && rd.geo.label ? `<div class="hint">localisé : ${esc(rd.geo.label)}</div>` : ''}</td></tr>`).join('');
}
const motifGeo = (rd) => (rd.geo && rd.geo.horsZone ? MOTIF_HORS_ZONE : rd.geo && rd.geo.commune ? MOTIF_COMMUNE : rd.geo && !rd.geo.none && !inZone(rd.geo) ? MOTIF_HORS_ZONE : 'adresse introuvable');

/* ---------- 1. paramètres ---------- */
function renderParams() {
  const p = state.params;
  $('#t-creneaux').innerHTML = CRENEAUX.map((c) => `<tr><td>${c.nom}</td>
    <td><input type="time" class="mono" data-cren="${c.code}" data-pos="0" value="${p.creneaux[c.code][0]}" aria-label="Début ${c.nom}"></td>
    <td><input type="time" class="mono" data-cren="${c.code}" data-pos="1" value="${p.creneaux[c.code][1]}" aria-label="Fin ${c.nom}"></td></tr>`).join('');
  $$('[data-param]').forEach((el) => { el.value = p[el.dataset.param]; });
  $('#t-types').innerHTML = p.types.map((t, i) => `<tr>
    <td style="width:110px"><input class="mono" data-type="${i}" data-k="code" value="${esc(t.code)}" aria-label="Code"></td>
    <td><input data-type="${i}" data-k="nom" value="${esc(t.nom)}" aria-label="Libellé"></td>
    <td style="width:170px"><input type="number" min="0" step="5" class="mono" data-type="${i}" data-k="duree" value="${t.duree}" aria-label="Durée"></td>
    <td><input type="checkbox" data-type="${i}" data-k="o2" ${t.o2 ? 'checked' : ''} aria-label="Visite O2"></td>
    <td><button class="icon-btn" data-type-del="${i}" type="button" aria-label="Supprimer ce type">×</button></td></tr>`).join('');
  $('#l-depots').innerHTML = p.depots.map((d, i) => `<div class="depot ${d.actif ? 'on' : ''}">
    <div class="row-between"><b>${esc(d.nom)}</b>
      <label><input type="checkbox" data-depot="${i}" data-k="actif" ${d.actif ? 'checked' : ''}> Inclus dans le test</label></div>
    <input data-depot="${i}" data-k="adr" value="${esc(d.adr)}" aria-label="Adresse ${esc(d.nom)}">
    <label class="hint">Antenne Isadom <input class="mono" data-depot="${i}" data-k="isadom" value="${esc(d.isadom)}" placeholder="ex. ARARD 13" aria-label="Libellé de l'antenne dans Isadom pour ${esc(d.nom)}"></label>
    <div>${geoBadge(d.geo)} ${d.geo && !d.geo.none ? '<span class="hint">' + esc(d.geo.label) + '</span>' : ''}</div></div>`).join('');
}
function bindParams() {
  // les deux écrans de paramètres (AMD et RDV) partagent les mêmes écouteurs
  const vues = [$('#v-parametres'), $('#v-parametres-rdv')];
  const v = { addEventListener: (type, fn) => vues.forEach((el) => el.addEventListener(type, fn)) };
  v.addEventListener('change', (e) => {
    const el = e.target; const p = state.params;
    const logChg = (quoi, avant, apres) => { if (String(avant) !== String(apres)) J.info('parametres', 'Paramètre modifié', quoi, { avant, apres }); };
    if (el.dataset.param) {
      const avant = p[el.dataset.param];
      p[el.dataset.param] = el.type === 'number' ? Number(el.value) : el.value;
      logChg(fieldLabel(el), avant, p[el.dataset.param]);
    } else if (el.dataset.cren) {
      const avant = p.creneaux[el.dataset.cren][Number(el.dataset.pos)];
      p.creneaux[el.dataset.cren][Number(el.dataset.pos)] = el.value;
      logChg('Créneau : ' + fieldLabel(el), avant, el.value);
    } else if (el.dataset.type) {
      const t = p.types[Number(el.dataset.type)]; const avant = t[el.dataset.k];
      t[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : (el.dataset.k === 'code' ? el.value.trim().toUpperCase() : el.value);
      logChg(`Type d'intervention ${t.code} : ${fieldLabel(el)}`, avant, t[el.dataset.k]);
    } else if (el.dataset.depot) {
      const d = p.depots[Number(el.dataset.depot)];
      if (el.dataset.k === 'actif') { d.actif = el.checked; J.info('parametres', d.actif ? 'Antenne incluse dans le test' : 'Antenne exclue du test', d.nom); }
      else if (el.dataset.k === 'isadom') { logChg(d.nom + ' : antenne Isadom', d.isadom, el.value.trim()); d.isadom = el.value.trim(); }
      else { logChg(d.nom + ' : adresse', d.adr, el.value); d.adr = el.value; delete d.geo; }
      renderParams(); renderPlan();
    } else return;
    save(true);
  });
  v.addEventListener('click', (e) => {
    const del = e.target.closest('[data-type-del]');
    if (del) { const [t] = state.params.types.splice(Number(del.dataset.typeDel), 1); J.info('parametres', "Type d'intervention supprimé", `${t.code} · ${t.nom} (${t.duree} min)`); save(true); renderParams(); }
  });
  $('#type-add').addEventListener('click', () => {
    state.params.types.push({ code: 'NOUV', nom: 'Nouveau type', duree: 30, o2: false }); J.info('parametres', "Type d'intervention ajouté", 'NOUV · Nouveau type (30 min)'); save(true); renderParams();
  });
  $('#depot-geo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await pool(state.params.depots, geocodeDepot);
      const ko = state.params.depots.filter((d) => d.geo && d.geo.none);
      J.log(ko.length ? 'warn' : 'info', 'parametres', 'Localisation des antennes', ko.length ? `${ko.length} adresse${ko.length > 1 ? 's' : ''} introuvable${ko.length > 1 ? 's' : ''}` : `${state.params.depots.length} adresses localisées`, ko.map((d) => d.nom + ' : ' + d.adr));
    } catch (err) { console.error(err); J.crit('parametres', 'Localisation des antennes', err.message); $$('.saved').forEach((f) => { f.textContent = err.message; f.hidden = false; }); }
    e.target.disabled = false; save(true); renderParams();
  });
  $('#cfg-export').addEventListener('click', () => {
    download('opriservices-config.json', JSON.stringify({ params: state.params, amd: state.amd }, null, 2), 'application/json');
    J.info('parametres', 'Export de la configuration', 'opriservices-config.json', { types: state.params.types.length, amd: state.amd.length });
  });
  $('#cfg-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.params) { state.params = Object.assign(clone(DEFAULT_PARAMS), j.params); migrateParams(state.params); }
      if (Array.isArray(j.amd)) state.amd = j.amd;
      if (!j.params && !Array.isArray(j.amd)) J.warn('parametres', 'Import de la configuration', `« ${f.name} » ne contient ni paramètres ni AMD : rien n'a été importé`);
      else J.info('parametres', 'Import de la configuration', f.name, { parametres: j.params ? 'remplacés' : 'inchangés', amd: Array.isArray(j.amd) ? j.amd.length + ' (remplacés)' : 'inchangés' });
      save(true); renderParams();
    } catch (err) { window.console.error(err); J.crit('parametres', 'Import de la configuration', `Fichier « ${f.name} » illisible (JSON attendu)`, err.message); }
    e.target.value = '';
  });
}

/* ---------- 2. planification ---------- */
function nextWorkday() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DATE_ATTRS = 'placeholder="jj/mm/aaaa" maxlength="10" inputmode="numeric" autocomplete="off"';
function frDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function longDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function alertMsg(sel, html, kind) {
  const el = $(sel); el.className = 'msg' + (kind ? ' ' + kind : ''); el.innerHTML = html; el.hidden = !html;
}
function renderPlan() {
  if (!state.date) state.date = nextWorkday();
  $('#pl-date').value = frDate(state.date);
  const nCible = state.rdv.filter((r) => r.date === state.date && rdvInScope(r)).length;
  $('#pl-cible').textContent = `Seule la journée du ${longDate(state.date)} sera optimisée : ${nCible} RDV sur les antennes du test. Une journée à la fois.`;
  const deps = state.params.depots;
  $('#c-amd').textContent = '· ' + state.amd.filter((a) => amdActif(a) && a.dispo !== 'absent').length;
  const amdOrder = ddTrier('amd', state.amd.map((a, i) => i).filter((i) => amdMatches(state.amd[i])));
  $('#t-amd').innerHTML = amdOrder.map((i) => {
    const a = state.amd[i];
    const d = depotOf(a.depot); const off = !amdActif(a) || a.dispo === 'absent' || !d || !d.actif;
    return `<tr class="${off ? 'off' : ''}">
    <td class="cb"><label><input type="checkbox" data-amd="${i}" data-k="actif" ${amdActif(a) ? 'checked' : ''} aria-label="AMD actif (décocher pour l'exclure de l'optimisation)"></label></td>
    <td style="width:90px"><input class="mono" data-amd="${i}" data-k="code" value="${esc(a.code || '')}" placeholder="—" aria-label="Code Isadom de l'AMD"></td>
    <td><input data-amd="${i}" data-k="nom" value="${esc(a.nom)}" aria-label="Nom de l'AMD"></td>
    <td><select data-amd="${i}" data-k="depot" aria-label="Point de départ">${deps.map((x) => `<option value="${x.id}" ${x.id === a.depot ? 'selected' : ''}>${esc(x.nom)}${x.actif ? '' : ' (hors test)'}</option>`).join('')}</select></td>
    <td><select data-amd="${i}" data-k="dispo" aria-label="Disponibilité">${DISPOS.map((x) => `<option value="${x.code}" ${x.code === a.dispo ? 'selected' : ''}>${x.nom}</option>`).join('')}</select></td>
    <td style="width:100px"><input type="number" min="0" step="0.5" class="mono" data-amd="${i}" data-k="hmax" value="${a.hmax}" aria-label="Heures max"></td>
    <td style="width:100px"><input type="number" min="0" step="10" class="mono" data-amd="${i}" data-k="kmmax" value="${a.kmmax}" aria-label="Km max"></td>
    <td><button class="icon-btn" data-amd-del="${i}" type="button" aria-label="Retirer cet AMD">×</button></td></tr>`;
  }).join('');
  if (state.amd.length && !amdOrder.length) $('#t-amd').innerHTML = '<tr><td colspan="8" class="empty">Aucun AMD ne correspond au filtre.</td></tr>';

  const types = state.params.types;
  const dayAll = state.rdv.filter((r) => r.date === state.date);
  const nDay = dayAll.length; const nScope = dayAll.filter(rdvInScope).length;
  const probs = state.rdv.filter((r) => rdvInScope(r) && r.geo && (r.geo.none || !inZone(r.geo)))
    .map((r) => Object.assign({}, r, { motif: motifGeo(r) })).sort((a, b) => a.date.localeCompare(b.date));
  const nProbDay = probs.filter((r) => r.date === state.date).length;
  $('#pl-ecartes').hidden = !probs.length;
  $('#c-pl-ecartes').textContent = probs.length ? `· ${probs.length}` + (nProbDay ? ` dont ${nProbDay} le ${frDate(state.date)}` : '') : '';
  $('#t-pl-ecartes').innerHTML = ecartesRows(probs);
  $('#c-rdv').textContent = `· ${state.rdv.length} au total · ${nDay} le ${frDate(state.date)}` + (nScope < nDay ? ` dont ${nScope} sur les antennes du test` : '');
  // les RDV Isadom de la date sont affichés en tête ; ceux hors date ou hors antennes du test sont grisés
  const order = ddTrier('rdv', state.rdv.map((r, i) => i).filter((i) => rdvMatches(state.rdv[i])).sort((a, b) => (state.rdv[a].date === state.date ? 0 : 1) - (state.rdv[b].date === state.date ? 0 : 1) || a - b));
  $('#t-rdv').innerHTML = state.rdv.length ? order.map((i) => { const r = state.rdv[i]; const isa = !!r.idRdv; return `<tr class="${r.date === state.date && rdvInScope(r) ? '' : 'off'}">
    <td style="width:150px"><input class="mono gras" ${DATE_ATTRS} data-rdv="${i}" data-k="date" value="${frDate(r.date)}" aria-label="Date"></td>
    <td style="width:110px"><input class="mono gras" data-rdv="${i}" data-k="patientCode" value="${esc(r.patientCode || '')}" placeholder="—" aria-label="Code patient"></td>
    <td style="min-width:240px"><input data-rdv="${i}" data-k="patient" value="${esc(r.patient)}" aria-label="Patient">${isa ? `<div class="hint">${esc(r.antenne || '')} · RDV ${esc(r.idRdv)} · ${esc(r.besoin || '')}${infoTitle(r) ? ` · <span class="info-dot" title="${esc(infoTitle(r))}">infos</span>` : ''}</div>` : ''}</td>
    <td style="width:88px"><input class="mono" data-rdv="${i}" data-k="cp" value="${esc(r.cp)}" aria-label="Code postal"></td>
    <td><input data-rdv="${i}" data-k="ville" value="${esc(r.ville)}" aria-label="Ville"></td>
    <td><input data-rdv="${i}" data-k="adresse" value="${esc(r.adresse)}" aria-label="Adresse"></td>
    <td>${r.types && r.types.length > 1
      ? `<span title="${esc(rdvTypeNom(r))}">${r.types.map(tvBadge).join(' + ')}</span><div class="hint">${rdvDuree(r)} min</div>`
      : `<select data-rdv="${i}" data-k="type" aria-label="Intervention">${types.map((t) => `<option value="${esc(t.code)}" ${t.code === r.type ? 'selected' : ''}>${esc(typeLabel(t.code))}</option>`).join('')}${typeOf(r.type) ? '' : `<option selected value="${esc(r.type)}">${esc(r.type)} (inconnu)</option>`}</select>`}</td>
    <td class="mono">${esc(rdvVisitePrest(r))}</td>
    <td style="width:130px">${isa && r.hDeb
      ? `<span class="badge ${crenOf(r.cren).badge}">${crenOf(r.cren).nom}</span><div class="hint mono">${esc(r.hDeb)}–${esc(r.hFin)}</div>`
      : `<select data-rdv="${i}" data-k="cren" aria-label="Demi-journée">${CRENEAUX.map((c) => `<option value="${c.code}" ${c.code === r.cren ? 'selected' : ''}>${c.nom}</option>`).join('')}</select>`}</td>
    <td><input data-rdv="${i}" data-k="amdActuel" value="${esc(r.amdActuel)}" aria-label="AMD prévu">${r.amdCode ? `<div class="hint mono">code ${esc(r.amdCode)}</div>` : ''}</td>
    <td>${geoBadge(r.geo)}</td>
    <td><button class="icon-btn" data-rdv-del="${i}" type="button" aria-label="Supprimer ce RDV">×</button></td></tr>`; }).join('')
    : '<tr><td colspan="12" class="empty">Aucun RDV. Importez un fichier CSV, ajoutez un RDV ou chargez l\'exemple.</td></tr>';
  if (state.rdv.length && !order.length) $('#t-rdv').innerHTML = '<tr><td colspan="12" class="empty">Aucun RDV ne correspond à la recherche.</td></tr>';
  $$('.dd-btn').forEach((b) => {
    const D = DD[b.dataset.ddT || 'rdv']; const on = !!D.sel[b.dataset.dd]; const tri = D.tri && D.tri.k === b.dataset.dd ? D.tri.dir : 0;
    b.classList.toggle('on', on); b.textContent = tri > 0 ? '↑' : tri < 0 ? '↓' : '▾';
    b.title = [on ? 'Filtre actif' : '', tri ? (tri > 0 ? 'tri croissant' : 'tri décroissant') : ''].filter(Boolean).join(', ') || 'Filtrer ou trier';
  });
  const filtering = Object.values(rdvFilter).some((v) => v && v.trim()) || Object.keys(rdvSel).length > 0;
  if (filtering) $('#c-rdv').textContent += ` · ${order.length} trouvé${order.length > 1 ? 's' : ''}`;

  $('#t-csvfmt').innerHTML = CSV_COLS.map((c) => `<tr><td class="mono"><b>${c[0]}</b></td><td>${c[1]}</td><td>${esc(c[2])}</td><td class="mono">${esc(c[3])}</td></tr>`).join('')
    + `<tr><td colspan="4" class="hint">Codes d'intervention actuels : ${types.map((t) => `<code>${esc(t.code)}</code> ${esc(t.nom)}`).join(' · ')}</td></tr>`;
  resetDelZone();
}
/* recherche par colonne dans le tableau des RDV : chaque mot saisi doit figurer dans la colonne (sans accents ni casse) */
const rdvFilter = {};
const geoText = (g) => (!g ? 'à localiser' : g.horsZone ? 'hors zone carte' : g.commune ? 'commune seulement ' + (g.label || '') : g.none ? 'introuvable' : g.precision === 'rue' ? 'rue seulement localise ban ' + (g.label || '') : g.src ? 'isadom ' + (g.src === 'w3w' ? 'w3w what3words' : 'coordonnees') + ' localise' : 'localise ban ' + (g.label || ''));
const FILTER_TEXT = {
  date: (r) => frDate(r.date) + ' ' + r.date,
  code: (r) => r.patientCode,
  patient: (r) => [r.patient, r.idRdv, r.antenne, r.besoin].join(' '),
  cp: (r) => r.cp, ville: (r) => r.ville, adresse: (r) => r.adresse,
  type: (r) => rdvTypes(r).join(' ') + ' ' + rdvTypeNom(r),
  prest: (r) => rdvVisitePrest(r),
  cren: (r) => [crenOf(r.cren).nom, r.hDeb, r.hFin].join(' '),
  amd: (r) => [r.amdActuel, r.amdCode].join(' '),
  geo: (r) => geoText(r.geo)
};
function rdvMatches(r, sauf) {
  return Object.entries(rdvFilter).every(([k, v]) => {
    const terms = norm(v).split(' ').filter(Boolean);
    if (!terms.length) return true;
    const txt = norm(FILTER_TEXT[k](r));
    return terms.every((t) => txt.includes(t));
  }) && Object.entries(rdvSel).every(([k, sel]) => k === sauf || sel.has(DD_VAL[k](r)));
}
/* liste déroulante des valeurs dans l'en-tête des colonnes, comme le filtre automatique d'Excel */
const rdvSel = {}; // colonne → Set des valeurs cochées ; colonne absente = pas de filtre
const geoVal = (g) => (!g ? 'À localiser' : g.horsZone ? 'Hors zone carte' : g.commune ? 'Commune seulement' : g.none ? 'Introuvable' : g.precision === 'rue' ? 'Rue seulement (BAN)' : g.src ? (g.src === 'w3w' ? 'Isadom (what3words)' : 'Isadom (coordonnées)') : 'Localisé (BAN)');
const DD_VAL = {
  date: (r) => r.date || '',
  code: (r) => r.patientCode || '',
  patient: (r) => r.patient || '',
  cp: (r) => r.cp || '', ville: (r) => r.ville || '', adresse: (r) => r.adresse || '',
  type: (r) => rdvTypeNom(r),
  prest: (r) => rdvVisitePrest(r),
  cren: (r) => crenOf(r.cren).nom,
  amd: (r) => r.amdActuel || '',
  geo: (r) => geoVal(r.geo)
};
/* mêmes listes déroulantes sur le tableau des AMD */
const amdSel = {};
const AMD_VAL = {
  actif: (a) => (amdActif(a) ? 'Oui' : 'Non'),
  code: (a) => String(a.code || '').trim(),
  nom: (a) => a.nom || '',
  depot: (a) => (depotOf(a.depot) || { nom: a.depot || '' }).nom,
  dispo: (a) => (DISPOS.find((x) => x.code === a.dispo) || { nom: a.dispo || '' }).nom,
  hmax: (a) => String(a.hmax ?? ''),
  kmmax: (a) => String(a.kmmax ?? '')
};
const amdMatches = (a, sauf) => Object.entries(amdSel).every(([k, sel]) => k === sauf || sel.has(AMD_VAL[k](a)));
// tri : null = ordre par défaut, sinon { k: colonne, dir: 1 croissant | -1 décroissant }
const DD = {
  rdv: { list: () => state.rdv, sel: rdvSel, val: DD_VAL, matches: rdvMatches, tri: null },
  amd: { list: () => state.amd, sel: amdSel, val: AMD_VAL, matches: amdMatches, tri: null }
};
const ddCmp = (a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });
/* trie des index de lignes selon le tri choisi ; les vides restent en dernier, l'ordre par défaut départage */
function ddTrier(t, idx) {
  const D = DD[t]; if (!D.tri) return idx;
  const f = D.val[D.tri.k]; const L = D.list();
  return idx.slice().sort((i, j) => {
    const a = f(L[i]), b = f(L[j]);
    return a === b ? 0 : a === '' ? 1 : b === '' ? -1 : ddCmp(a, b) * D.tri.dir;
  });
}
const ddLabel = (k, v) => (v === '' ? '(Vides)' : k === 'date' ? frDate(v) : v);
let ddCol = null;
function ddClose() { const p = $('#dd-pop'); if (p) p.remove(); ddCol = null; }
function ddOpen(btn) {
  const k = btn.dataset.dd; const t = btn.dataset.ddT || 'rdv'; const D = DD[t];
  if (ddCol === t + ':' + k) { ddClose(); return; }
  ddClose(); ddCol = t + ':' + k;
  // valeurs des lignes qui passent les filtres des autres colonnes ; les vides en dernier
  const vals = [...new Set(D.list().filter((r) => D.matches(r, k)).map(D.val[k]))]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : ddCmp(a, b)));
  const sel = D.sel[k];
  const tri = D.tri && D.tri.k === k ? D.tri.dir : 0;
  const pop = document.createElement('div');
  pop.id = 'dd-pop'; pop.className = 'dd-pop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Filtrer ou trier');
  pop.innerHTML = `<div class="dd-sort"><button class="btn2 ${tri > 0 ? 'on' : ''}" type="button" data-dd-sort="1">↑ Tri croissant</button><button class="btn2 ${tri < 0 ? 'on' : ''}" type="button" data-dd-sort="-1">↓ Tri décroissant</button>${tri ? '<button class="btn2" type="button" data-dd-sort="0">Sans tri</button>' : ''}</div>
    <input type="search" class="dd-q" placeholder="Rechercher…" aria-label="Rechercher une valeur">
    <div class="dd-list"><label class="dd-all"><input type="checkbox" data-dd-all> (Tout sélectionner)</label>
    ${vals.map((v) => `<label data-txt="${esc(norm(ddLabel(k, v)))}"><input type="checkbox" data-dd-v="${esc(v)}" ${!sel || sel.has(v) ? 'checked' : ''}> ${esc(ddLabel(k, v))}</label>`).join('') || '<p class="hint">Aucune valeur.</p>'}</div>
    <div class="dd-foot"><button class="btn2" type="button" data-dd-clear ${sel ? '' : 'disabled'}>Effacer le filtre</button><span></span><button class="btn2" type="button" data-dd-no>Annuler</button><button class="btn" type="button" data-dd-ok>OK</button></div>`;
  document.body.appendChild(pop);
  const b = btn.getBoundingClientRect();
  pop.style.top = (b.bottom + window.scrollY + 4) + 'px';
  pop.style.left = Math.max(window.scrollX + 8, Math.min(b.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8)) + 'px';
  const boxes = () => $$('[data-dd-v]', pop).filter((x) => !x.closest('label').hidden);
  const majTout = () => {
    const bx = boxes(); const n = bx.filter((x) => x.checked).length; const all = $('[data-dd-all]', pop);
    all.checked = bx.length > 0 && n === bx.length; all.indeterminate = n > 0 && n < bx.length;
    $('[data-dd-ok]', pop).disabled = !n;
  };
  majTout();
  $('.dd-q', pop).focus();
  pop.addEventListener('input', (e) => {
    if (!e.target.classList.contains('dd-q')) return;
    // comme Excel : une recherche ne coche que les valeurs trouvées
    const terms = norm(e.target.value).split(' ').filter(Boolean);
    $$('[data-dd-v]', pop).forEach((x) => {
      const l = x.closest('label'); l.hidden = !terms.every((t) => l.dataset.txt.includes(t));
      x.checked = terms.length ? !l.hidden : (!sel || sel.has(x.dataset.ddV));
    });
    majTout();
  });
  pop.addEventListener('change', (e) => {
    if (e.target.matches('[data-dd-all]')) boxes().forEach((x) => { x.checked = e.target.checked; });
    majTout();
  });
  pop.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('[data-dd-no]')) { ddClose(); btn.focus(); return; }
    if (t.matches('[data-dd-sort]')) { const dir = Number(t.dataset.ddSort); D.tri = dir ? { k, dir } : null; ddClose(); renderPlan(); btn.focus(); return; }
    if (t.matches('[data-dd-clear]')) { delete D.sel[k]; ddClose(); renderPlan(); btn.focus(); return; }
    if (t.matches('[data-dd-ok]')) {
      const coches = boxes().filter((x) => x.checked).map((x) => x.dataset.ddV);
      if (coches.length === vals.length) delete D.sel[k]; else D.sel[k] = new Set(coches);
      ddClose(); renderPlan(); btn.focus();
    }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ddClose(); btn.focus(); }
    if (e.key === 'Enter' && e.target.classList.contains('dd-q')) { e.preventDefault(); const ok = $('[data-dd-ok]', pop); if (!ok.disabled) ok.click(); }
  });
}
document.addEventListener('mousedown', (e) => { if (ddCol && !e.target.closest('#dd-pop, .dd-btn')) ddClose(); });
window.addEventListener('resize', ddClose);
function resetDelZone() {
  $('#del-zone').innerHTML = '<button class="btn2 danger" id="rdv-clear" type="button">Tout supprimer</button>';
}
function resetAmdDelZone() {
  $('#amd-del-zone').innerHTML = '<button class="btn2 danger" id="amd-clear" type="button">Tout supprimer</button>';
}
let filterTimer;
function bindPlan() {
  // tableaux AMD (Paramètres AMD), RDV (Paramètres RDV) et date (Planification)
  const vues = [$('#v-planification'), $('#v-parametres'), $('#v-parametres-rdv')];
  const v = { addEventListener: (type, fn) => vues.forEach((el) => el.addEventListener(type, fn)) };
  v.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'pl-date' || el.dataset.k === 'date') {
      const iso = parseDate(el.value);
      if (!iso) { el.setCustomValidity('Date attendue au format jj/mm/aaaa'); el.reportValidity(); return; }
      el.setCustomValidity('');
      if (el.id === 'pl-date') { if (state.date !== iso) J.info('action', 'Date planifiée changée', frDate(iso)); state.date = iso; } else { const r = state.rdv[Number(el.dataset.rdv)]; J.info('action', 'RDV modifié', rdvRef(r) + ' : date', { avant: frDate(r.date), apres: frDate(iso) }); r.date = iso; }
      save(); renderPlan(); return;
    }
    const isNum = el.type === 'number';
    if (el.dataset.amd) {
      const a = state.amd[Number(el.dataset.amd)]; const avant = a[el.dataset.k];
      a[el.dataset.k] = el.type === 'checkbox' ? el.checked : isNum ? Number(el.value) : el.value;
      const shown = (k, v) => (k === 'depot' ? (depotOf(v) || { nom: v }).nom : k === 'dispo' ? (DISPOS.find((x) => x.code === v) || { nom: v }).nom : v);
      J.info('action', 'AMD modifié', `${a.nom} : ${fieldLabel(el)}`, { avant: shown(el.dataset.k, avant), apres: shown(el.dataset.k, a[el.dataset.k]) });
      save(); if (['depot', 'dispo', 'actif'].includes(el.dataset.k)) renderPlan();
    } else if (el.dataset.rdv) {
      const r = state.rdv[Number(el.dataset.rdv)]; const avant = r[el.dataset.k];
      r[el.dataset.k] = el.value;
      J.info('action', 'RDV modifié', `${rdvRef(r)} : ${fieldLabel(el)}`, ['patient', 'patientCode'].includes(el.dataset.k) ? '' : { avant, apres: el.value });
      if (['cp', 'ville', 'adresse'].includes(el.dataset.k)) delete r.geo;
      save(); if (['date', 'cp', 'ville', 'adresse'].includes(el.dataset.k)) renderPlan();
    }
  });
  v.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.filter) {
      rdvFilter[el.dataset.filter] = el.value;
      clearTimeout(filterTimer); filterTimer = setTimeout(renderPlan, 150);
      return;
    }
    if (el.id !== 'pl-date' && el.dataset.k !== 'date') return;
    el.setCustomValidity('');
    if (e.inputType && e.inputType.startsWith('delete')) return;
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    if (/^\d+$/.test(el.value)) el.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
  });
  v.addEventListener('click', (e) => {
    const t = e.target;
    const dd = t.closest('.dd-btn');
    if (dd) { ddOpen(dd); return; }
    const ad = t.closest('[data-amd-del]');
    if (ad) { const [a] = state.amd.splice(Number(ad.dataset.amdDel), 1); J.info('action', 'AMD retiré', a.nom + (a.code ? ' (' + a.code + ')' : '')); save(); renderPlan(); return; }
    const rd = t.closest('[data-rdv-del]');
    if (rd) { const [r] = state.rdv.splice(Number(rd.dataset.rdvDel), 1); J.info('action', 'RDV supprimé', `${rdvRef(r)} du ${frDate(r.date)}`); save(); renderPlan(); return; }
    if (t.id === 'rdv-clear') {
      if (!state.rdv.length) return;
      $('#del-zone').innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--danger)">Supprimer les ${state.rdv.length} RDV ?</b>
        <button class="btn2 danger" id="rdv-clear-ok" type="button">Confirmer</button><button class="btn2" id="rdv-clear-no" type="button">Annuler</button></span>`;
      return;
    }
    if (t.id === 'rdv-clear-ok') { J.warn('action', 'Tous les RDV supprimés', `${state.rdv.length} RDV supprimés`); state.rdv = []; save(); $('#csv-report').hidden = true; alertMsg('#pl-msg', ''); renderPlan(); return; }
    if (t.id === 'rdv-clear-no') { resetDelZone(); }
    if (t.id === 'amd-clear') {
      if (!state.amd.length) return;
      $('#amd-del-zone').innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--danger)">Supprimer les ${state.amd.length} AMD ?</b>
        <button class="btn2 danger" id="amd-clear-ok" type="button">Confirmer</button><button class="btn2" id="amd-clear-no" type="button">Annuler</button></span>`;
      return;
    }
    if (t.id === 'amd-clear-ok') { J.warn('action', 'Tous les AMD supprimés', `${state.amd.length} AMD supprimés`); state.amd = []; save(); $('#amd-report').hidden = true; resetAmdDelZone(); renderPlan(); return; }
    if (t.id === 'amd-clear-no') { resetAmdDelZone(); }
    if (t.id === 'rdv-filter-clear') {
      Object.keys(rdvFilter).forEach((k) => delete rdvFilter[k]);
      Object.keys(rdvSel).forEach((k) => delete rdvSel[k]);
      $$('[data-filter]').forEach((x) => { x.value = ''; });
      renderPlan();
    }
    if (t.id === 'amd-from-isadom') {
      pendingAmd.forEach((a) => { if (!state.amd.some((x) => String(x.code || '') === a.code)) state.amd.push(a); });
      J.info('action', 'AMD ajoutés depuis Isadom', `${pendingAmd.length} AMD`, pendingAmd.map((a) => `${a.nom} (${a.code}) → ${(depotOf(a.depot) || {}).nom || a.depot}`));
      t.replaceWith(document.createTextNode(`→ ${pendingAmd.length} AMD ajouté${pendingAmd.length > 1 ? 's' : ''} (point de départ = antenne de leurs RDV, à vérifier).`));
      pendingAmd = []; save(); renderPlan();
    }
  });
  $('#amd-add').addEventListener('click', () => {
    const p = state.params; const d = p.depots.find((x) => x.actif) || p.depots[0];
    state.amd.push({ nom: 'NOUVEL AMD', depot: d.id, dispo: 'journee', hmax: p.hmax, kmmax: p.kmmax, actif: true }); J.info('action', 'AMD ajouté', 'NOUVEL AMD · ' + d.nom); save(); renderPlan();
  });
  $('#rdv-add').addEventListener('click', () => {
    state.rdv.push({ date: state.date, patient: 'Patient test ' + String(state.rdv.length + 1).padStart(2, '0'), cp: '', ville: '', adresse: '', type: state.params.types[0].code, cren: 'matin', amdActuel: '' });
    J.info('action', 'RDV ajouté', `${rdvRef(state.rdv[state.rdv.length - 1])} le ${frDate(state.date)}`); save(); renderPlan();
  });
  $('#rdv-demo').addEventListener('click', () => {
    DEMO_RDV.forEach(([patient, cp, ville, type, cren, amd]) => state.rdv.push({ date: state.date, patient, cp, ville, adresse: '', type, cren, amdActuel: amd }));
    J.info('action', "Chargement de l'exemple", `${DEMO_RDV.length} RDV de test ajoutés le ${frDate(state.date)}`); save(); renderPlan();
  });
  $('#csv-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    J.info('import', 'Fichier sélectionné', f.name, { taille: f.size < 1024 ? f.size + ' octets' : Math.round(f.size / 1024) + ' Ko' });
    try { importCsv(await f.text(), f.name); } catch (err) { console.error(err); J.crit('import', 'Import interrompu', `« ${f.name} » : erreur inattendue pendant l'intégration`, err); }
    e.target.value = '';
  });
  // import des AMD (CSV) : la logique est dans js/amd/amd-csv.js, chargé à la demande
  const amdCsv = import('./js/amd/amd-csv.js');
  amdCsv.then((m) => {
    $('#t-amdcsvfmt').innerHTML = m.AMD_CSV_COLS.map((c) => `<tr><td class="mono"><b>${c[0]}</b></td><td>${c[1]}</td><td>${esc(c[2])}</td><td class="mono">${esc(c[3])}</td></tr>`).join('');
  }).catch((e) => console.error(e));
  $('#amd-csv-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text(); e.target.value = '';
    const rep = $('#amd-report');
    try {
      const m = await amdCsv;
      const r = m.planAmdImport(text, state.amd, state.params);
      rep.hidden = false;
      if (r.fatal) { rep.className = 'warn'; rep.innerHTML = `<b>${esc(f.name)}</b> : ${esc(r.fatal)}`; return; }
      state.amd = r.amd; save(true); renderPlan();
      const n = (x, one, many) => x + ' ' + (x > 1 ? many : one);
      const off = r.created.concat(r.updated).filter((a) => { const d = depotOf(a.depot); return !d || !d.actif; });
      const all = r.errors.concat(r.warnings);
      rep.className = r.errors.length ? 'warn' : 'ok';
      rep.innerHTML = `<b>${esc(f.name)}</b> : ${n(r.created.length, 'AMD créé', 'AMD créés')}, ${n(r.updated.length, 'mis à jour', 'mis à jour')}`
        + (r.errors.length ? `, ${n(r.errors.length, 'ligne ignorée', 'lignes ignorées')}` : '') + '.'
        + (off.length ? `<ul><li>${n(off.length, 'AMD part', 'AMD partent')} d'un point de départ hors test (non optimisés tant que l'antenne n'est pas incluse) : ${off.map((a) => esc(a.nom)).join(', ')}</li></ul>` : '')
        + (all.length ? '<ul>' + all.slice(0, 30).map((x) => '<li>' + esc(x) + '</li>').join('') + (all.length > 30 ? '<li>…</li>' : '') + '</ul>' : '');
    } catch (err) { console.error(err); rep.hidden = false; rep.className = 'warn'; rep.textContent = 'Import impossible : ' + err.message; }
  });
  $('#pl-go').addEventListener('click', optimize);
  $('#r-opt').addEventListener('click', optimize);
  $('#r-prev').addEventListener('click', () => gotoDay(-1));
  $('#r-next').addEventListener('click', () => gotoDay(1));
  document.addEventListener('keydown', (e) => {
    if ($('#v-resultat').hidden || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,select,textarea')) return;
    if (e.key === 'ArrowLeft') gotoDay(-1);
    if (e.key === 'ArrowRight') gotoDay(1);
  });
}

/* ---------- import CSV ---------- */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
function parseCren(v) {
  const n = norm(v);
  if (n === 'matin' || n === 'am matin') return 'matin';
  if (n.startsWith('mi')) return 'mi';
  if (n.startsWith('apres') || n === 'pm' || n === 'aprem') return 'am';
  return null;
}
function parseDate(v) {
  v = v.trim();
  let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  const iso = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z'); // date impossible (ex. 32/10) : Invalid Date, toISOString lèverait une exception
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
function importCsv(text, name) {
  const rows = parseCsv(text);
  const rep = $('#csv-report');
  if (rows.length < 2) { rep.className = 'warn'; rep.hidden = false; rep.innerHTML = 'Fichier vide ou sans ligne de données.'; J.crit('import', 'Import refusé', `« ${name} » : fichier vide ou sans ligne de données`); return; }
  const head = rows[0].map((h) => norm(h).replace(/ /g, '_'));
  if (head.includes('idrdv') && head.includes('daterdv')) { importIsadom(rows, head, name); return; }
  const idx = {}; CSV_COLS.forEach(([c]) => { idx[c] = head.indexOf(c); });
  const missing = CSV_COLS.filter((c) => c[1] === 'Oui' && idx[c[0]] < 0).map((c) => c[0]);
  if (missing.length) {
    rep.className = 'warn'; rep.hidden = false;
    rep.innerHTML = `Colonnes obligatoires absentes : <b>${missing.map(esc).join(', ')}</b>. Vérifiez la ligne d'en-tête et le séparateur point-virgule.`;
    J.crit('import', 'Import refusé', `« ${name} » (format banc de test) : colonnes obligatoires absentes`, { absentes: missing.join(', '), entete: rows[0].join(';') });
    return;
  }
  const codes = new Map(state.params.types.map((t) => [norm(t.code), t.code]));
  const errs = []; let ok = 0;
  J.info('import', 'Début de l’intégration', `« ${name} » · format banc de test · ${rows.length - 1} ligne${rows.length > 2 ? 's' : ''} de données`);
  rows.slice(1).forEach((r, k) => {
    const get = (c) => (idx[c] >= 0 ? (r[idx[c]] || '').trim() : '');
    const line = k + 2; const pb = [];
    const date = parseDate(get('date')); if (!date) pb.push('date invalide « ' + get('date') + ' »');
    let cp = get('code_postal').replace(/\s/g, ''); if (/^\d{4}$/.test(cp)) cp = '0' + cp;
    if (!/^\d{5}$/.test(cp)) pb.push('code postal invalide « ' + get('code_postal') + ' »');
    const ville = get('ville'); if (!ville) pb.push('ville vide');
    const type = codes.get(norm(get('intervention'))); if (!type) pb.push('code intervention inconnu « ' + get('intervention') + ' »');
    const cren = parseCren(get('demi_journee')); if (!cren) pb.push('demi-journée invalide « ' + get('demi_journee') + ' »');
    if (pb.length) { errs.push(`Ligne ${line} : ${pb.join(', ')}`); return; }
    state.rdv.push({ date, patient: get('patient') || 'Patient ligne ' + line, cp, ville, adresse: get('adresse'), type, cren, amdActuel: get('amd_actuel') });
    ok++;
  });
  logLines(name, errs, []);
  J.log(ok ? (errs.length ? 'warn' : 'info') : 'crit', 'import', 'Fin de l’intégration', `« ${name} » : ${ok} RDV importé${ok > 1 ? 's' : ''}, ${errs.length} ligne${errs.length > 1 ? 's' : ''} ignorée${errs.length > 1 ? 's' : ''}`);
  save();
  rep.hidden = false; rep.className = errs.length ? 'warn' : 'ok';
  rep.innerHTML = `<b>${esc(name)}</b> : ${ok} RDV importé${ok > 1 ? 's' : ''}${errs.length ? `, ${errs.length} ligne${errs.length > 1 ? 's' : ''} ignorée${errs.length > 1 ? 's' : ''}` : ''}.`
    + (errs.length ? '<ul>' + errs.slice(0, 30).map((x) => '<li>' + esc(x) + '</li>').join('') + (errs.length > 30 ? '<li>…</li>' : '') + '</ul>' : '');
  const dates = [...new Set(state.rdv.map((r) => r.date))];
  if (ok && !state.rdv.some((r) => r.date === state.date) && dates.length) state.date = dates.sort()[0];
  save(); renderPlan();
}

/* une ligne de journal (warn) par ligne ignorée et par avertissement, plafonnée pour ne pas saturer le journal */
const LOG_LIGNES_MAX = 200;
function logLines(name, errs, warns) {
  errs.slice(0, LOG_LIGNES_MAX).forEach((x) => J.warn('import', 'Ligne ignorée', x, 'Fichier : ' + name));
  warns.slice(0, LOG_LIGNES_MAX).forEach((x) => J.warn('import', 'Donnée à vérifier', x, 'Fichier : ' + name));
  const over = Math.max(0, errs.length - LOG_LIGNES_MAX) + Math.max(0, warns.length - LOG_LIGNES_MAX);
  if (over) J.warn('import', 'Journal tronqué', `${over} autre${over > 1 ? 's' : ''} anomalie${over > 1 ? 's' : ''} non détaillée${over > 1 ? 's' : ''} pour « ${name} »`);
}

let pendingAmd = [];
/* ---------- import de l'export Isadom (requête RDV v7 : IdRdv;TypeBesoin;DateRdv;HeureDebut;…) ---------- */
const ISADOM_REQ = ['idrdv', 'daterdv', 'cp', 'ville'];
const hhmm = (v) => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
function crenFromIsadom(label, hDeb, hFin) {
  const n = norm(label);
  if (n === 'matin') return 'matin';
  if (n.startsWith('apres')) return 'am';
  if (n.startsWith('journee')) return 'jour';
  if (hDeb && hFin) { if (hm2s(hFin) <= hm2s('13:00')) return 'matin'; if (hm2s(hDeb) >= hm2s('12:00')) return 'am'; }
  return 'jour';
}
/* coordonnées Isadom : W3W figées > lat/lon Isadom > W3W non figées ; sinon géocodage BAN à l'optimisation */
function isadomGeo(get) {
  const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };
  // coordonnées hors PACA / Corse ignorées (erreurs de saisie Isadom ou patient hors zone) -> géocodage par l'adresse
  const pt = (la, lo) => { const lat = num(get(la)), lon = num(get(lo)); return lat != null && lon != null && inZone({ lat, lon }) ? { lat, lon } : null; };
  const w = pt('w3wlat', 'w3wlon'), c = pt('lat', 'lon');
  if (w && get('w3wfigee') === '1') return Object.assign(w, { label: 'What3Words figé (Isadom)', score: 1, src: 'w3w' });
  if (c) return Object.assign(c, { label: 'Coordonnées Isadom' + (get('geofigee') === '1' ? ' (figées)' : ''), score: 1, src: 'isadom' });
  if (w) return Object.assign(w, { label: 'What3Words (Isadom)', score: 1, src: 'w3w' });
  return null;
}
function importIsadom(rows, head, name) {
  const rep = $('#csv-report'); const p = state.params;
  const col = (c) => head.indexOf(c);
  const missing = ISADOM_REQ.filter((c) => col(c) < 0);
  if (missing.length) {
    rep.className = 'warn'; rep.hidden = false;
    rep.innerHTML = `Export Isadom incomplet : colonnes absentes <b>${missing.map(esc).join(', ')}</b>. Relancez la requête RDV v7.`;
    J.crit('import', 'Import refusé', `« ${name} » (export Isadom) : colonnes absentes, relancer la requête RDV v7`, { absentes: missing.join(', ') });
    return;
  }
  const created = [];
  const ensureType = (code) => {
    if (typeOf(code)) return;
    const def = ISADOM_TYPES.find((t) => t[0] === code);
    const t = { code, nom: def ? def[1] : code + ' (Isadom)', duree: def ? def[2] : DUREE_TYPE_DEFAUT, o2: false };
    p.types.push(t); created.push(Object.assign({ connu: !!def }, t));
  };
  const errs = []; const warns = []; const seen = new Map(); const dates = new Set(); const geoRejet = [];
  J.info('import', 'Début de l’intégration', `« ${name} » · export Isadom (requête RDV v7) · ${rows.length - 1} ligne${rows.length > 2 ? 's' : ''} de données`);
  rows.slice(1).forEach((r, k) => {
    const get = (c) => { const i = col(c); const v = i >= 0 ? (r[i] || '').trim() : ''; return /^null$/i.test(v) ? '' : v; };
    const line = k + 2; const pb = [];
    const id = get('idrdv'); if (!id) pb.push('IdRdv vide');
    const date = parseDate(get('daterdv').slice(0, 10)); if (!date) pb.push('date invalide « ' + get('daterdv') + ' »');
    let cp = get('cp').replace(/\s/g, ''); if (/^\d{4}$/.test(cp)) cp = '0' + cp;
    if (!/^\d{5}$/.test(cp)) pb.push('code postal invalide « ' + get('cp') + ' »');
    const ville = get('ville'); if (!ville) pb.push('ville vide');
    if (pb.length) { errs.push(`Ligne ${line} : ${pb.join(', ')}`); return; }
    const hDeb = hhmm(get('heuredebut')), hFin = hhmm(get('heurefin'));
    if (!hDeb || !hFin) warns.push(`RDV ${id} (${frDate(date)}) : heures non renseignées, créneau « Journée » appliqué`);
    const types = [...new Set(get('typevisite').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (!types.length) { types.push('INCONNU'); warns.push(`RDV ${id} (${frDate(date)}) : aucun type de visite, durée par défaut appliquée`); }
    types.forEach(ensureType);
    const rd = {
      idRdv: id, besoin: get('typebesoin'), date, hDeb, hFin, cren: crenFromIsadom(get('demijournee'), hDeb, hFin),
      // NOM Prénom seul : le code patient a sa propre colonne ; patientLib() les réunit hors de la planification
      patient: [get('patientnom'), get('patientprenom')].filter(Boolean).join(' ') || 'Patient',
      patientCode: get('patientcode'), cp, ville,
      adresse: [get('numerovoie'), get('typevoie'), get('voie')].filter(Boolean).join(' ').replace(/\s+/g, ' '),
      type: types[0], types, typeVisite: get('typevisite'), typePrestation: get('typeprestation'), infoRdv: get('infordv'), amdActuel: get('amdnom'), amdCode: get('amdcode'), antenne: get('antenne'), secteur: get('secteurlibelle'),
      acces: { tel1: get('telfixe'), tel2: get('telautre'), batiment: get('batiment'), etage: get('etage'), porte: get('porte'), interphone: get('interphone'), info: get('infoadresse') }
    };
    const g = isadomGeo(get); if (g) rd.geo = g; else if (get('lat') || get('w3wlat')) geoRejet.push(id);
    seen.set(id, rd); dates.add(date);
  });
  // fusion : un RDV déjà connu (même IdRdv) est remplacé ; un RDV Isadom d'une date couverte par le fichier
  // mais absent du fichier est retiré (annulé ou déplacé dans Isadom). Les RDV saisis à la main sont conservés.
  let updated = 0, removed = 0;
  const keep = state.rdv.filter((r) => {
    if (r.idRdv && seen.has(r.idRdv)) { updated++; return false; }
    if (r.idRdv && dates.has(r.date)) { removed++; return false; }
    return true;
  });
  state.rdv = keep.concat([...seen.values()]);
  const added = seen.size - updated;
  // AMD : renseigne le code Isadom des AMD reconnus par leur nom ; liste ceux qui sont absents
  const amdSeen = new Map(); seen.forEach((rd) => { if (rd.amdCode) amdSeen.set(rd.amdCode, rd.amdActuel); });
  amdSeen.forEach((nom, code) => {
    if (state.amd.some((a) => String(a.code || '').trim() === code)) return;
    const cand = state.amd.filter((a) => !a.code && sameAmd(nom, a));
    if (cand.length === 1) cand[0].code = code;
  });
  const unknownAmd = [...amdSeen].filter(([code]) => !state.amd.some((a) => String(a.code || '').trim() === code));
  // AMD proposés à l'ajout : point de départ = antenne la plus fréquente de leurs RDV
  pendingAmd = unknownAmd.map(([code, nom]) => {
    const cnt = new Map();
    seen.forEach((rd) => { if (rd.amdCode === code) { const d = depotOfAntenne(rd.antenne); if (d) cnt.set(d.id, (cnt.get(d.id) || 0) + 1); } });
    const depot = [...cnt].sort((a, b) => b[1] - a[1])[0];
    return { code, nom, depot: depot ? depot[0] : (p.depots.find((x) => x.actif) || p.depots[0]).id, dispo: 'journee', hmax: p.hmax, kmmax: p.kmmax, actif: true };
  });
  const outScope = [...seen.values()].filter((rd) => !rdvInScope(rd)).length;
  const noGeo = [...seen.values()].filter((rd) => !rd.geo).length;
  const multi = [...seen.values()].filter((rd) => rd.types.length > 1).length;

  const li = (x) => '<li>' + x + '</li>';
  const info = [
    `${added} nouveau${added > 1 ? 'x' : ''}, ${updated} mis à jour, ${removed} retiré${removed > 1 ? 's' : ''} (absent${removed > 1 ? 's' : ''} du nouvel export)`,
    `${seen.size - noGeo} localisé${seen.size - noGeo > 1 ? 's' : ''} par les coordonnées Isadom · ${noGeo} à géocoder par l'adresse`,
    geoRejet.length ? `${geoRejet.length} RDV avec des coordonnées Isadom hors PACA / Corse (erreur de saisie ou patient hors zone) : regéocodés par l'adresse, écartés si toujours hors zone — RDV ${geoRejet.map(esc).join(', ')}` : '',
    `${multi} RDV à plusieurs types de visite : durée = somme × ${p.multiCoef} %`,
    outScope ? `${outScope} RDV sur des antennes hors test (non optimisés tant que l'antenne n'est pas incluse dans les paramètres)` : '',
    created.length ? `${created.length} type${created.length > 1 ? 's' : ''} de visite ajouté${created.length > 1 ? 's' : ''} aux paramètres : ${created.map((t) => `<code>${esc(t.code)}</code> ${t.duree} min`).join(', ')}` : '',
    unknownAmd.length ? `${unknownAmd.length} AMD absent${unknownAmd.length > 1 ? 's' : ''} de la liste (leurs RDV ne pourront pas être placés) : ${unknownAmd.map(([c, n]) => esc(n) + ' <span class="mono">(' + esc(c) + ')</span>').join(', ')} <button class="btn2" id="amd-from-isadom" type="button">Ajouter ${unknownAmd.length > 1 ? 'ces AMD' : 'cet AMD'}</button>` : ''
  ].filter(Boolean);
  const all = errs.concat(warns);
  logLines(name, errs, warns);
  created.forEach((t) => (t.connu
    ? J.info('import', 'Type de visite ajouté', `${t.code} · ${t.nom} : ${t.duree} min (durée métier Isadom)`, 'Fichier : ' + name)
    : J.warn('import', 'Type de visite inconnu ajouté', `${t.code} ajouté aux paramètres avec ${t.duree} min par défaut`, 'Durée à confirmer dans les paramètres · fichier : ' + name)));
  if (unknownAmd.length) J.warn('import', 'AMD inconnus', `${unknownAmd.length} AMD absent${unknownAmd.length > 1 ? 's' : ''} de la liste : leurs RDV ne pourront pas être placés`, unknownAmd.map(([c, n]) => `${n} (${c})`));
  if (outScope) J.info('import', 'RDV hors test', `${outScope} RDV sur des antennes non incluses dans le test`);
  if (geoRejet.length) J.warn('import', 'Coordonnées hors zone', `${geoRejet.length} RDV avec des coordonnées Isadom hors PACA / Corse : regéocodés par l'adresse`, geoRejet.map((id) => 'RDV ' + id));
  if (removed) J.info('import', 'RDV retirés', `${removed} RDV absent${removed > 1 ? 's' : ''} du nouvel export (annulés ou déplacés dans Isadom)`);
  J.log(seen.size ? (errs.length || warns.length ? 'warn' : 'info') : 'crit', 'import', 'Fin de l’intégration',
    `« ${name} » : ${seen.size} RDV sur ${dates.size} jour${dates.size > 1 ? 's' : ''} · ${added} nouveau${added > 1 ? 'x' : ''}, ${updated} mis à jour, ${removed} retiré${removed > 1 ? 's' : ''}`,
    { lignes_ignorees: errs.length, avertissements: warns.length, a_geocoder: noGeo, multi_types: multi });
  save();
  rep.hidden = false; rep.className = errs.length ? 'warn' : 'ok';
  rep.innerHTML = `<b>${esc(name)}</b> (export Isadom) : ${seen.size} RDV importé${seen.size > 1 ? 's' : ''} sur ${dates.size} jour${dates.size > 1 ? 's' : ''}${errs.length ? `, ${errs.length} ligne${errs.length > 1 ? 's' : ''} ignorée${errs.length > 1 ? 's' : ''}` : ''}.`
    + '<ul>' + info.map(li).join('') + '</ul>'
    + (all.length ? '<ul>' + all.slice(0, 30).map((x) => li(esc(x))).join('') + (all.length > 30 ? li('…') : '') + '</ul>' : '');
  if (seen.size && !state.rdv.some((r) => r.date === state.date)) state.date = [...dates].sort()[0];
  save(); renderPlan();
  // localise tout de suite les RDV sans coordonnées Isadom, pour signaler dès l'import ceux qui seront écartés
  const toGeo = [...seen.values()].filter((rd) => aGeocoder(rd) && rdvInScope(rd));
  if (toGeo.length) {
    const st = document.createElement('p'); st.className = 'hint'; st.textContent = `Localisation de ${toGeo.length} adresse${toGeo.length > 1 ? 's' : ''} sans coordonnées Isadom…`;
    rep.appendChild(st);
    pool(toGeo, geocodeRdv).catch((e) => console.error(e)).then(() => {
      const nKo = toGeo.filter((rd) => !inZone(rd.geo)).length;
      st.textContent = `${toGeo.length} adresse${toGeo.length > 1 ? 's' : ''} localisée${toGeo.length > 1 ? 's' : ''} par géocodage` + (nKo ? ` · ${nKo} introuvable${nKo > 1 ? 's' : ''} ou hors zone : voir « RDV qui ne pourront pas être optimisés » en haut de page.` : '.');
      save(); renderPlan();
    });
  }
}

/* ---------- optimisation ---------- */
function vehicleWindow(a, p) {
  if (a.dispo === 'matin') return [hm2s(p.ampDeb), hm2s(p.pauseDeb)];
  if (a.dispo === 'am') return [hm2s(p.pauseDeb) + p.pauseDuree * 60, hm2s(p.ampFin)];
  return [hm2s(p.ampDeb), hm2s(p.ampFin)];
}
const sameAmd = (name, a) => { const n = norm(name); const m = norm(a.nom); return !!n && (m === n || m.startsWith(n + ' ') || m.includes(n)); };
/* AMD actuel d'un RDV : par code Isadom quand les deux sont connus, sinon par le nom */
const amdMatch = (rd, a) => (rd.amdCode && a.code ? String(a.code).trim() === String(rd.amdCode).trim() : sameAmd(rd.amdActuel, a));
/* Mode « AMD bloqué » (par défaut) : chaque RDV reste chez l'AMD affecté dans Isadom, VROOM ne calcule que l'ordre de passage.
   Compétence VROOM 100 + i = AMD n° i. Les RDV sans AMD prévu sont retirés avant le calcul (R.horsAmd, compte rendu seul) ;
   SKILL_SANS_AMD, qu'aucun véhicule ne possède, reste une sécurité : VROOM ne donne jamais un RDV à un collègue. */
const SKILL_SANS_AMD = 99;
const MOTIFS_AMD = {
  aucun: 'aucun AMD prévu dans Isadom',
  inconnu: 'AMD prévu inconnu de la liste des AMD',
  absent: 'AMD prévu absent ce jour',
  indispo: 'AMD prévu inactif ou rattaché à une antenne hors test'
};
/* AMD d'un RDV parmi les AMD disponibles : { idx } (index dans amds) ou { idx: -1, motif } */
function amdDuRdv(rd, amds) {
  if (!String(rd.amdActuel || '').trim() && !String(rd.amdCode || '').trim()) return { idx: -1, motif: MOTIFS_AMD.aucun };
  const idx = amds.findIndex((a) => amdMatch(rd, a));
  if (idx >= 0) return { idx };
  const tous = state.amd.find((a) => amdMatch(rd, a));
  if (!tous) return { idx: -1, motif: MOTIFS_AMD.inconnu };
  return { idx: -1, motif: tous.dispo === 'absent' ? MOTIFS_AMD.absent : MOTIFS_AMD.indispo };
}

async function optimize() {
  const onResult = location.hash === '#resultat';
  const msg = onResult ? '#r-msg' : '#pl-msg';
  const btn = onResult ? $('#r-opt') : $('#pl-go'); const p = state.params;
  // une seule journée à la fois (POC) : la cible est la date affichée dans « Date planifiée »
  if (!onResult) {
    const iso = parseDate($('#pl-date').value);
    if (!iso) { alertMsg(msg, 'Date planifiée invalide : saisir une date au format jj/mm/aaaa.', 'err'); $('#pl-date').focus(); return; }
    if (iso !== state.date) { J.info('action', 'Date planifiée changée', frDate(iso)); state.date = iso; save(); renderPlan(); }
  }
  const day = state.rdv.filter((r) => r.date === state.date && rdvInScope(r));
  if (!day.length) { alertMsg(msg, `Aucun RDV le ${frDate(state.date)} sur les antennes incluses dans le test.`, 'err'); J.warn('optimisation', 'Optimisation impossible', `Aucun RDV le ${frDate(state.date)} sur les antennes incluses dans le test`); return; }
  // antenne du jour : celle de la majorité des RDV Isadom de l'AMD ce jour-là (un AMD peut renforcer une autre antenne), sinon son point de départ habituel
  const depotDuJour = (a) => {
    const cnt = new Map();
    day.forEach((rd) => { if (amdMatch(rd, a)) { const d = depotOfAntenne(rd.antenne); if (d && d.actif) cnt.set(d.id, (cnt.get(d.id) || 0) + 1); } });
    let best = a.depot, n = 0;
    cnt.forEach((v, id) => { if (v > n || (v === n && id === a.depot)) { best = id; n = v; } });
    return best;
  };
  const amds = state.amd.filter((a) => amdActif(a) && a.dispo !== 'absent')
    .map((a) => { const dj = depotDuJour(a); return dj === a.depot ? a : Object.assign(clone(a), { depot: dj, depotHabituel: a.depot }); })
    .filter((a) => depotOf(a.depot) && depotOf(a.depot).actif);
  if (!amds.length) { alertMsg(msg, 'Aucun AMD actif et disponible partant d’un point de départ inclus dans le test.', 'err'); J.warn('optimisation', 'Optimisation impossible', `Aucun AMD disponible le ${frDate(state.date)} sur les antennes du test`); return; }
  // RDV affectés dans Isadom à un AMD non prévu (inactif, absent, inconnu, sans AMD) : hors optimisation, signalés dans le compte rendu
  const horsAmd = [];
  for (let k = day.length - 1; k >= 0; k--) {
    const m = amdDuRdv(day[k], amds);
    if (m.idx < 0) horsAmd.unshift(Object.assign(clone(day.splice(k, 1)[0]), { motifAmd: m.motif }));
  }
  if (!day.length) { alertMsg(msg, `Les ${horsAmd.length} RDV du ${frDate(state.date)} sont affectés à des AMD non prévus (inactifs, absents ou inconnus) : rien à optimiser.`, 'err'); J.warn('optimisation', 'Optimisation impossible', `Journée du ${frDate(state.date)} : aucun RDV sur un AMD prévu`, horsAmd.map((r) => `${rdvRef(r)} · AMD ${r.amdActuel || '—'} · ${r.motifAmd}`)); return; }
  J.info('optimisation', 'Optimisation lancée', `Journée du ${frDate(state.date)} · ${day.length} RDV · ${amds.length} AMD`);
  if (horsAmd.length) J.warn('optimisation', 'RDV sur des AMD non prévus', `${horsAmd.length} RDV du ${frDate(state.date)} hors optimisation : leur AMD Isadom n'est pas prévu`, horsAmd.map((r) => `${rdvRef(r)} · AMD ${r.amdActuel || '—'} · ${r.motifAmd}`));
  const t0 = Date.now();
  if (btn) btn.disabled = true;
  try {
    alertMsg(msg, 'Localisation des adresses…');
    const deps = [...new Set(amds.map((a) => a.depot))].map(depotOf).filter((d) => !d.geo || d.geo.none);
    await pool(deps, geocodeDepot);
    // coordonnées déjà connues mais hors zone (import antérieur) : on retente par l'adresse
    day.forEach((r) => { if (r.geo && !r.geo.none && !inZone(r.geo)) delete r.geo; });
    await pool(day.filter(aGeocoder), geocodeRdv);
    save(); renderPlan();
    const badDep = amds.filter((a) => depotOf(a.depot).geo.none);
    if (badDep.length) throw new Error('Adresse introuvable pour : ' + [...new Set(badDep.map((a) => depotOf(a.depot).nom))].join(', ') + '. Corrigez-la dans les paramètres.');
    const jobsR = day.filter((r) => inZone(r.geo));
    const excluded = day.filter((r) => !inZone(r.geo)).map((r) => Object.assign(clone(r), { motif: motifGeo(r) }));
    if (excluded.length) J.warn('optimisation', 'RDV écartés du calcul', `${excluded.length} RDV écarté${excluded.length > 1 ? 's' : ''} de l'optimisation du ${frDate(state.date)} (adresse introuvable, localisée à la commune seulement ou hors carte)`, excluded.map((r) => `${rdvRef(r)} · ${r.cp} ${r.ville} · ${r.motif}`));
    const badType = jobsR.filter((r) => rdvTypes(r).some((c) => !typeOf(c)));
    if (badType.length) throw new Error('Type d’intervention inconnu pour ' + badType.map((r) => esc(patientLib(r))).join(', '));

    alertMsg(msg, 'Calcul des tournées…');
    const sf = 1 / (1 + (Number(p.coef) || 0) / 100);
    const vehicles = amds.map((a, i) => {
      const d = depotOf(a.depot); const loc = [d.geo.lon, d.geo.lat];
      const v = {
        id: i + 1, description: a.nom, profile: 'car', start: loc, end: loc,
        time_window: vehicleWindow(a, p), speed_factor: Math.min(5, Math.max(0.2, sf)),
        skills: [100 + i] // AMD bloqué : ne reçoit que ses propres RDV
      };
      if (a.hmax > 0) v.max_travel_time = Math.round(a.hmax * 3600);
      if (a.kmmax > 0) v.max_distance = Math.round(a.kmmax * 1000);
      if (a.dispo === 'journee' && p.pauseDuree > 0) {
        v.breaks = [{ id: i + 1, description: 'Pause', time_windows: [[hm2s(p.pauseDeb), Math.max(hm2s(p.pauseDeb), hm2s(p.pauseFin) - p.pauseDuree * 60)]], service: p.pauseDuree * 60 }];
      }
      return v;
    });
    const buildJobs = () => jobsR.map((r, j) => {
      const { idx } = amdDuRdv(r, amds);
      return {
        id: j + 1, description: r.patient, location: [r.geo.lon, r.geo.lat],
        setup: p.stationnement * 60, service: rdvDuree(r, p) * 60,
        time_windows: [rdvWindow(r, p)], skills: [idx >= 0 ? 100 + idx : SKILL_SANS_AMD]
      };
    });
    // RDV d'un même patient chez le même AMD à la même adresse : un seul job VROOM, pour qu'ils se suivent
    const cleGroupe = (r) => { const pat = String(r.patientCode || r.patient || '').trim().toUpperCase(); return pat ? amdDuRdv(r, amds).idx + '|' + pat : ''; };
    let req, res, jobs, groupes;
    // un RDV qu'OSRM ne sait pas rejoindre fait échouer tout le calcul : on l'écarte et on relance
    for (let essai = 0; ; essai++) {
      jobs = buildJobs();
      groupes = OptiRegroupe.grouper(jobsR.map((r, j) => ({ cle: cleGroupe(r), lon: r.geo.lon, lat: r.geo.lat, fenetre: jobs[j].time_windows[0] })));
      req = { vehicles, jobs: OptiRegroupe.fusionnerJobs(jobs, groupes), options: { g: true } };
      try { res = OptiRegroupe.eclaterReponse(await callVroom(req), jobs, groupes); break; } catch (e) {
        const m = /near location \[(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(e.message || '');
        const lon = m && Number(m[1]), lat = m && Number(m[2]);
        const bad = m ? jobsR.filter((r) => Math.abs(r.geo.lon - lon) < 1e-5 && Math.abs(r.geo.lat - lat) < 1e-5) : [];
        if (!bad.length || essai >= 20) throw e;
        bad.forEach((r) => { jobsR.splice(jobsR.indexOf(r), 1); excluded.push(Object.assign(clone(r), { motif: 'aucune route depuis la carte (point isolé ou hors zone)' })); });
        alertMsg(msg, `Calcul des tournées… (${excluded.length} RDV écarté${excluded.length > 1 ? 's' : ''})`);
      }
    }

    // l'AMD retenu (ou le motif d'impossibilité) accompagne chaque RDV du résultat
    const rdvR = jobsR.map((r) => { const m = amdDuRdv(r, amds); return Object.assign(clone(r), { amdIdx: m.idx, motifAmd: m.motif || '' }); });
    // plus de 2e calcul « répartition libre » : le résultat retenu (envoyé à MJ2) respecte les affectations Isadom
    state.results[state.date] = { date: state.date, at: new Date().toISOString(), mode: 'amd-bloque', amds: clone(amds), rdv: rdvR, excluded: clone(excluded), horsAmd, res, resAct: null, cmp: null };
    save();
    J.info('optimisation', 'Optimisation terminée', `Journée du ${frDate(state.date)} : ${res.routes.length} AMD mobilisé${res.routes.length > 1 ? 's' : ''} · ${fmtKm(res.summary.distance)} · ${fmtDur(res.summary.duration)} de conduite`,
      { mode: 'AMD bloqué (affectations Isadom conservées)', duree_calcul: ((Date.now() - t0) / 1000).toFixed(1) + ' s', rdv_planifies: jobsR.length - res.unassigned.length });
    if (res.unassigned.length) {
      const why = motifNonAffecte(state.results[state.date]);
      J.warn('optimisation', 'RDV non tenus par leur AMD', `${res.unassigned.length} RDV ne peu${res.unassigned.length > 1 ? 'vent' : 't'} pas être tenu${res.unassigned.length > 1 ? 's' : ''} par leur AMD le ${frDate(state.date)} : à reprendre dans Isadom`,
        res.unassigned.map((u) => { const rd = rdvR[u.id - 1]; return `${rdvRef(rd)} · AMD ${rd.amdActuel || '—'} · ${why(rd)}`; }));
    }
    alertMsg(msg, '');
    if (onResult) renderResult(); else location.hash = '#resultat';
    openStats();
  } catch (err) {
    console.error(err);
    J.crit('optimisation', 'Échec de l’optimisation', `Journée du ${frDate(state.date)} : ${err.message || err}`);
    alertMsg(msg, esc(err.message || String(err)), 'err');
  } finally { if (btn) btn.disabled = false; }
}
async function callVroom(req) {
  let r;
  try {
    r = await fetch('/vroom/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  } catch (e) { throw new Error('VROOM ne répond pas. Vérifiez que les conteneurs tournent (docker compose ps).'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== 0) throw new Error('Erreur VROOM' + (j.error ? ' : ' + j.error : ' (HTTP ' + r.status + ')'));
  return j;
}
function summarize(res) {
  return { distance: res.summary.distance || 0, duration: res.summary.duration || 0, routes: res.routes.length, unassigned: res.unassigned.length };
}
function sumRoutes(res, keepJobs) {
  // indicateurs de la solution optimisée, restreints aux RDV qui ont un AMD actuel (comparaison à périmètre égal si tous en ont un)
  const s = summarize(res);
  s.unassigned = res.unassigned.filter((u) => keepJobs.has(u.id)).length;
  return s;
}

/* ---------- 3. résultat ---------- */
let mapR, layerR, mapT, layerT;
function decodePolyline(str) {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    let b, s = 0, r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lat += r & 1 ? ~(r >> 1) : r >> 1; s = 0; r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
/* journées navigables : toutes celles qui ont des RDV ou un résultat */
function resultDays() {
  return [...new Set(state.rdv.map((r) => r.date).concat(Object.keys(state.results)))].filter(Boolean).sort();
}
function gotoDay(step) {
  const days = resultDays(); if (!days.length) return;
  const i = days.indexOf(state.date);
  const j = i < 0 ? (step > 0 ? days.findIndex((d) => d > state.date) : days.length - 1 - [...days].reverse().findIndex((d) => d < state.date)) : i + step;
  if (j < 0 || j >= days.length || !days[j]) return;
  state.date = days[j]; save(); alertMsg('#r-msg', ''); renderResult();
}
function renderDayNav() {
  const days = resultDays(); const i = days.indexOf(state.date);
  $('#r-prev').disabled = !days.length || (i < 0 ? !days.some((d) => d < state.date) : i === 0);
  $('#r-next').disabled = !days.length || (i < 0 ? !days.some((d) => d > state.date) : i === days.length - 1);
  $('#r-pos').textContent = days.length > 1 && i >= 0 ? `Journée ${i + 1} / ${days.length}` : '';
}
function clearResult() {
  renderAlerteNonTenus(null, []);
  $('#r-routes').innerHTML = ''; $('#r-compare').hidden = true; unRows = null; renderUnassigned();
  if (layerR) { layerR.remove(); layerR = null; }
}
function renderResult() {
  if (!state.date) state.date = nextWorkday();
  renderDayNav();
  const R = state.results[state.date];
  const box = $('#r-routes');
  $('#r-opt-zone').hidden = !!R;
  $('#r-csv').disabled = $('#r-print').disabled = $('#r-stats').disabled = !R;
  if (!R) {
    const n = state.rdv.filter((r) => r.date === state.date).length;
    $('#r-titre').textContent = 'Tournées · ' + longDate(state.date);
    $('#r-sub').textContent = n ? `Journée non optimisée · ${n} RDV prévu${n > 1 ? 's' : ''}.` : 'Aucun RDV ce jour. Préparez la journée à l’écran Planification.';
    $('#r-opt').hidden = !n;
    $('#r-ecartes').hidden = true;
    clearResult();
    if (mapR) setTimeout(() => mapR.invalidateSize(), 50);
    appBus.dispatchEvent(new CustomEvent('render'));
    return;
  }
  const res = R.res;
  const ex = R.excluded || [];
  $('#r-ecartes').hidden = !ex.length;
  $('#c-ecartes').textContent = ex.length ? '· ' + ex.length : '';
  $('#t-ecartes').innerHTML = ecartesRows(ex.map((rd) => Object.assign({}, rd, { motif: rd.motif || 'adresse introuvable' })));
  $('#r-titre').textContent = 'Tournées optimisées · ' + longDate(R.date);
  const used = res.routes.length;
  $('#r-sub').textContent = `${R.rdv.length + R.excluded.length} RDV${R.excluded.length ? ` (dont ${R.excluded.length} écarté${R.excluded.length > 1 ? 's' : ''} du calcul)` : ''} · ${R.amds.length} AMD disponibles · ${used} AMD mobilisé${used > 1 ? 's' : ''} · ${fmtKm(res.summary.distance)} · ${fmtDur(res.summary.duration)} de conduite`;

  // comparaison
  if (R.cmp) {
    const a = R.cmp.act, o = R.cmp.opt;
    const pct = (x, y) => (x ? Math.round(((y - x) / x) * 100) : 0);
    const sign = (n, unit) => (n > 0 ? '+ ' : n < 0 ? '− ' : '') + Math.abs(n) + unit;
    const dMin = Math.round((o.duration - a.duration) / 60);
    $('#t-compare').innerHTML = [
      ['Kilomètres totaux', fmtKm(a.distance), fmtKm(o.distance), sign(pct(a.distance, o.distance), ' %')],
      ['Temps de conduite total', fmtDur(a.duration), fmtDur(o.duration), sign(dMin, ' min')],
      ['AMD mobilisés', a.routes, o.routes, sign(o.routes - a.routes, '')],
      ['RDV impossibles à tenir', a.unassigned, o.unassigned, sign(o.unassigned - a.unassigned, '')]
    ].map((r) => `<tr><td>${r[0]}</td><td class="num mono">${r[1]}</td><td class="num mono"><b>${r[2]}</b></td><td class="num mono">${r[3]}</td></tr>`).join('');
    $('#r-compare').hidden = false;
    if (R.cmp.n < R.cmp.total) $('#t-compare').insertAdjacentHTML('beforeend', `<tr><td colspan="4" class="hint">Comparaison partielle : ${R.cmp.n} RDV sur ${R.cmp.total} ont un AMD actuel reconnu. Les totaux optimisés portent sur tous les RDV.</td></tr>`);
  } else $('#r-compare').hidden = true;

  // alerte : RDV que VROOM ne peut pas placer chez leur AMD (mode « AMD bloqué »)
  const nonTenus = res.unassigned.map((u) => R.rdv[u.id - 1]).filter(Boolean);
  renderAlerteNonTenus(R, nonTenus);

  // tournées
  box.innerHTML = R.amds.map((a, i) => {
    const vid = i + 1; const col = COLORS[i % COLORS.length];
    const r = res.routes.find((x) => x.vehicle === vid);
    const d = depotOf(a.depot) || { nom: a.depot };
    const dLib = esc(d.nom) + (a.depotHabituel ? ` <span class="hint">(en renfort, habituellement ${esc((depotOf(a.depotHabituel) || { nom: a.depotHabituel }).nom)})</span>` : '');
    const nNonTenus = nonTenus.filter((rd) => rd.amdIdx === i).length;
    const nonTenusHtml = nNonTenus ? `<span class="over" title="RDV de cet AMD impossibles à placer : voir « RDV non affectés »">⚠ ${nNonTenus} non tenu${nNonTenus > 1 ? 's' : ''}</span>` : '';
    if (!r) return `<section class="route"><div class="route-h"><div class="who"><span class="dot" style="background:${col}"></span><b>${esc(a.nom)}</b><span>${dLib}</span></div><div class="tot mono"><span>0 RDV</span>${nonTenusHtml}</div></div><div class="empty">${nNonTenus ? 'Aucun RDV ne tient dans la journée de cet AMD : voir « RDV non affectés ».' : 'Aucun RDV prévu pour cet AMD.'}</div></section>`;
    const jobsN = r.steps.filter((s) => s.type === 'job').length;
    const kmOver = a.kmmax > 0 && r.distance > a.kmmax * 1000;
    const hOver = a.hmax > 0 && r.duration > a.hmax * 3600;
    const start = r.steps[0], end = r.steps[r.steps.length - 1];
    let n = 0;
    const li = r.steps.map((s) => {
      if (s.type === 'start') return `<li class="aux"><span class="n">⌂</span><span class="t">${s2hm(s.arrival)}</span><span>Départ ${esc(d.nom)}</span><span></span></li>`;
      if (s.type === 'end') return `<li class="aux"><span class="n">⌂</span><span class="t">${s2hm(s.arrival)}</span><span>Retour ${esc(d.nom)}</span><span></span></li>`;
      if (s.type === 'break') return `<li class="aux"><span class="n">‖</span><span class="t">${s2hm(s.arrival + (s.waiting_time || 0))}</span><span>Pause déjeuner · ${Math.round(s.service / 60)} min</span><span></span></li>`;
      if (s.type !== 'job') return '';
      n++; const rd = R.rdv[s.job - 1]; const c = crenOf(rd.cren);
      const wait = s.waiting_time > 60 ? ` · attente ${Math.round(s.waiting_time / 60)} min` : '';
      const inf = infoTitle(rd);
      return `<li class="pick" data-job="${s.job}" tabindex="0" title="Voir sur la carte"><span class="n" style="background:${col}">${n}</span><span class="t">${s2hm(s.arrival)}</span>
        <span><b>${esc(patientLib(rd))}</b> <span class="w">· ${esc(rd.ville)} · </span>${rdvTypeHtml(rd)}<span class="w">${rd.adresse ? ' · ' + esc(rd.adresse) : ''}${wait}</span>${rdvVisitePrest(rd) ? `<div class="hint mono">Visite | Prestation : ${esc(rdvVisitePrest(rd))}</div>` : ''}${rd.infoRdv ? `<div class="hint">Info RDV : ${esc(rd.infoRdv)}</div>` : ''}${inf ? `<details class="infos"><summary>Infos d'accès</summary>${rdvInfos(rd).map(([k, v]) => `<div><span class="hint">${esc(k)}</span> ${esc(v)}</div>`).join('')}</details>` : ''}</span>
        <span class="badge ${c.badge}" title="${esc(rdvWindowLabel(rd))}">${rd.hDeb ? esc(rd.hDeb + '–' + rd.hFin) : c.nom}</span></li>`;
    }).join('');
    return `<section class="route"><div class="route-h"><div class="who"><span class="dot" style="background:${col}"></span><b>${esc(a.nom)}</b><span>${dLib}</span></div>
      <div class="tot mono"><span>${jobsN} RDV</span>${nonTenusHtml}<span class="${kmOver ? 'over' : ''}">${fmtKm(r.distance)}${a.kmmax ? ' / ' + a.kmmax + ' km' : ''}</span><span class="${hOver ? 'over' : ''}">${fmtDur(r.duration)}${a.hmax ? ' / ' + a.hmax + ' h' : ''} conduite</span><span>${s2hm(start.arrival)}–${s2hm(end.arrival)}</span><button class="btn2 small" type="button" data-csv-amd="${i}" title="Exporter l'ordre de passage de ${esc(a.nom)} (CSV) pour le comparer à l'existant">CSV</button></div></div>
      <ol class="steps">${li}</ol></section>`;
  }).join('');

  // non affectés
  const why = motifNonAffecte(R);
  unRows = res.unassigned.map((u) => ({ rd: R.rdv[u.id - 1], job: u.id, why: why(R.rdv[u.id - 1]) }));
  renderUnassigned();

  drawResultMap(R);
  appBus.dispatchEvent(new CustomEvent('render'));
}
/* bandeau d'alerte en haut de l'écran Résultat : les RDV non tenus ne doivent pas passer inaperçus */
function renderAlerteNonTenus(R, nonTenus) {
  const el = $('#r-alerte'); if (!el) return;
  if (!R || !nonTenus.length) { el.hidden = true; el.innerHTML = ''; return; }
  const n = nonTenus.length; const why = motifNonAffecte(R);
  const parAmd = new Map();
  nonTenus.forEach((rd) => { const k = rd.amdActuel || '(sans AMD)'; parAmd.set(k, (parAmd.get(k) || 0) + 1); });
  const parMotif = new Map();
  nonTenus.forEach((rd) => { const m = why(rd); parMotif.set(m, (parMotif.get(m) || 0) + 1); });
  const titre = R.mode === 'amd-bloque'
    ? `⚠ ${n} RDV ne peu${n > 1 ? 'vent' : 't'} pas être tenu${n > 1 ? 's' : ''} par leur AMD Isadom`
    : `⚠ ${n} RDV non affecté${n > 1 ? 's' : ''}`;
  el.className = 'msg err';
  el.innerHTML = `<b>${titre}</b> — ${n > 1 ? 'ils ne figurent' : 'il ne figure'} dans aucune tournée. À reprendre dans Isadom (changer d'AMD, de créneau ou de jour), puis rafraîchir et relancer l'optimisation.
    <div class="hint">Par AMD : ${[...parAmd].map(([k, v]) => `${esc(k)} (${v})`).join(' · ')}</div>
    <div class="hint">Motifs : ${[...parMotif].map(([k, v]) => `${esc(k)} (${v})`).join(' · ')}</div>
    <a href="#r-unassigned" class="noprint" data-voir-non-tenus>Voir la liste détaillée</a>`;
  el.hidden = false;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-voir-non-tenus]'); if (!a) return;
  e.preventDefault(); const t = $('#r-unassigned'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
/* motif d'un RDV que VROOM n'a pas pu placer (la réponse VROOM n'en donne pas) */
const motifNonAffecte = (R) => (rd) => {
  const c = rdvWindow(rd);
  if (R.mode === 'amd-bloque') {
    if (rd.motifAmd) return rd.motifAmd;
    const a = R.amds[rd.amdIdx];
    if (!a) return MOTIFS_AMD.inconnu;
    const w = vehicleWindow(a, state.params);
    if (!(w[0] < c[1] && w[1] > c[0])) return 'créneau hors des heures de travail de l’AMD';
    return 'tournée de l’AMD saturée : créneau, heures ou km max dépassés';
  }
  // résultats calculés avant le mode « AMD bloqué » (répartition libre)
  if (!R.amds.some((a) => { const w = vehicleWindow(a, state.params); return w[0] < c[1] && w[1] > c[0]; })) return 'aucun AMD disponible sur ce créneau';
  return 'créneau, heures ou km max trop serrés';
};

/* ---------- stats d'optimisation : compte rendu de la journée affichée ---------- */
let statsCour = null; // { R, S } du compte rendu ouvert, pour l'export CSV
function openStats() {
  const R = state.results[state.date]; const dlg = $('#dlg-stats');
  if (!R || !window.OptiStats || !dlg) return;
  const S = window.OptiStats.computeStats(R, { typesOf: rdvTypes, motifNonAffecte: motifNonAffecte(R) });
  const types = (l) => (l.length ? `<div class="st-types">${l.map((t) => `<span>${tvBadge(t.code)} ${t.n}</span>`).join('')}</div>` : '<span class="hint">—</span>');
  const kpi = (lib, val) => `<div><span>${lib}</span><b class="mono">${val}</b></div>`;
  $('#st-titre').textContent = "Compte rendu de l'import de la journée du " + frDate(S.date);
  $('#st-sub').textContent = `${longDate(S.date)} · optimisée le ${new Date(R.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}. Un RDV à plusieurs types de visite est compté dans chacun de ses types.`;
  $('#st-body').innerHTML = `<div class="st-kpis">${kpi('RDV à planifier', S.nRdv)}${kpi('AMD disponibles', S.nAmd)}${kpi('AMD mobilisés', S.nAmdMobilises)}${kpi('RDV planifiés', S.planifies)}${kpi('RDV non planifiés', S.nonPlanifies.total)}${S.horsAmd.total ? kpi('RDV sur AMD non prévus', S.horsAmd.total) : ''}${kpi('Kilométrage total', fmtKm(S.distance))}</div>
    <h3>RDV à planifier par type de visite</h3>
    <table class="tbl"><thead><tr><th>Type de visite</th><th class="num">RDV</th></tr></thead><tbody>
      ${S.parType.map((t) => `<tr><td>${tvBadge(t.code)} ${esc((typeOf(t.code) || {}).nom || '')}</td><td class="num mono">${t.n}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Aucun RDV.</td></tr>'}
    </tbody></table>
    <h3>Répartition par AMD</h3>
    <div class="scroll"><table class="tbl"><thead><tr><th>AMD</th><th>Antenne</th><th class="num">RDV</th><th>Types de visite</th><th class="num">Kilométrage</th><th class="num">Conduite</th></tr></thead><tbody>
      ${S.amd.map((a) => `<tr><td><b>${esc(a.nom)}</b>${a.code ? ` <span class="hint mono">${esc(a.code)}</span>` : ''}</td><td>${esc((depotOf(a.depot) || { nom: a.depot }).nom)}</td><td class="num mono">${a.n}</td><td>${types(a.parType)}</td><td class="num mono">${a.n ? fmtKm(a.distance) : '—'}</td><td class="num mono">${a.n ? fmtDur(a.duration) : '—'}</td></tr>`).join('')}
      <tr><td colspan="2"><b>Total</b></td><td class="num mono"><b>${S.planifies}</b></td><td></td><td class="num mono"><b>${fmtKm(S.distance)}</b></td><td class="num mono"><b>${fmtDur(S.duration)}</b></td></tr>
    </tbody></table></div>
    <h3>RDV non planifiés par motif · ${S.nonPlanifies.total}</h3>
    ${S.nonPlanifies.parMotif.map((m) => `<details class="st-motif"><summary><b>${esc(m.motif)}</b> · ${m.n} RDV <span class="hint">(voir le détail)</span></summary>
      <div class="scroll"><table class="tbl"><thead><tr><th>N° RDV</th><th>Code Pat.</th><th>Patient</th><th>CP</th><th>Ville</th><th>Type de visite</th><th>Créneau</th><th>AMD prévu</th><th>Étape</th></tr></thead><tbody>
        ${m.liste.map(({ rd, etape }) => `<tr><td class="mono gras">${esc(rd.idRdv || '')}</td><td class="mono">${esc(rd.patientCode || '')}</td><td>${esc(rd.patient)}</td><td class="mono">${esc(rd.cp)}</td><td>${esc(rd.ville || '?')}</td><td>${rdvTypeHtml(rd)}</td><td class="mono">${esc(rd.hDeb ? rd.hDeb + '–' + rd.hFin : crenOf(rd.cren).nom)}</td><td>${esc(rd.amdActuel)}</td><td class="hint">${esc(etape)}</td></tr>`).join('')}
      </tbody></table></div></details>`).join('') || '<p class="hint">Tous les RDV de la journée sont planifiés.</p>'}
    ${S.horsAmd.total ? `<h3>RDV sur des AMD non prévus · ${S.horsAmd.total}</h3>
    <p class="hint">Affectés dans Isadom à un AMD non retenu pour cette journée (inactif dans les paramètres, absent, inconnu ou non renseigné) : ils n'ont pas été optimisés. À reprendre dans Isadom ou en activant l'AMD.</p>
    ${S.horsAmd.parAmd.map((g) => `<details class="st-motif"><summary><b>${esc(g.amd || '(sans AMD)')}</b> · ${g.n} RDV · <span class="hint">${esc(g.motif)}</span></summary>
      <div class="scroll"><table class="tbl"><thead><tr><th>N° RDV</th><th>Code Pat.</th><th>Patient</th><th>CP</th><th>Ville</th><th>Type de visite</th><th>Créneau</th></tr></thead><tbody>
        ${g.liste.map((rd) => `<tr><td class="mono gras">${esc(rd.idRdv || '')}</td><td class="mono">${esc(rd.patientCode || '')}</td><td>${esc(rd.patient)}</td><td class="mono">${esc(rd.cp)}</td><td>${esc(rd.ville || '?')}</td><td>${rdvTypeHtml(rd)}</td><td class="mono">${esc(rd.hDeb ? rd.hDeb + '–' + rd.hFin : crenOf(rd.cren).nom)}</td></tr>`).join('')}
      </tbody></table></div></details>`).join('')}` : ''}`;
  statsCour = { R, S };
  if (!dlg.open) dlg.showModal();
  J.info('action', "Stats d'optimisation consultées", 'Journée du ' + frDate(S.date), { rdv: S.nRdv, amd: S.nAmd, non_planifies: S.nonPlanifies.total, amd_non_prevus: S.horsAmd.total });
}
/* export de tous les RDV du compte rendu : planifiés (AMD, ordre, heure) puis non planifiés (motif, étape) */
function exportStatsCsv() {
  if (!statsCour) return;
  const { R, S } = statsCour;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['date', 'id_rdv', 'code_patient', 'patient', 'code_postal', 'ville', 'types_visite', 'creneau', 'amd_prevu', 'statut', 'amd_optimise', 'ordre', 'heure_arrivee', 'motif', 'etape'].join(';')];
  const ligne = (rd, suite) => lines.push([frDate(rd.date || R.date), rd.idRdv || '', rd.patientCode || '', rd.patient, rd.cp, rd.ville, rdvTypes(rd).join(' + '), rdvWindowLabel(rd), rd.amdActuel || '', ...suite].map(q).join(';'));
  R.amds.forEach((a, i) => {
    const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return;
    r.steps.filter((s) => s.type === 'job').forEach((s, n) => ligne(R.rdv[s.job - 1], ['Planifié', a.nom, n + 1, s2hm(s.arrival), '', '']));
  });
  S.nonPlanifies.parMotif.forEach((m) => m.liste.forEach(({ rd, etape }) => ligne(rd, ['Non planifié', '', '', '', m.motif, etape])));
  S.horsAmd.parAmd.forEach((g) => g.liste.forEach((rd) => ligne(rd, ['AMD non prévu', '', '', '', rd.motifAmd || g.motif, 'hors optimisation'])));
  const nom = `rdv_${R.date}.csv`;
  download(nom, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  J.info('action', 'Export des RDV du compte rendu', `${nom} · ${lines.length - 1} RDV`);
}

let unRows = null;
const unSort = { key: 'ville', dir: 1 };
const unVal = {
  date: (x) => x.rd.date, patient: (x) => x.rd.patient, cp: (x) => x.rd.cp, ville: (x) => x.rd.ville, adresse: (x) => x.rd.adresse,
  type: (x) => rdvTypeNom(x.rd), cren: (x) => rdvWindow(x.rd)[0],
  amd: (x) => x.rd.amdActuel, why: (x) => x.why
};
function renderUnassigned() {
  const rows = unRows || [];
  $('#c-unassigned').textContent = unRows ? '· ' + rows.length : '';
  $('#r-un-empty').hidden = rows.length > 0;
  const R0 = state.results[state.date]; const nEx = R0 && R0.excluded ? R0.excluded.length : 0;
  $('#r-un-empty').textContent = !unRows ? 'Rien à afficher.' : nEx ? 'Tous les RDV calculés sont planifiés (voir les RDV écartés en haut de page).' : 'Tous les RDV de la journée sont planifiés.';
  $('#r-un-wrap').hidden = !rows.length;
  $$('#r-unassigned [data-sort]').forEach((b) => {
    const th = b.parentElement;
    if (b.dataset.sort === unSort.key) th.setAttribute('aria-sort', unSort.dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
  });
  const f = unVal[unSort.key];
  const sorted = rows.slice().sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true, sensitivity: 'base' });
    return c * unSort.dir || String(a.rd.ville ?? '').localeCompare(String(b.rd.ville ?? ''), 'fr');
  });
  $('#t-unassigned').innerHTML = sorted.map(({ rd, job, why }) => {
    const c = crenOf(rd.cren);
    return `<tr${job ? ` class="pick" data-job="${job}" tabindex="0" title="Voir sur la carte"` : ''}><td class="mono">${esc(frDate(rd.date))}</td><td><b>${esc(patientLib(rd))}</b></td><td class="mono">${esc(rd.cp)}</td><td>${esc(rd.ville || '?')}</td><td>${esc(rd.adresse)}</td>
      <td>${rdvTypeHtml(rd)}</td><td><span class="badge ${c.badge}" title="${esc(rdvWindowLabel(rd))}">${rd.hDeb ? esc(rd.hDeb + '–' + rd.hFin) : c.nom}</span></td><td>${esc(rd.amdActuel)}</td><td class="hint">${esc(why)}</td></tr>`;
  }).join('');
  if (pickedJob != null) $$(`#t-unassigned .pick[data-job="${pickedJob}"]`).forEach((x) => x.classList.add('sel'));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#r-unassigned [data-sort]'); if (!b) return;
  if (unSort.key === b.dataset.sort) unSort.dir = -unSort.dir; else { unSort.key = b.dataset.sort; unSort.dir = 1; }
  renderUnassigned();
});
function pinIcon(txt, col, dep) {
  return L.divIcon({ className: '', html: `<div class="pin ${dep ? 'dep' : ''}" style="${dep ? '' : 'background:' + col}">${txt}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}
function drawResultMap(R) {
  if (typeof L === 'undefined') { $('#map-result').innerHTML = '<p class="empty">Carte indisponible (Leaflet non chargé).</p>'; return; }
  if (!mapR) { mapR = L.map('map-result'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(mapR); }
  if (layerR) layerR.remove();
  layerR = L.featureGroup().addTo(mapR);
  markersR = {}; linesR = {}; jobVehR = {}; pickedJob = null; hoveredJob = null;
  R.amds.forEach((a, i) => {
    const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return;
    const col = COLORS[i % COLORS.length];
    if (r.geometry) linesR[r.vehicle] = L.polyline(decodePolyline(r.geometry), { color: col, weight: 4, opacity: 0.85 }).addTo(layerR);
    let n = 0;
    r.steps.forEach((s) => {
      if (s.type === 'start') L.marker([s.location[1], s.location[0]], { icon: pinIcon('D', col, true) }).bindTooltip(esc((depotOf(a.depot) || {}).nom || 'Départ')).addTo(layerR);
      if (s.type === 'job') {
        n++; const rd = R.rdv[s.job - 1];
        markersR[s.job] = L.marker([s.location[1], s.location[0]], { icon: pinIcon(n, col) })
          .bindTooltip(`<b>${esc(patientLib(rd))}</b> · ${esc(rd.ville)}<br>${esc(a.nom)} · n° ${n} · ${s2hm(s.arrival)}${tipRdv(rd)}`)
          .on('click', () => pickJob(s.job, true)).addTo(layerR);
        jobVehR[s.job] = r.vehicle;
      }
    });
  });
  // RDV non affectés mais localisés : repère gris
  R.res.unassigned.forEach((u) => {
    const rd = R.rdv[u.id - 1]; if (!rd || !rd.geo || rd.geo.none) return;
    markersR[u.id] = L.marker([rd.geo.lat, rd.geo.lon], { icon: pinIcon('!', '#8a94a3') })
      .bindTooltip(`<b>${esc(patientLib(rd))}</b> · ${esc(rd.ville)}<br>Non affecté${tipRdv(rd)}`)
      .on('click', () => pickJob(u.id, true)).addTo(layerR);
  });
  Object.entries(markersR).forEach(([job, m]) => m
    .on('mouseover', () => hoverJob(Number(job), true))
    .on('mouseout', () => hoverJob(null, true)));
  setTimeout(() => { mapR.invalidateSize(); if (layerR.getLayers().length) mapR.fitBounds(layerR.getBounds(), { padding: [24, 24] }); else mapR.setView([43.7, 6], 8); }, 50);
}
/* mise en évidence d'un RDV : ligne <-> repère sur la carte <-> agenda (via appBus) */
/* lignes « Visite | Prestation » et « Info RDV » des infobulles de la carte */
const tipRdv = (rd) => (rdvVisitePrest(rd) ? '<br>Visite | Prestation : ' + esc(rdvVisitePrest(rd)) : '') + (rd.infoRdv ? '<br>Info RDV : ' + esc(rd.infoRdv) : '');
let markersR = {}, linesR = {}, jobVehR = {}, pickedJob = null, hoveredJob = null;
const appBus = new EventTarget();
const mapVisible = () => !!mapR && $('#map-result').offsetParent !== null;
function pickJob(job, fromMap) {
  selectJob(pickedJob === job && !fromMap ? null : job, { fly: true, scroll: fromMap });
}
function selectJob(job, { fly = false, scroll = false } = {}) {
  job = job == null ? null : Number(job);
  if (pickedJob != null && markersR[pickedJob]) {
    const m = markersR[pickedJob]; m.closeTooltip(); m.setZIndexOffset(0);
    const el = m.getElement(); if (el) el.firstElementChild.classList.remove('hl');
  }
  Object.values(linesR).forEach((l) => l.setStyle({ weight: 4, opacity: 0.85 }));
  $$('#v-resultat .pick.sel').forEach((x) => x.classList.remove('sel'));
  const changed = pickedJob !== job;
  pickedJob = job;
  if (job != null) {
    $$(`#v-resultat .pick[data-job="${job}"]`).forEach((x) => {
      x.classList.add('sel');
      if (scroll && x.offsetParent) x.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const line = linesR[jobVehR[job]]; if (line) line.setStyle({ weight: 7, opacity: 1 }).bringToFront();
    const m = markersR[job];
    if (m) {
      m.setZIndexOffset(1000);
      const el = m.getElement(); if (el) el.firstElementChild.classList.add('hl');
      if (fly && mapVisible()) { mapR.flyTo(m.getLatLng(), Math.max(mapR.getZoom(), 12), { duration: 0.6 }); m.openTooltip(); }
    }
  }
  if (changed) appBus.dispatchEvent(new CustomEvent('pick', { detail: { job } }));
}
function hoverJob(job, fromMap) {
  job = job == null ? null : Number(job);
  if (hoveredJob === job) return;
  const prev = hoveredJob != null && markersR[hoveredJob];
  if (prev && prev.getElement()) prev.getElement().firstElementChild.classList.remove('hov');
  hoveredJob = job;
  const m = job != null && markersR[job];
  if (m && m.getElement()) m.getElement().firstElementChild.classList.add('hov');
  if (fromMap) appBus.dispatchEvent(new CustomEvent('hover', { detail: { job } }));
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('#v-resultat .pick'); if (row) pickJob(Number(row.dataset.job));
});
document.addEventListener('keydown', (e) => {
  const row = e.target.closest && e.target.closest('#v-resultat .pick');
  if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickJob(Number(row.dataset.job)); }
});
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
function exportCsv() {
  const R = state.results[state.date]; if (!R) return;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['date', 'amd', 'ordre', 'heure_arrivee', 'id_rdv', 'patient', 'code_postal', 'ville', 'adresse', 'intervention', 'creneau', 'attente_min', 'infos_acces'].join(';')];
  R.amds.forEach((a, i) => {
    const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return; let n = 0;
    r.steps.filter((s) => s.type === 'job').forEach((s) => {
      n++; const rd = R.rdv[s.job - 1];
      lines.push([frDate(R.date), a.nom, n, s2hm(s.arrival), rd.idRdv || '', patientLib(rd), rd.cp, rd.ville, rd.adresse, rdvTypeNom(rd), rdvWindowLabel(rd), Math.round((s.waiting_time || 0) / 60), infoTitle(rd).replace(/\n/g, ' | ')].map(q).join(';'));
    });
  });
  (R.excluded || []).forEach((rd) => { lines.push([frDate(R.date), 'ÉCARTÉ : ' + (rd.motif || 'adresse introuvable'), '', '', rd.idRdv || '', patientLib(rd), rd.cp, rd.ville, rd.adresse, rdvTypeNom(rd), rdvWindowLabel(rd), '', infoTitle(rd).replace(/\n/g, ' | ')].map(q).join(';')); });
  R.res.unassigned.forEach((u) => { const rd = R.rdv[u.id - 1]; lines.push([frDate(R.date), 'NON AFFECTÉ', '', '', rd.idRdv || '', patientLib(rd), rd.cp, rd.ville, rd.adresse, rdvTypeNom(rd), rdvWindowLabel(rd), '', infoTitle(rd).replace(/\n/g, ' | ')].map(q).join(';')); });
  download(`tournees_${R.date}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  J.info('action', 'Export des tournées', `tournees_${R.date}.csv · ${lines.length - 1} ligne${lines.length > 2 ? 's' : ''}`);
}

/* export de la tournée d'un seul AMD : ordre de passage, code et nom des patients, pour comparer à l'existant */
function exportCsvAmd(i) {
  const R = state.results[state.date]; const a = R && R.amds[i]; if (!a) return;
  const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['date', 'amd', 'ordre', 'heure_arrivee', 'code_patient', 'patient', 'id_rdv'].join(';')];
  r.steps.filter((s) => s.type === 'job').forEach((s, n) => {
    const rd = R.rdv[s.job - 1];
    lines.push([frDate(R.date), a.nom, n + 1, s2hm(s.arrival), rd.patientCode || '', rd.patient, rd.idRdv || ''].map(q).join(';'));
  });
  const nom = `tournee_${R.date}_${String(a.nom).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.csv`;
  download(nom, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  J.info('action', "Export de la tournée d'un AMD", `${nom} · ${lines.length - 1} RDV`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#r-routes [data-csv-amd]'); if (b) exportCsvAmd(Number(b.dataset.csvAmd));
});

/* ---------- test trajet ---------- */
let trajetReady = false;
function initTrajet() {
  $('#dl-depots').innerHTML = state.params.depots.map((d) => `<option value="${esc(d.nom)}"></option>`).join('');
  if (typeof L !== 'undefined' && !mapT) {
    mapT = L.map('map-trajet').setView([43.6, 5.8], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(mapT);
  }
  setTimeout(() => mapT && mapT.invalidateSize(), 50);
  if (trajetReady) return; trajetReady = true;
  $('#tr-go').addEventListener('click', calcTrajet);
  $('#tr-terrain').addEventListener('input', showEcart);
}
let lastTrajetMin = null;
async function placeOf(text) {
  const d = state.params.depots.find((x) => norm(x.nom) === norm(text));
  if (d) { if (!d.geo || d.geo.none) await geocodeDepot(d); if (d.geo.none) throw new Error('Adresse introuvable : ' + d.nom); return d.geo; }
  const cp = (text.match(/\b\d{5}\b/) || [])[0];
  const g = await geocode(text.replace(/\b\d{5}\b/, '').trim() || text, cp);
  if (g.none) throw new Error('Lieu introuvable : « ' + text + ' »');
  return g;
}
async function calcTrajet() {
  const btn = $('#tr-go'); btn.disabled = true; alertMsg('#tr-msg', 'Calcul…');
  try {
    const a = await placeOf($('#tr-dep').value), b = await placeOf($('#tr-arr').value);
    save();
    const r = await fetch(`/osrm/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error('OSRM : ' + (j.message || j.code));
    const rt = j.routes[0]; const coef = 1 + (Number(state.params.coef) || 0) / 100;
    const maj = rt.duration * coef; lastTrajetMin = maj / 60;
    $('#tr-km').textContent = fmtKm(rt.distance);
    $('#tr-min').textContent = Math.round(rt.duration / 60) + ' min';
    $('#tr-maj').textContent = Math.round(maj / 60) + ' min';
    $('#tr-eta').textContent = s2hm(hm2s($('#tr-h').value) + maj);
    $('#tr-geo').textContent = `Départ localisé : ${a.label} · Arrivée localisée : ${b.label}. Temps majoré de ${state.params.coef} % (paramètre « Majoration trafic »).`;
    showEcart();
    if (mapT) {
      if (layerT) layerT.remove();
      layerT = L.featureGroup().addTo(mapT);
      L.geoJSON(rt.geometry, { style: { color: '#1d4f91', weight: 5 } }).addTo(layerT);
      L.marker([a.lat, a.lon], { icon: pinIcon('A', '#1d4f91', true) }).addTo(layerT);
      L.marker([b.lat, b.lon], { icon: pinIcon('B', '#c26a1a') }).addTo(layerT);
      mapT.fitBounds(layerT.getBounds(), { padding: [24, 24] });
    }
    alertMsg('#tr-msg', '');
    J.info('action', 'Test de trajet', `${$('#tr-dep').value} → ${$('#tr-arr').value} : ${fmtKm(rt.distance)} · ${Math.round(maj / 60)} min majorées`);
  } catch (err) { alertMsg('#tr-msg', esc(err.message), 'err'); J.warn('action', 'Test de trajet en échec', `${$('#tr-dep').value} → ${$('#tr-arr').value}`, err.message); }
  finally { btn.disabled = false; }
}
function showEcart() {
  const v = Number($('#tr-terrain').value); const el = $('#tr-ecart');
  if (!v || lastTrajetMin == null) { el.textContent = 'Saisir pour comparer avec le calcul'; return; }
  const d = Math.round(v - lastTrajetMin);
  el.textContent = d === 0 ? 'Identique au calcul majoré' : `Terrain ${d > 0 ? 'plus long' : 'plus court'} de ${Math.abs(d)} min (${Math.round((d / lastTrajetMin) * 100)} %) que le calcul majoré`;
}

/* ---------- pont vers les modules ES (vue Agenda) ---------- */
window.OptiApp = {
  bus: appBus, // événements : 'render' (écran 3 redessiné), 'pick' (sélection), 'hover' (survol d'un repère)
  get params() { return state.params; },
  date: () => state.date,
  days: resultDays,
  result: () => state.results[state.date] || null,
  hasResult: (iso) => !!state.results[iso],
  setDate(iso) { if (iso && iso !== state.date) { state.date = iso; save(); alertMsg('#r-msg', ''); renderResult(); } },
  typeOf, depotOf, crenOf, hm2s, longDate, frDate,
  rdvWindow: (rd) => rdvWindow(rd), rdvWindowLabel: (rd) => rdvWindowLabel(rd), rdvTypeNom, rdvO2, rdvGroupe, rdvInfos, patientLib, rdvVisitePrest,
  vehicleWindow: (a) => vehicleWindow(a, state.params),
  pickedJob: () => pickedJob,
  selectJob, hoverJob,
  refreshMap() { if (mapR) setTimeout(() => mapR.invalidateSize(), 0); }
};

/* ---------- démarrage ---------- */
load();
J.info('systeme', 'Ouverture de l’application', `${state.rdv.length} RDV · ${state.amd.length} AMD · ${Object.keys(state.results).length} journée${Object.keys(state.results).length > 1 ? 's' : ''} optimisée${Object.keys(state.results).length > 1 ? 's' : ''} en mémoire`);
bindParams();
bindPlan();
$('#r-csv').addEventListener('click', exportCsv);
$('#r-stats').addEventListener('click', openStats);
$('#st-close').addEventListener('click', () => $('#dlg-stats').close());
$('#st-csv').addEventListener('click', exportStatsCsv);
$('#r-print').addEventListener('click', () => { J.info('action', 'Impression des feuilles de route', 'Journée du ' + frDate(state.date)); window.print(); });
window.addEventListener('hashchange', route);
route();
