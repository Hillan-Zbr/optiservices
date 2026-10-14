/* Optiservices — vue Agenda : modèle de vue (pur, sans DOM, testable sous Node)
   Réponse VROOM (secondes depuis minuit) -> colonnes et segments (minutes depuis minuit). */

import { SEUIL_PROCHE_FIN_CRENEAU_MIN } from './agenda-constants.js';

/** @typedef {{ kind:'trajet'|'retour'|'setup'|'rdv'|'pause'|'attente',
 *             startMin:number, endMin:number,
 *             jobId?:string, patient?:string, ville?:string, intervention?:string, o2?:boolean, groupe?:string,
 *             creneau?:string, arriveeMin?:number, trajetPrecedentMin?:number,
 *             warn?:boolean }} Segment */

/** @typedef {{ id:string, name:string, antenne:string, antenneNom:string, startMin:number, endMin:number,
 *             heuresOuvrees:{debutMin:number, finMin:number},
 *             segments:Segment[], retourMin:number|null, depasseHeuresOuvrees:boolean,
 *             nbRdv:number, trajetTotalMin:number, vide:boolean }} AmdColumn */

/** @typedef {{ jobId:string, type:string, location?:number[], patient?:string, ville?:string,
 *             intervention?:string, creneau?:string }} Unassigned */

/** @typedef {{ colonnes:AmdColumn[], nonAffectes:Unassigned[], bornes:{debutMin:number, finMin:number}, sansSolution:boolean }} AgendaDay */

/* Arrondi unique des bornes : deux segments contigus en secondes restent contigus en minutes,
   donc la somme des durées d'une colonne vaut exactement fin - début (arrondis). */
export const secToMin = (s) => Math.round((Number(s) || 0) / 60);

const TRAJETS = new Set(['trajet', 'retour']);
export const dureeMin = (seg) => seg.endMin - seg.startMin;
export const totalTrajetsMin = (segments) => segments.filter((s) => TRAJETS.has(s.kind)).reduce((a, s) => a + dureeMin(s), 0);

/**
 * @param {object} vroomResponse  réponse VROOM brute
 * @param {object} context        { vehicles, jobsById, params }
 *   vehicles : [{ id, name, antenne, antenneNom, heuresOuvrees:{debutMin, finMin} }] — une colonne par véhicule, même sans route
 *   jobsById : { [id]: { patient, ville, intervention, o2, groupe, creneau:{debutMin, finMin, label} } }
 *   params   : { seuilProcheFinCreneauMin? }
 * @returns {AgendaDay}
 */
export function buildAgendaDay(vroomResponse, context) {
  const { vehicles = [], jobsById = {}, params = {} } = context || {};
  const seuil = params.seuilProcheFinCreneauMin ?? SEUIL_PROCHE_FIN_CRENEAU_MIN;
  const res = vroomResponse || {};
  const routes = new Map((res.routes || []).map((r) => [String(r.vehicle), r]));

  const colonnes = vehicles.map((v) => buildColumn(v, routes.get(String(v.id)), jobsById, seuil));
  const nonAffectes = (res.unassigned || []).map((u) => {
    const j = jobsById[String(u.id)] || {};
    return { jobId: String(u.id), type: u.type || 'job', location: u.location, patient: j.patient, ville: j.ville, intervention: j.intervention, o2: !!j.o2, creneau: j.creneau && j.creneau.label };
  });
  return { colonnes, nonAffectes, bornes: computeBornes(colonnes), sansSolution: !(res.routes || []).length };
}

function buildColumn(v, route, jobsById, seuil) {
  const ho = v.heuresOuvrees || { debutMin: 480, finMin: 1050 };
  const col = {
    id: String(v.id), name: v.name, antenne: v.antenne, antenneNom: v.antenneNom || v.antenne,
    heuresOuvrees: ho, startMin: ho.debutMin, endMin: ho.debutMin, segments: [],
    retourMin: null, depasseHeuresOuvrees: false, nbRdv: 0, trajetTotalMin: 0, vide: true
  };
  if (!route || !Array.isArray(route.steps) || !route.steps.length) return col;

  const segs = [];
  // ajoute un segment [a, b[ (secondes) ; les segments nuls après arrondi sont omis, sauf les RDV
  const push = (kind, a, b, extra) => {
    const s = { kind, startMin: secToMin(a), endMin: secToMin(b), ...extra };
    if (kind === 'rdv' || s.endMin > s.startMin) segs.push(s);
    return s;
  };

  let prevEnd = null; // fin (s) de l'étape précédente
  for (const st of route.steps) {
    const arrival = Number(st.arrival) || 0;
    const wait = Number(st.waiting_time) || 0;
    const setup = Number(st.setup) || 0;
    const service = Number(st.service) || 0;
    if (st.type === 'start') {
      col.startMin = secToMin(arrival);
      prevEnd = arrival + wait + setup + service;
      continue;
    }
    if (prevEnd == null) prevEnd = arrival;
    // trajet depuis la fin de l'étape précédente (VROOM peut aussi placer une partie du trajet avant une pause)
    let trajet = null;
    if (arrival > prevEnd) trajet = push(st.type === 'end' ? 'retour' : 'trajet', prevEnd, arrival);
    if (st.type === 'end') {
      col.retourMin = secToMin(arrival);
      col.endMin = col.retourMin;
      prevEnd = arrival;
      break;
    }
    let t = arrival;
    if (wait > 0) { push('attente', t, t + wait); t += wait; }
    if (st.type === 'job') {
      if (setup > 0) { push('setup', t, t + setup); t += setup; }
      const id = String(st.job ?? st.id);
      const j = jobsById[id] || {};
      const debutTache = arrival + wait; // début de stationnement : c'est lui que contraint le créneau VROOM
      const finCreneau = j.creneau ? j.creneau.finMin : null;
      push('rdv', t, t + service, {
        jobId: id, patient: j.patient, ville: j.ville, intervention: j.intervention, o2: !!j.o2, groupe: j.groupe || 'AUTRE',
        creneau: j.creneau ? j.creneau.label : undefined,
        arriveeMin: secToMin(arrival),
        trajetPrecedentMin: trajet ? dureeMin(trajet) : 0,
        warn: finCreneau != null && finCreneau - debutTache / 60 < seuil
      });
      t += service;
    } else if (st.type === 'break') {
      t += setup;
      push('pause', t, t + service);
      t += service;
    } else {
      t += setup + service;
    }
    prevEnd = t;
  }
  if (col.retourMin == null && prevEnd != null) col.endMin = secToMin(prevEnd);

  // VROOM peut placer tout le trajet retour avant une pause de fin de journée :
  // un trajet qui n'est suivi d'aucun RDV est le retour à l'antenne
  if (col.retourMin != null) {
    const dernierRdv = segs.map((x) => x.kind).lastIndexOf('rdv');
    segs.forEach((x, i) => { if (i > dernierRdv && x.kind === 'trajet') x.kind = 'retour'; });
  }

  col.segments = segs;
  col.nbRdv = segs.filter((s) => s.kind === 'rdv').length;
  col.trajetTotalMin = totalTrajetsMin(segs);
  col.depasseHeuresOuvrees = col.retourMin != null && col.retourMin > ho.finMin;
  col.vide = col.nbRdv === 0;
  return col;
}

/* Axe vertical : heures ouvrées arrondies à l'heure (+ 1 h après la fin, rien avant le début), étendues à tout segment qui en sortirait */
export function computeBornes(colonnes) {
  const cols = colonnes || [];
  if (!cols.length) return { debutMin: 8 * 60, finMin: 19 * 60 };
  let deb = Math.min(...cols.map((c) => c.heuresOuvrees.debutMin));
  let fin = Math.max(...cols.map((c) => c.heuresOuvrees.finMin));
  let debutMin = Math.floor(deb / 60) * 60;
  let finMin = Math.ceil(fin / 60) * 60 + 60;
  for (const c of cols) {
    const pts = [c.startMin, c.endMin].concat(...c.segments.map((s) => [s.startMin, s.endMin]));
    deb = Math.min(...pts); fin = Math.max(...pts);
    if (deb < debutMin) debutMin = Math.floor(deb / 60) * 60;
    if (fin > finMin) finMin = Math.ceil(fin / 60) * 60;
  }
  return { debutMin: Math.max(0, debutMin), finMin: Math.min(24 * 60, finMin) };
}

/* Union de deux bornes (mode comparaison) */
export function mergeBornes(a, b) {
  if (!b) return a;
  return { debutMin: Math.min(a.debutMin, b.debutMin), finMin: Math.max(a.finMin, b.finMin) };
}

/* Appariement optimisé / actuel par identifiant de véhicule ; act = null si absent de l'autre résultat */
export function pairColumns(optDay, actDay) {
  const act = new Map(((actDay && actDay.colonnes) || []).map((c) => [c.id, c]));
  return optDay.colonnes.map((c) => ({ opt: c, act: act.get(c.id) || null }));
}

/* Indicateurs du résumé, toujours recalculés à partir des modèles */
export function summarize(colonnes) {
  return {
    nbAmd: colonnes.length,
    nbRdv: colonnes.reduce((a, c) => a + c.nbRdv, 0),
    trajetsMin: colonnes.reduce((a, c) => a + c.trajetTotalMin, 0)
  };
}

/* Formats d'affichage */
export const fmtHeure = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(Math.round(min) % 60).padStart(2, '0');
export const fmtDuree = (min) => (min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min + ' min');
