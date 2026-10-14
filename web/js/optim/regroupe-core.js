/* Optiservices — regroupement des RDV d'un même patient (sans DOM)
   Script classique chargé AVANT app.js. Expose window.OptiRegroupe ; testable sous Node (module.exports).

   Besoin (14/10/2026) : quand un patient a plusieurs RDV le même jour chez le même AMD, à la même adresse,
   ses visites doivent se suivre (ex. O2G puis LIVO2L), même si un autre patient habite à la même adresse.
   VROOM ne sait pas imposer « à la suite » : on fusionne ces RDV en un seul job avant le calcul
   (durées additionnées, un seul stationnement, créneau = intersection des créneaux),
   puis on éclate l'étape du job fusionné dans la réponse VROOM en une étape par RDV.

   Entrée de grouper() : une ligne par job VROOM, dans l'ordre des jobs (index j -> id j + 1) :
     { cle (patient + AMD ; vide = jamais regroupé), lon, lat, fenetre: [debut, fin] (s) } */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiRegroupe = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  /* au-delà de cette distance, deux RDV d'un même patient ne sont pas considérés à la même adresse */
  const DISTANCE_MAX_M = 500;

  function distanceM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* groupes d'index (ordre d'origine conservé) ; un RDV seul forme un groupe d'un élément */
  function grouper(lignes) {
    const groupes = [];
    lignes.forEach((l, i) => {
      const g = l.cle && groupes.find((x) => {
        const t = lignes[x.membres[0]];
        return t.cle === l.cle && distanceM(t, l) <= DISTANCE_MAX_M &&
          Math.max(x.fenetre[0], l.fenetre[0]) <= Math.min(x.fenetre[1], l.fenetre[1]);
      });
      if (g) {
        g.membres.push(i);
        g.fenetre = [Math.max(g.fenetre[0], l.fenetre[0]), Math.min(g.fenetre[1], l.fenetre[1])];
      } else groupes.push({ membres: [i], fenetre: l.fenetre.slice() });
    });
    return groupes;
  }

  /* jobs VROOM fusionnés : le job d'un groupe garde l'id de son premier RDV */
  function fusionnerJobs(jobs, groupes) {
    return groupes.map((g) => {
      const tete = jobs[g.membres[0]];
      if (g.membres.length === 1) return tete;
      return Object.assign({}, tete, {
        service: g.membres.reduce((s, i) => s + (Number(jobs[i].service) || 0), 0),
        time_windows: [g.fenetre.slice()]
      });
    });
  }

  /* réponse VROOM éclatée : une étape (ou un non affecté) par RDV d'origine */
  function eclaterReponse(res, jobs, groupes) {
    const parTete = new Map(groupes.filter((g) => g.membres.length > 1).map((g) => [jobs[g.membres[0]].id, g]));
    if (!parTete.size || !res) return res;
    const out = Object.assign({}, res);
    out.routes = (res.routes || []).map((r) => {
      const steps = [];
      for (const st of r.steps || []) {
        const g = st.type === 'job' && parTete.get(st.job ?? st.id);
        if (!g) { steps.push(st); continue; }
        let t = (Number(st.arrival) || 0) + (Number(st.waiting_time) || 0) + (Number(st.setup) || 0);
        g.membres.forEach((i, k) => {
          const j = jobs[i]; const svc = Number(j.service) || 0;
          const e = Object.assign({}, st, { id: j.id, description: j.description, service: svc });
          if ('job' in st) e.job = j.id;
          if (k > 0) Object.assign(e, { arrival: t, setup: 0, waiting_time: 0, duration: st.duration, distance: st.distance });
          if (k > 0 && 'location_index' in st) e.location_index = st.location_index;
          steps.push(e);
          t += svc;
        });
      }
      return Object.assign({}, r, { steps });
    });
    out.unassigned = [];
    for (const u of res.unassigned || []) {
      const g = parTete.get(u.id);
      if (!g) { out.unassigned.push(u); continue; }
      g.membres.forEach((i) => out.unassigned.push(Object.assign({}, u, { id: jobs[i].id, description: jobs[i].description })));
    }
    return out;
  }

  return { DISTANCE_MAX_M, distanceM, grouper, fusionnerJobs, eclaterReponse };
}));
