/* Optiservices — statistiques d'une journée optimisée (sans DOM)
   Script classique chargé AVANT app.js. Expose window.OptiStats ; testable sous Node (module.exports).

   Entrée : le résultat enregistré d'une journée (state.results[date]) :
     { date, amds, rdv, excluded, horsAmd, res: réponse VROOM }
   horsAmd : RDV affectés à un AMD non prévu, retirés de l'optimisation ; listés à part (horsAmd), hors nRdv et non planifiés.
   et des fonctions d'accès fournies par app.js :
     typesOf(rd) -> codes de type de visite du RDV
     motifNonAffecte(rd) -> motif d'un RDV que VROOM n'a pas pu placer
     amdIdxOf(rd) -> (facultatif) indice de l'AMD du RDV dans R.amds, -1 si aucun ; à défaut rd.amdIdx
   Un RDV à plusieurs types de visite est compté dans chacun de ses types.
   R.force (facultatif) : réglage du placement forcé par AMD (OptiForce), repris tel quel dans amd[i].force. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiStats = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MOTIF_DEFAUT = 'adresse introuvable';

  /* { code: nombre } trié par nombre décroissant puis par code */
  function repartition(list, typesOf) {
    const m = new Map();
    list.forEach((rd) => [...new Set(typesOf(rd))].forEach((c) => m.set(c, (m.get(c) || 0) + 1)));
    return [...m].map(([code, n]) => ({ code, n }))
      .sort((a, b) => b.n - a.n || String(a.code).localeCompare(String(b.code), 'fr', { numeric: true }));
  }

  function computeStats(R, { typesOf, motifNonAffecte, amdIdxOf }) {
    const res = R.res || { routes: [], unassigned: [], summary: {} };
    const rdv = R.rdv || []; const excluded = R.excluded || [];
    const aPlanifier = rdv.concat(excluded);

    // non planifiés : écartés avant le calcul (adresse, carte) puis non placés par VROOM
    const non = excluded.map((rd) => ({ rd, motif: rd.motif || MOTIF_DEFAUT, etape: 'écarté du calcul' }))
      .concat((res.unassigned || []).map((u) => rdv[u.id - 1]).filter(Boolean)
        .map((rd) => ({ rd, motif: motifNonAffecte(rd), etape: 'non affecté' })));
    const idxOf = amdIdxOf || ((rd) => (Number.isInteger(rd.amdIdx) ? rd.amdIdx : -1));

    const amd = (R.amds || []).map((a, i) => {
      const r = res.routes.find((x) => x.vehicle === i + 1);
      const jobs = r ? r.steps.filter((s) => s.type === 'job').map((s) => rdv[s.job - 1]).filter(Boolean) : [];
      return { nom: a.nom, code: a.code || '', depot: a.depot, n: jobs.length, nonPlaces: non.filter((x) => idxOf(x.rd) === i).length, parType: repartition(jobs, typesOf), force: (R.force || [])[i] || null, distance: r ? r.distance || 0 : 0, duration: r ? r.duration || 0 : 0 };
    });
    const parMotif = new Map();
    non.forEach((x) => { if (!parMotif.has(x.motif)) parMotif.set(x.motif, []); parMotif.get(x.motif).push(x); });

    const planifies = amd.reduce((s, a) => s + a.n, 0);
    // RDV sur des AMD non prévus : regroupés par AMD Isadom
    const parAmd = new Map();
    (R.horsAmd || []).forEach((rd) => {
      const k = String(rd.amdActuel || '').trim();
      if (!parAmd.has(k)) parAmd.set(k, { amd: k, motif: rd.motifAmd || '', liste: [] });
      parAmd.get(k).liste.push(rd);
    });
    return {
      date: R.date,
      nRdv: aPlanifier.length,
      parType: repartition(aPlanifier, typesOf),
      nAmd: amd.length,
      nAmdMobilises: amd.filter((a) => a.n > 0).length,
      amd,
      planifies,
      distance: amd.reduce((s, a) => s + a.distance, 0),
      duration: amd.reduce((s, a) => s + a.duration, 0),
      nonPlanifies: {
        total: non.length,
        parMotif: [...parMotif].map(([motif, liste]) => ({ motif, n: liste.length, liste }))
          .sort((a, b) => b.n - a.n || a.motif.localeCompare(b.motif, 'fr'))
      },
      horsAmd: {
        total: (R.horsAmd || []).length,
        parAmd: [...parAmd.values()].map((g) => Object.assign(g, { n: g.liste.length }))
          .sort((a, b) => b.n - a.n || a.amd.localeCompare(b.amd, 'fr'))
      }
    };
  }

  return { computeStats, repartition };
}));
