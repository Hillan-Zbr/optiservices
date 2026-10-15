/* Optiservices — échanges avec MaJournée V2 (MJ2) : construction et contrôle des JSON (sans DOM)
   Script classique chargé AVANT app.js. Expose window.OptiMJ2 ; testable sous Node (module.exports).
   Contrat : docs/mj2-contrat.md (version 1.0). Optiservices pousse vers MJ2 (LAN → DMZ), jamais l'inverse.

   tournee(R, i, opts) : tournée de l'AMD d'indice i du résultat R (state.results[date]) :
     { date, amds, rdv, res: réponse VROOM, force }
   opts : { version, publieeLe, jourMeme, commentaire, antenne(a) -> { code, nom },
            fenetre(rd) -> [début, fin] en secondes, creneauNom(rd), duree(rd) -> minutes,
            typesOf(rd) -> codes, typeLibelle(code), forceLibelle(reglage) }
   message(m) : message flash ou début de tournée, complété des valeurs par défaut.
   Les contrôles renvoient une liste d'erreurs en français (vide si tout va bien). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiMJ2 = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VERSION_CONTRAT = '1.0';
  const TYPES_MESSAGE = ['flash', 'debut_tournee'];
  const CIBLES = ['tous', 'antenne', 'amd'];
  const PRIORITES = ['normale', 'haute'];
  const TITRE_MAX = 80, TEXTE_MAX = 2000;

  const hm = (s) => { s = Math.round((Number(s) || 0) / 60); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const txt = (v) => (v == null ? '' : String(v).trim());
  const arrondi = (x, n) => { const k = 10 ** n; return Math.round(x * k) / k; };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* horodatage ISO 8601 avec le fuseau local (+02:00), comme le demande le contrat */
  function horodatage(d = new Date()) {
    const p = (n) => String(Math.abs(n)).padStart(2, '0');
    const o = -d.getTimezoneOffset();
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
      + `${o >= 0 ? '+' : '-'}${p(Math.trunc(o / 60))}:${p(o % 60)}`;
  }

  /* identifiant de message : UUID v4 */
  function nouvelId() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function etape(rd, s, ordre, o) {
    const w = o.fenetre(rd); const a = rd.acces || {}; const g = rd.geo || {};
    return {
      ordre,
      id_rdv: txt(rd.idRdv),
      heure_estimee: hm(s.arrival),
      attente_min: Math.round((s.waiting_time || 0) / 60),
      duree_sur_place_min: Math.round(o.duree(rd)),
      creneau: { nom: o.creneauNom(rd), debut: hm(w[0]), fin: hm(w[1]) },
      // même règle que l'écran Résultat : début de visite après la fin du créneau Isadom
      hors_creneau: s.arrival + (s.waiting_time || 0) > w[1],
      patient: { nom: txt(rd.patient), code: txt(rd.patientCode) },
      adresse: {
        ligne: txt(rd.adresse), code_postal: txt(rd.cp), ville: txt(rd.ville),
        lat: Number.isFinite(g.lat) ? arrondi(g.lat, 6) : null, lon: Number.isFinite(g.lon) ? arrondi(g.lon, 6) : null
      },
      types_visite: o.typesOf(rd).map((c) => ({ code: txt(c), libelle: txt(o.typeLibelle(c)) })),
      type_visite: txt(rd.typeVisite),
      prestation: txt(rd.typePrestation),
      type_besoin: txt(rd.besoin),
      info_rdv: txt(rd.infoRdv),
      acces: { tel1: txt(a.tel1), tel2: txt(a.tel2), batiment: txt(a.batiment), etage: txt(a.etage), porte: txt(a.porte), interphone: txt(a.interphone), info: txt(a.info) },
      commentaire: ''
    };
  }

  function tournee(R, i, opts) {
    const o = Object.assign({ version: 1, publieeLe: horodatage(), jourMeme: false, commentaire: '', forceLibelle: () => '' }, opts);
    const a = R.amds[i];
    const route = ((R.res || {}).routes || []).find((x) => x.vehicle === i + 1);
    const steps = route ? route.steps : [];
    const debut = steps.find((s) => s.type === 'start');
    const fin = steps.find((s) => s.type === 'end');
    const pause = steps.find((s) => s.type === 'break');
    const jobs = steps.filter((s) => s.type === 'job' && R.rdv[s.job - 1]);
    return {
      version_contrat: VERSION_CONTRAT,
      date: R.date,
      version: o.version,
      publiee_le: o.publieeLe,
      modifiee_jour_meme: !!o.jourMeme,
      commentaire: txt(o.commentaire),
      amd: { code: txt(a.code), nom: txt(a.nom) },
      antenne: o.antenne(a),
      depart: { heure: debut ? hm(debut.arrival) : '' },
      retour: { heure: fin ? hm(fin.arrival) : '' },
      pause: pause ? { heure: hm(pause.arrival), duree_min: Math.round((pause.service || 0) / 60) } : null,
      distance_km: route ? arrondi((route.distance || 0) / 1000, 1) : 0,
      conduite_min: route ? Math.round((route.duration || 0) / 60) : 0,
      placement_force: txt(o.forceLibelle((R.force || [])[i])),
      etapes: jobs.map((s, n) => etape(R.rdv[s.job - 1], s, n + 1, o))
    };
  }

  function controleTournee(t) {
    const e = [];
    if (!t || typeof t !== 'object') return ['tournée absente'];
    if (!DATE_RE.test(t.date || '')) e.push('date invalide');
    if (!Number.isInteger(t.version) || t.version < 1) e.push('version invalide');
    if (!t.amd || !t.amd.code) e.push("code de l'AMD manquant (code annuaire Isadom)");
    (t.etapes || []).forEach((s, n) => {
      if (s.ordre !== n + 1) e.push(`étape ${n + 1} : ordre ${s.ordre} au lieu de ${n + 1}`);
      if (!s.id_rdv) e.push(`étape ${n + 1} : n° de RDV Isadom manquant`);
    });
    return e;
  }

  function message(m) {
    const cible = m.cible || { type: 'tous', codes: [] };
    return {
      version_contrat: VERSION_CONTRAT,
      id: m.id || nouvelId(),
      type: m.type,
      cible: { type: cible.type, codes: cible.type === 'tous' ? [] : (cible.codes || []).map(txt).filter(Boolean) },
      valide_du: m.valideDu,
      valide_au: m.valideAu || m.valideDu,
      priorite: m.priorite || 'normale',
      titre: txt(m.titre),
      texte: txt(m.texte),
      commentaire: txt(m.commentaire),
      auteur: txt(m.auteur) || 'Responsable',
      cree_le: m.creeLe || horodatage()
    };
  }

  function controleMessage(m) {
    const e = [];
    if (!m || typeof m !== 'object') return ['message absent'];
    if (!m.id) e.push('identifiant manquant');
    if (!TYPES_MESSAGE.includes(m.type)) e.push(`type « ${m.type} » inconnu (flash ou debut_tournee)`);
    if (!m.cible || !CIBLES.includes(m.cible.type)) e.push('cible inconnue (tous, antenne ou amd)');
    else if (m.cible.type !== 'tous' && !(m.cible.codes || []).length) e.push('cible sans antenne ni AMD');
    if (!DATE_RE.test(m.valide_du || '')) e.push('date de début invalide');
    if (!DATE_RE.test(m.valide_au || '')) e.push('date de fin invalide');
    else if (m.valide_au < m.valide_du) e.push('la date de fin précède la date de début');
    if (!PRIORITES.includes(m.priorite)) e.push('priorité inconnue (normale ou haute)');
    if (!m.texte) e.push('texte vide');
    else if (m.texte.length > TEXTE_MAX) e.push(`texte trop long (${TEXTE_MAX} caractères au plus)`);
    if ((m.titre || '').length > TITRE_MAX) e.push(`titre trop long (${TITRE_MAX} caractères au plus)`);
    return e;
  }

  /* chemins de l'API MJ2, relayés par nginx sous /mj2/ (ajout de la clé d'API côté serveur) */
  const chemins = {
    tournee: (date, amdCode) => `/mj2/api/v1/tournees/${encodeURIComponent(date)}/${encodeURIComponent(amdCode)}`,
    messages: () => '/mj2/api/v1/messages',
    message: (id) => `/mj2/api/v1/messages/${encodeURIComponent(id)}`,
    accuses: (depuis) => `/mj2/api/v1/accuses?depuis=${encodeURIComponent(depuis)}`
  };

  return { VERSION_CONTRAT, TYPES_MESSAGE, CIBLES, PRIORITES, horodatage, nouvelId, tournee, controleTournee, message, controleMessage, chemins };
}));
