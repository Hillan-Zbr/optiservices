/* Optiservices — géocodage BAN en cascade (sans DOM ni réseau)
   Script classique chargé AVANT app.js. Expose window.OptiGeocode ; testable sous Node (module.exports).

   Besoin (14/10/2026) : la BAN ne trouve rien dès qu'une adresse Isadom contient un complément
   (« résidence … », « BAT I », « APPART A39 », « BP 1 »…) ou une abréviation (« AVE », « ROU »).
   On tente donc plusieurs recherches, de la plus précise à la plus large :
     1. l'adresse telle quelle ;
     2. l'adresse nettoyée (compléments et nom d'établissement retirés, abréviations développées) ;
     3. l'adresse nettoyée sans ses derniers mots (lieu-dit ou résidence collés à la voie) ;
     4. l'adresse nettoyée sans code postal (code postal erroné) ;
     5. la commune seule, puis le hameau dans le code postal, puis le code postal seul (précision « commune »).
   Un résultat n'est retenu que s'il est dans la zone de la carte, dans la commune du RDV,
   avec un score suffisant et un nom de voie qui partage au moins un mot avec l'adresse
   (sinon la BAN renvoie n'importe quelle rue de la commune).

   localise(rd, chercher, options) : rd = { adresse, cp, ville } ;
     chercher({ q, postcode, type }) -> Promise<[{ lon, lat, label, score, type, name, city, postcode }]>
   Retourne { lon, lat, label, score, precision: 'adresse' | 'rue' | 'commune', etape }, ou
   { none: true, horsZone: true, label } si seul un point hors carte a été trouvé, ou null. */
(function (root, factory) {
  const T = typeof module === 'object' && module.exports ? require('../commun/texte-core.js') : root.OptiTexte;
  const api = factory(T);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiGeocode = api;
}(typeof window !== 'undefined' ? window : globalThis, function (T) {
  const SEUIL_BON = 0.6;   // au-dessus : on arrête de chercher
  const SEUIL_MIN = 0.45;  // en dessous : résultat rejeté (souvent une rue au hasard de la commune)

  const ABREV = {
    AV: 'AVENUE', AVE: 'AVENUE', AVN: 'AVENUE',
    BD: 'BOULEVARD', BLD: 'BOULEVARD', BVD: 'BOULEVARD', BOUL: 'BOULEVARD',
    CHE: 'CHEMIN', CHEM: 'CHEMIN', CHM: 'CHEMIN', CHMN: 'CHEMIN',
    RTE: 'ROUTE', ROU: 'ROUTE',
    IMP: 'IMPASSE', ALL: 'ALLEE', PL: 'PLACE',
    QUA: 'QUARTIER', QUART: 'QUARTIER', QRT: 'QUARTIER',
    TRA: 'TRAVERSE', TRAV: 'TRAVERSE', TRV: 'TRAVERSE',
    MTE: 'MONTEE', LOT: 'LOTISSEMENT', LOTISS: 'LOTISSEMENT',
    CRS: 'COURS', SQ: 'SQUARE', HAM: 'HAMEAU', FG: 'FAUBOURG', FBG: 'FAUBOURG',
    PROM: 'PROMENADE', PSG: 'PASSAGE',
    ST: 'SAINT', STE: 'SAINTE'
  };
  const VOIES = new Set(['RUE', 'ROUTE', 'AVENUE', 'BOULEVARD', 'CHEMIN', 'IMPASSE', 'ALLEE', 'PLACE', 'QUARTIER',
    'TRAVERSE', 'MONTEE', 'LOTISSEMENT', 'COURS', 'SQUARE', 'HAMEAU', 'FAUBOURG', 'PROMENADE', 'PASSAGE', 'QUAI',
    'ESPLANADE', 'DESCENTE', 'SENTIER', 'VOIE', 'CHEMINEMENT', 'RAMPE', 'CLOS']);
  // tout ce qui suit l'un de ces mots est un complément d'adresse, inconnu de la BAN
  const PARASITES = new Set(['RESIDENCE', 'RES', 'RESID', 'RSD', 'BAT', 'BATIMENT', 'APPT', 'APPART', 'APPARTEMENT',
    'APT', 'APP', 'ETAGE', 'ETG', 'ESC', 'ESCALIER', 'PORTE', 'CHEZ', 'BP', 'CS', 'TSA', 'CEDEX', 'LOGEMENT', 'LGT',
    'IMMEUBLE', 'IMM', 'ENTREE', 'PAVILLON']);
  // nom d'établissement collé derrière la voie (« CHEMIN X INSTITUT DE … ») : coupé seulement s'il suit un mot
  // de la voie, pour garder « RUE DU CENTRE » ou « AVENUE DE LA CLINIQUE »
  const ETABLISSEMENTS = new Set(['INSTITUT', 'CENTRE', 'CLINIQUE', 'POLYCLINIQUE', 'HOPITAL', 'EHPAD', 'FOYER', 'MAISON',
    'CHU', 'CHS', 'CRF', 'SSR', 'USLD', 'ETABLISSEMENT']);
  const SUFFIXES = new Set(['BIS', 'TER', 'QUATER']);
  const estOrdinal = (t) => /^\d+(E|ER|ERE|EME|IEME|ND|NDE)$/.test(t); // « 2EME », « 2IEME », « 1ER »
  const VIDES = new Set(['LE', 'LA', 'LES', 'L', 'D', 'DE', 'DU', 'DES', 'ET', 'AU', 'AUX', 'EN', 'A', 'SUR', 'SOUS']);
  const LIEU_DIT = new Set(['LD', 'LIEUDIT']);

  const maj = (s) => T.sansAccents(s || '').toUpperCase()
    .replace(/LIEU[\s-]*DIT/g, 'LIEUDIT').replace(/[^A-Z0-9]+/g, ' ').trim();
  const estNumero = (t) => /^\d+[A-Z]?$/.test(t);
  /* mots en majuscules, abréviations développées (« R » ne vaut « RUE » qu'après un numéro) */
  function mots(s) {
    const t = maj(s).split(' ').filter(Boolean);
    return t.map((m, i) => ABREV[m] || (m === 'R' && i > 0 && estNumero(t[i - 1]) ? 'RUE' : m));
  }
  /* début de la voie : « 12 RUE … », « 12 BIS RUE … » ou « RUE … » */
  function debutVoie(t) {
    for (let i = 0; i < t.length; i++) {
      if (VOIES.has(t[i])) return i > 0 && estNumero(t[i - 1]) ? i - 1 : i > 1 && SUFFIXES.has(t[i - 1]) && estNumero(t[i - 2]) ? i - 2 : i;
    }
    return -1;
  }

  /* adresse sans complément ni marqueur de lieu-dit, abréviations développées */
  function nettoie(adresse) {
    let t = mots(adresse).filter((m) => !LIEU_DIT.has(m));
    const d = debutVoie(t);
    if (d > 0) t = t.slice(d); // « RESIDENCE X 12 RUE Y » -> « 12 RUE Y »
    const voie = debutVoie(t) === 0;
    const p = t.findIndex((m, i) => i > 0 && (PARASITES.has(m) || (voie && ETABLISSEMENTS.has(m) && significatifs(t.slice(0, i)).length > 0)));
    if (PARASITES.has(t[0])) t = []; // rien d'exploitable avant le complément
    else if (p > 0) t = t.slice(0, p);
    while (t.length && (estNumero(t[t.length - 1]) || VIDES.has(t[t.length - 1]) || estOrdinal(t[t.length - 1]))) t.pop();
    return t.join(' ');
  }
  /* mots qui identifient la voie : ni numéro, ni type de voie, ni article */
  const significatifs = (t) => t.filter((m) => !estNumero(m) && !VOIES.has(m) && !VIDES.has(m) && !SUFFIXES.has(m));

  /* variantes de l'adresse nettoyée sans ses 1 à 3 derniers mots significatifs (on en garde au moins un) */
  function raccourcies(adrNette) {
    const t = adrNette.split(' ').filter(Boolean);
    if (debutVoie(t) < 0) return [];
    const res = []; let cur = t.slice();
    for (let k = 0; k < 3; k++) {
      if (significatifs(cur).length < 2) break;
      cur.pop();
      while (cur.length && (VIDES.has(cur[cur.length - 1]) || SUFFIXES.has(cur[cur.length - 1]))) cur.pop();
      res.push(cur.join(' '));
    }
    return res;
  }

  const villeNette = (v) => maj(v).split(' ').map((m) => ABREV[m] || m)
    .filter((m) => m !== 'CEDEX' && !/^\d+$/.test(m) && !estOrdinal(m)).join(' ');
  /* même commune : noms égaux, l'un préfixe de l'autre (« PLAN D AUPS » / « PLAN D AUPS SAINTE BAUME »), ou mots inclus */
  function villeOk(f, rd) {
    const b = villeNette(rd.ville);
    if (!b) return !rd.cp || f.postcode === rd.cp;
    const a = villeNette(f.city);
    if (!a) return false;
    if (a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ')) return true;
    const wa = new Set(a.split(' '));
    return b.split(' ').every((m) => wa.has(m));
  }

  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  /* tolère une faute de frappe ou un pluriel (« COLLOMBE » / « COLOMBE », « CERISIER » / « CERISIERS ») */
  const motProche = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && distance(a, b) <= 1);
  function voieOk(f, adr) {
    const q = significatifs(mots(adr));
    if (!q.length) return false;
    const n = significatifs(mots(f.name || f.label));
    return q.some((m) => n.some((x) => motProche(m, x)));
  }

  const precisionDe = (f) => (f.type === 'housenumber' ? 'adresse' : f.type === 'municipality' ? 'commune' : 'rue');

  /* recherches à tenter sur l'adresse, sans doublon */
  function tentatives(rd) {
    const ville = villeNette(rd.ville);
    const brute = maj(rd.adresse), nette = nettoie(rd.adresse);
    const liste = [];
    const ajoute = (adr, postcode, etape) => {
      const q = (adr + ' ' + ville).trim().slice(0, 200);
      if (adr.length < 3 || liste.some((t) => t.q === q && t.postcode === postcode)) return;
      liste.push({ q, adr, postcode, etape });
    };
    if (rd.adresse) {
      ajoute(brute, rd.cp || undefined, 'adresse brute');
      ajoute(nette, rd.cp || undefined, 'adresse nettoyée');
      raccourcies(nette).forEach((a) => ajoute(a, rd.cp || undefined, 'adresse raccourcie'));
      if (rd.cp) ajoute(nette, undefined, 'sans code postal');
    }
    return liste;
  }

  async function localise(rd, chercher, { dansZone = () => true } = {}) {
    let best = null, horsZone = null;
    const garde = (fs, adr, etape) => {
      fs.forEach((f) => {
        if (f.type === 'municipality' || f.score < SEUIL_MIN || !villeOk(f, rd) || !voieOk(f, adr)) return;
        if (!dansZone(f)) { horsZone = horsZone || f; return; }
        if (!best || f.score > best.score) best = Object.assign({}, f, { precision: precisionDe(f), etape });
      });
    };
    for (const t of tentatives(rd)) {
      garde(await chercher({ q: t.q, postcode: t.postcode }), t.adr, t.etape);
      if (best && best.score >= SEUIL_BON) break;
    }
    if (!best && rd.ville) {
      const q = villeNette(rd.ville);
      for (const postcode of rd.cp ? [rd.cp, undefined] : [undefined]) {
        if (q.length < 3) break;
        const fs = (await chercher({ q, postcode, type: 'municipality' })).filter((f) => villeOk(f, rd));
        const f = fs.find(dansZone);
        if (f) { best = Object.assign({}, f, { precision: 'commune', etape: 'commune seule' }); break; }
        if (fs.length) horsZone = horsZone || fs[0];
      }
    }
    // la « ville » Isadom est parfois un hameau (« FOLELLI », commune de Penta-di-Casinca) : une voie
    // du même code postal qui porte son nom (« Avenue de Folelli ») situe le hameau
    if (!best && rd.ville && rd.cp && villeNette(rd.ville).length >= 3) {
      const fs = (await chercher({ q: villeNette(rd.ville), postcode: rd.cp }))
        .filter((f) => f.type !== 'municipality' && f.postcode === rd.cp && voieOk(f, rd.ville));
      const f = fs.find(dansZone);
      if (f) best = Object.assign({}, f, { precision: 'commune', etape: 'hameau (code postal)' });
      else if (fs.length) horsZone = horsZone || fs[0];
    }
    // dernier recours : la première commune du code postal
    if (!best && rd.cp) {
      const fs = (await chercher({ q: rd.cp, postcode: rd.cp, type: 'municipality' })).filter((f) => f.postcode === rd.cp);
      const f = fs.find(dansZone);
      if (f) best = Object.assign({}, f, { precision: 'commune', etape: 'code postal seul' });
      else if (fs.length) horsZone = horsZone || fs[0];
    }
    if (best) {
      const { lon, lat, label, score, precision, etape } = best;
      return { lon, lat, label, score, precision, etape };
    }
    return horsZone ? { none: true, horsZone: true, label: horsZone.label } : null;
  }

  return { nettoie, raccourcies, tentatives, villeOk, voieOk, localise, SEUIL_BON, SEUIL_MIN };
}));
