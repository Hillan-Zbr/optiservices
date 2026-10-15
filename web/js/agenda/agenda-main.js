/* Optiservices — vue Agenda : point d'entrée
   Relie l'application existante (window.OptiApp, script classique app.js) aux modules de l'agenda. */

import * as S from './agenda-state.js';
import { buildAgendaDay, pairColumns, summarize, mergeBornes, fmtDuree } from './agenda-model.js';
import { probableReason, fetchTrajetsAntennes, MOTIFS } from './agenda-reasons.js';
import { mountAgenda, renderAgenda, applySelection, applyHover, focusJob } from './agenda-view.js';

const app = window.OptiApp;
const $ = (s) => document.querySelector(s);

/* département d'une antenne : libellé Isadom (« ARARD 2B » -> « 2B »), sinon parenthèse du nom (« Siège · Aubagne (13) » -> « 13 ») */
const antenneDept = (d) => {
  const isa = String(d.isadom || '').replace(/^\s*ARARD\s*/i, '').trim();
  if (isa) return isa;
  const m = String(d.nom || '').match(/\(([^)]*)\)/);
  return m ? m[1].trim() : String(d.nom || '');
};

/* ---------- contexte métier pour le modèle ---------- */
function buildContext(R) {
  const p = app.params;
  const vehicles = R.amds.map((a, i) => {
    const d = app.depotOf(a.depot) || { id: a.depot, nom: a.depot };
    const w = app.vehicleWindow(a); // heures ouvrées propres à chaque AMD (journée, matin, après-midi)
    return { id: String(i + 1), name: a.nom, antenne: d.id, antenneNom: antenneDept(d), heuresOuvrees: { debutMin: w[0] / 60, finMin: w[1] / 60 } };
  });
  const jobsById = {};
  R.rdv.forEach((rd, j) => { jobsById[String(j + 1)] = jobInfo(rd); });
  return { vehicles, jobsById, params: {} };
}
function jobInfo(rd) {
  // fenêtre réelle du RDV (heures Isadom si présentes, sinon créneau paramétré) et types multiples
  const w = app.rdvWindow(rd);
  return {
    patient: app.patientLib(rd), ville: rd.ville, intervention: app.rdvTypeNom(rd), o2: app.rdvO2(rd), groupe: app.rdvGroupe(rd),
    creneau: { debutMin: w[0] / 60, finMin: w[1] / 60, label: app.rdvWindowLabel(rd) }
  };
}

/* ---------- motifs probables (matrice OSRM antennes <-> RDV, en mémoire par résultat) ---------- */
const trajetsCache = new Map(); // R.at -> { etat:'attente'|'ok'|'erreur', t? }
function trajetsPour(R) {
  let c = trajetsCache.get(R.at);
  if (c) return c;
  c = { etat: 'attente' }; trajetsCache.set(R.at, c);
  const antennes = R.amds.map((a, i) => ({ key: 'A' + (i + 1), d: app.depotOf(a.depot) }))
    .filter((x) => x.d && x.d.geo && !x.d.geo.none).map((x) => ({ key: x.key, lonlat: [x.d.geo.lon, x.d.geo.lat] }));
  const points = R.res.unassigned.map((u) => ({ key: 'P' + u.id, rd: R.rdv[u.id - 1] }))
    .filter((x) => x.rd && x.rd.geo && !x.rd.geo.none).map((x) => ({ key: x.key, lonlat: [x.rd.geo.lon, x.rd.geo.lat] }));
  if (!points.length) { c.etat = 'ok'; c.t = null; return c; }
  fetchTrajetsAntennes(antennes, points)
    .then((t) => { c.etat = 'ok'; c.t = t; })
    .catch((e) => { c.etat = 'erreur'; console.warn('Agenda : matrice OSRM indisponible,', e.message); if (window.OptiJournal) window.OptiJournal.warn('optimisation', 'Motifs de non-affectation indisponibles', 'Matrice OSRM injoignable', e.message); })
    .finally(render);
  return c;
}
function motifs(R) {
  const p = app.params;
  const coef = 1 / (1 + (Number(p.coef) || 0) / 100);
  const vehicles = R.amds.map((a, i) => {
    const w = app.vehicleWindow(a);
    return {
      id: i + 1, o2: true /* tous les AMD sont habilités O2 */, fenetre: { debutMin: w[0] / 60, finMin: w[1] / 60 },
      maxDistance: a.kmmax > 0 ? a.kmmax * 1000 : 0, maxTravelTime: a.hmax > 0 ? a.hmax * 3600 : 0,
      speedFactor: Math.min(5, Math.max(0.2, coef))
    };
  });
  const tr = trajetsPour(R);
  const ctx = { vehicles };
  if (tr.etat === 'ok' && tr.t) { ctx.aller = tr.t.aller; ctx.retour = tr.t.retour; }
  return (rd, jobId) => {
    // mode « AMD bloqué » : RDV sans AMD utilisable, ou analyse restreinte au seul AMD du RDV
    if (R.mode === 'amd-bloque' && rd.motifAmd) return rd.motifAmd;
    const ctxRdv = R.mode === 'amd-bloque' && rd.amdIdx >= 0 ? Object.assign({}, ctx, { vehicles: vehicles.filter((v) => v.id === rd.amdIdx + 1) }) : ctx;
    const ji = jobInfo(rd, p);
    const m = probableReason({ jobId, localise: !!(rd.geo && !rd.geo.none), o2: ji.o2, creneau: ji.creneau }, ctxRdv);
    return m === MOTIFS.sature && tr.etat === 'attente' ? 'analyse en cours…' : m;
  };
}

/* ---------- calcul du modèle de la vue ---------- */
let current = null; // { R, opt, act, details }
function compute() {
  const R = app.result();
  if (!R) { current = null; return; }
  const ctx = buildContext(R);
  const opt = buildAgendaDay(R.res, ctx);
  const act = R.resAct ? buildAgendaDay(R.resAct, ctx) : null;
  const motif = motifs(R);
  const nonAffectes = opt.nonAffectes.map((u) => {
    const rd = R.rdv[Number(u.jobId) - 1];
    return { key: 'j' + u.jobId, jobId: u.jobId, rd, motif: motif(rd, Number(u.jobId)) };
  }).concat((R.excluded || []).map((rd, i) => ({ key: 'x' + i, rd, motif: rd.motif || MOTIFS.adresse })))
    // RDV d'un AMD connu mais non prévu (absent, inactif, antenne hors test) : retirés du calcul, mais à montrer ; ceux d'un AMD inconnu sont déjà filtrés par app.result()
    .concat((R.horsAmd || []).map((rd, i) => ({ key: 'h' + i, rd, motif: `AMD non prévu (${rd.amdActuel || 'aucun'}) : ${rd.motifAmd || 'hors optimisation'}` })));
  current = { R, opt, act, nonAffectes };
}

function titreRdv(rd) {
  const ji = jobInfo(rd, app.params);
  return [app.patientLib(rd), rd.ville || '?', ji.intervention, ji.creneau.label].join(' · ');
}

// informations Isadom affichées dans le détail : « Visite | Prestation » et Info RDV
const extraRdv = (rd) => (rd ? { visitePrest: app.rdvVisitePrest(rd), infoRdv: rd.infoRdv || '' } : {});
function detailFor(jobId) {
  if (!current || jobId == null) return null;
  for (const c of current.opt.colonnes) {
    const s = c.segments.find((x) => x.kind === 'rdv' && x.jobId === jobId);
    if (s) return Object.assign({}, s, { amd: c.name, surCarte: true }, extraRdv(current.R.rdv[Number(jobId) - 1]));
  }
  const u = current.nonAffectes.find((x) => x.jobId === jobId);
  if (u) {
    const ji = jobInfo(u.rd, app.params);
    return { jobId, nonAffecte: true, patient: app.patientLib(u.rd), ville: u.rd.ville, intervention: ji.intervention, creneau: ji.creneau.label, motif: u.motif, surCarte: !!(u.rd.geo && !u.rd.geo.none), ...extraRdv(u.rd) };
  }
  return null;
}

/* ---------- rendu ---------- */
function render() {
  if (S.state.vue !== 'agenda') return;
  compute();
  const st = S.state;
  const jours = app.days().map((iso) => ({ iso, label: app.longDate(iso) + (app.hasResult(iso) ? '' : ' · non optimisée') }));
  const vm = {
    jours, jour: app.date(), antennes: [], antenne: 'all', mode: 'opt', cmpDisponible: false, cmpTitre: '',
    pairs: [], bornes: { debutMin: 480, finMin: 1140 }, summary: '', nonAffectes: [],
    selectedJobId: st.selectedJobId, hoveredJobId: st.hoveredJobId, detail: null
  };
  if (!current) {
    vm.message = 'Journée non optimisée : utilisez le bouton « Optimiser cette journée » ci-dessus.';
    renderAgenda(vm);
    return;
  }
  const { R, opt, act } = current;

  // antennes présentes dans le lot
  const ant = new Map();
  opt.colonnes.forEach((c) => ant.set(c.antenne, c.antenneNom));
  vm.antennes = [...ant].map(([value, label]) => ({ value, label }));
  vm.antenne = st.antenne === 'all' || ant.has(st.antenne) ? st.antenne : 'all';

  // comparaison
  vm.cmpDisponible = !!act;
  vm.cmpTitre = R.mode === 'amd-bloque' ? 'Comparaison sans objet : les tournées respectent les AMD affectés dans Isadom.' : R.cmp ? 'Relancez l’optimisation de cette journée pour afficher l’emploi du temps actuel.' : 'Aucun RDV n’a d’AMD actuel reconnu : comparaison indisponible.';
  vm.mode = st.mode === 'cmp' && act ? 'cmp' : 'opt';

  const pairs = pairColumns(opt, act).filter((p) => vm.antenne === 'all' || p.opt.antenne === vm.antenne);
  vm.pairs = pairs;
  vm.bornes = vm.mode === 'cmp' ? mergeBornes(opt.bornes, act.bornes) : opt.bornes;

  const so = summarize(pairs.map((p) => p.opt));
  if (vm.mode === 'cmp') {
    const sa = summarize(pairs.map((p) => p.act).filter(Boolean));
    vm.summary = `Trajets : ${fmtDuree(so.trajetsMin)} optimisé · ${fmtDuree(sa.trajetsMin)} actuel · ${so.nbRdv} RDV`;
    const notes = [];
    if (R.cmp && R.cmp.n < R.cmp.total) notes.push(`Comparaison partielle : ${R.cmp.n} RDV sur ${R.cmp.total} ont un AMD actuel reconnu ; la voie « actuel » ne contient que ceux-là.`);
    const nAct = act.nonAffectes.length;
    if (nAct) notes.push(`Planification actuelle : ${nAct} RDV impossible${nAct > 1 ? 's' : ''} à tenir (absent${nAct > 1 ? 's' : ''} de la voie « actuel » et de ses trajets).`);
    vm.note = notes.join(' ');
  } else {
    vm.summary = `${so.nbAmd} AMD · ${so.nbRdv} RDV · trajets ${fmtDuree(so.trajetsMin)}`;
  }

  if (opt.sansSolution) vm.message = 'VROOM n’a construit aucune tournée pour cette journée : aucun RDV n’a pu être affecté. Voir la liste « À placer ».';
  else if (!pairs.length) vm.message = 'Aucun AMD sur cette antenne.';
  if (opt.sansSolution) vm.pairs = [];

  vm.nonAffectes = current.nonAffectes.map((u) => ({ key: u.key, jobId: u.jobId, titre: titreRdv(u.rd), amd: String(u.rd.amdActuel || '').trim() || 'non renseigné', motif: u.motif }));
  vm.detail = detailFor(st.selectedJobId);
  renderAgenda(vm);
}

/* ---------- bascule Carte + liste / Agenda ---------- */
function applyVue() {
  const v = S.state.vue;
  document.body.dataset.rvue = v;
  $('#r-agenda').hidden = v !== 'agenda';
  [['#vue-carte', 'carte'], ['#vue-agenda', 'agenda']].forEach(([sel, val]) => $(sel).setAttribute('aria-pressed', String(v === val)));
  if (v === 'carte') app.refreshMap(); else render();
}

function init() {
  mountAgenda($('#r-agenda'), {
    onJour: (iso) => app.setDate(iso),
    onAntenne: (a) => S.set({ antenne: a }),
    onMode: (m) => S.set({ mode: m }),
    onSelect: (id) => S.select(id),
    onHover: (id) => S.hover(id),
    onVoirCarte: (id) => {
      S.set({ vue: 'carte' });
      setTimeout(() => app.selectJob(Number(id), { fly: true, scroll: true }), 60); // après redimensionnement de la carte
    }
  });
  $('#vue-carte').addEventListener('click', () => S.set({ vue: 'carte' }));
  $('#vue-agenda').addEventListener('click', () => S.set({ vue: 'agenda' }));

  S.bus.addEventListener('change', (e) => {
    if ('vue' in e.detail) applyVue(); else render();
  });
  S.bus.addEventListener('selectionchange', (e) => {
    const id = e.detail.jobId;
    if (S.state.vue === 'agenda') { applySelection(id, detailFor(id)); if (id) focusJob(id); }
    const n = id == null ? null : Number(id);
    if (app.pickedJob() !== n) app.selectJob(n);
  });
  S.bus.addEventListener('hoverchange', (e) => {
    applyHover(e.detail.jobId);
    app.hoverJob(e.detail.jobId == null ? null : Number(e.detail.jobId));
  });

  app.bus.addEventListener('pick', (e) => S.select(e.detail.job));
  app.bus.addEventListener('hover', (e) => S.hover(e.detail.job));
  app.bus.addEventListener('render', () => {
    // nouveau jour : on repart sans sélection ; même jour (retour sur l'écran Résultat) : on la réapplique à la carte
    if (S.state.jour !== app.date()) { S.state.jour = app.date(); S.select(null); }
    else if (S.state.selectedJobId != null) app.selectJob(Number(S.state.selectedJobId));
    render();
  });

  S.state.jour = app.date();
  applyVue();
}

if (app) init();
else console.warn('Agenda : application principale (OptiApp) introuvable');
