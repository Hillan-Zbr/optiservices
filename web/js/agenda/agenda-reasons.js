/* Optiservices — vue Agenda : motif probable des RDV non affectés
   VROOM v1.14 ne dit pas pourquoi un job reste non affecté : on déduit un motif indicatif,
   toujours présenté comme « Motif probable ». */

export const MOTIFS = {
  adresse: 'adresse non localisée',
  o2: 'aucun AMD avec la compétence O2',
  creneau: 'créneau hors des heures ouvrées',
  limites: 'hors limite de km ou d’heures',
  sature: 'créneau saturé ou capacité insuffisante sur cette antenne'
};

/**
 * Motif probable d'un RDV non affecté (pur).
 * @param {object} job       { jobId, localise:boolean, o2:boolean, creneau:{debutMin, finMin} }
 * @param {object} ctx       { vehicles:[{ id, o2, fenetre:{debutMin, finMin}, maxDistance?, maxTravelTime?, speedFactor? }],
 *                             aller(vehId, jobId) / retour(jobId, vehId) -> { distance, duration } | null | undefined }
 *                           aller/retour : trajets OSRM bruts antenne <-> RDV (null = point non routable, undefined = inconnu)
 * @returns {string}
 */
export function probableReason(job, ctx) {
  const vehicles = ctx.vehicles || [];
  if (!job.localise) return MOTIFS.adresse;

  // point hors du réseau routier : OSRM ne trouve de trajet depuis aucune antenne
  if (ctx.aller && vehicles.length && vehicles.every((v) => ctx.aller(v.id, job.jobId) === null)) return MOTIFS.adresse;

  // 1. compétence O2
  if (job.o2 && !vehicles.some((v) => v.o2)) return MOTIFS.o2;
  const aptes = vehicles.filter((v) => !job.o2 || v.o2);

  // 2. créneau sans recouvrement avec la fenêtre horaire d'un véhicule
  const c = job.creneau;
  if (c && !aptes.some((v) => v.fenetre.debutMin < c.finMin && v.fenetre.finMin > c.debutMin)) return MOTIFS.creneau;

  // 3. aller-retour depuis l'antenne au-delà de max_distance / max_travel_time pour tous les véhicules aptes
  if (ctx.aller && ctx.retour && aptes.length) {
    const horsLimite = aptes.every((v) => {
      const a = ctx.aller(v.id, job.jobId); const r = ctx.retour(job.jobId, v.id);
      if (!a || !r) return false; // inconnu : on ne conclut pas
      const dist = a.distance + r.distance;
      const duree = (a.duration + r.duration) / (v.speedFactor || 1); // même mise à l'échelle que VROOM
      return (v.maxDistance > 0 && dist > v.maxDistance) || (v.maxTravelTime > 0 && duree > v.maxTravelTime);
    });
    if (horsLimite) return MOTIFS.limites;
  }

  // 4. par défaut
  return MOTIFS.sature;
}

/**
 * Trajets antenne <-> RDV via le service table d'OSRM (coordonnées seules, aucune donnée patient).
 * @param {Array<{key:string, lonlat:number[]}>} antennes
 * @param {Array<{key:string, lonlat:number[]}>} points
 * @param {Function} fetchFn  fetch (injecté pour les tests)
 * @returns {Promise<{ aller:(antenneKey, pointKey)=>object|null, retour:(pointKey, antenneKey)=>object|null }>}
 */
export async function fetchTrajetsAntennes(antennes, points, fetchFn = fetch) {
  if (!antennes.length || !points.length) return { aller: () => undefined, retour: () => undefined };
  const all = antennes.concat(points);
  const coords = all.map((p) => p.lonlat[0].toFixed(6) + ',' + p.lonlat[1].toFixed(6)).join(';');
  const url = `/osrm/table/v1/driving/${coords}?annotations=duration,distance`;
  const r = await fetchFn(url);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error('OSRM table : ' + (j.message || j.code));
  const idx = new Map(all.map((p, i) => [p.key, i]));
  const cell = (i, k) => {
    if (i == null || k == null) return undefined;
    const d = j.durations[i][k]; const m = j.distances[i][k];
    return d == null || m == null ? null : { duration: d, distance: m };
  };
  return {
    aller: (a, p) => cell(idx.get('A' + a), idx.get('P' + p)),
    retour: (p, a) => cell(idx.get('P' + p), idx.get('A' + a))
  };
}
