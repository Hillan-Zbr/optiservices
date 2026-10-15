/* Optiservices — placement forcé des RDV de chaque AMD (sans DOM)
   Script classique chargé AVANT app.js. Expose window.OptiForce ; testable sous Node (module.exports).

   Besoin (15/10/2026, Responsable) : aucun RDV ne doit rester non planifié chez son AMD,
   quitte à réduire le temps passé sur place (jamais les déplacements).
   VROOM ne sait pas imposer qu'un job soit placé : on relance le calcul en desserrant, AMD par AMD,
   seulement pour ceux qui ont encore des RDV non placés (les AMD sont indépendants : compétence 100 + i).
   Paliers successifs :
     1. temps sur place (service) réduit par pas de 10 % jusqu'au minimum paramétré ;
     2. puis heures et km max de l'AMD levés ;
     3. puis fin de journée de l'AMD repoussée (FIN_REPOUSSEE) ;
     4. puis créneaux des RDV élargis à toute la journée de l'AMD ;
     5. en dernier recours, plus aucune contrainte horaire (ni créneau, ni fin de journée, ni pause) :
        VROOM ne peut alors plus refuser un RDV, qui est placé quitte à sortir de son créneau.
   Le stationnement (setup) n'est pas réduit. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiForce = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PAS = 10;
  const MIN_DEFAUT = 50;
  const FIN_REPOUSSEE = 21 * 3600; // 21h00

  /* réglage normal : rien de desserré */
  const NORMAL = Object.freeze({ coef: 100, limites: false, fin: false, creneau: false, libre: false });

  /* paliers du plus serré au plus lâche ; min : temps sur place minimum en % (borné à 0–100) */
  function paliers(min) {
    const m = Number.isFinite(Number(min)) ? Math.min(100, Math.max(0, Number(min))) : MIN_DEFAUT;
    const out = [];
    const r = (coef, limites, fin, creneau, libre) => ({ coef, limites, fin, creneau, libre });
    for (let c = 100; c > m; c -= PAS) out.push(r(c, false, false, false, false));
    out.push(r(m, false, false, false, false));
    out.push(r(m, true, false, false, false));
    out.push(r(m, true, true, false, false));
    out.push(r(m, true, true, true, false));
    out.push(r(m, true, true, true, true));
    return out;
  }

  /* un réglage desserre-t-il quelque chose ? */
  const estForce = (r) => !!r && (r.coef < 100 || r.limites || r.fin || r.creneau || !!r.libre);

  /* libellé court d'un réglage, pour l'écran et le journal (vide si normal) */
  function libelle(r) {
    if (!estForce(r)) return '';
    const l = [];
    if (r.coef < 100) l.push(`temps sur place réduit à ${r.coef} %`);
    if (r.limites) l.push('heures et km max levés');
    if (r.fin) l.push('fin de journée repoussée');
    if (r.libre) l.push('horaires levés : RDV placés hors créneau si besoin');
    else if (r.creneau) l.push('créneaux élargis à la journée');
    return l.join(' · ');
  }

  /* boucle de calcul.
     resoudre(reglages) -> Promise<réponse VROOM> (reglages[i] : réglage de l'AMD n° i)
     amdDuJob(id) -> indice de l'AMD du job VROOM id, -1 si aucun
     Rend { res, reglages, appels } : la dernière réponse et le réglage retenu par AMD. */
  async function forcer(resoudre, amdDuJob, nAmd, min) {
    const P = paliers(min);
    const niv = new Array(nAmd).fill(0);
    let res; let appels = 0;
    for (;;) {
      res = await resoudre(niv.map((n) => P[n]));
      appels++;
      const aMonter = new Set((res.unassigned || []).map((u) => amdDuJob(u.id))
        .filter((i) => Number.isInteger(i) && i >= 0 && i < nAmd && niv[i] < P.length - 1));
      if (!aMonter.size) break;
      aMonter.forEach((i) => { niv[i]++; });
    }
    return { res, reglages: niv.map((n) => P[n]), appels };
  }

  return { PAS, MIN_DEFAUT, FIN_REPOUSSEE, NORMAL, paliers, estForce, libelle, forcer };
}));
