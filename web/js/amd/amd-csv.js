/* Import des AMD depuis un fichier CSV — logique pure, sans DOM (testée dans tests/amd-csv.test.mjs).
   Format : UTF-8, séparateur « ; » (ou « , »), une ligne d'en-tête puis une ligne par AMD.
   Colonnes : code ; nom ; depart ; disponible ; heures_max ; km_max   (seul « nom » ou « code » est obligatoire).
   Tous les AMD sont habilités O2 : une colonne « o2 » éventuelle est ignorée.
   L'export Isadom (IdAmd;AmdCode;Civilite;AmdNom;AmdPrenom;IdAntenne;AntenneCode;Antenne;Mail;TelGsm) est reconnu tel quel :
   AmdCode -> code, AmdNom + AmdPrenom -> nom (« NOM Prénom »), Antenne (sinon AntenneCode) -> départ.
   Mail, téléphone et civilité ne sont jamais lus (minimisation RGPD). Le texte « NULL » est traité comme vide. */

export const AMD_CSV_COLS = [
  ['code', 'Non*', 'Code Isadom de l\'AMD (AnnAnnuaire.sCodeAnnuaire). Sert à retrouver l\'AMD existant.', 'GALJM'],
  ['nom', 'Non*', 'Nom affiché. *Au moins « code » ou « nom » est obligatoire. Une colonne « prenom » facultative est ajoutée au nom.', 'GALLIANO Jean-Marc'],
  ['depart', 'Non', 'Point de départ : antenne Isadom (ARARD 13), identifiant ou nom du point de départ. Vide : premier point de départ inclus dans le test.', 'ARARD 13'],
  ['disponible', 'Non', 'journee · matin · apres-midi · absent (défaut : journee)', 'journee'],
  ['heures_max', 'Non', 'Heures de conduite max par jour (défaut : paramètre général)', '5'],
  ['km_max', 'Non', 'Kilomètres max par jour (défaut : paramètre général)', '250']
];

const ALIASES = {
  code: ['code', 'code_isadom', 'amdcode', 'code_amd', 'scodeannuaire'],
  nom: ['nom', 'amdnom', 'nom_amd', 'amd'],
  prenom: ['prenom', 'amdprenom', 'prenom_amd'],
  depart: ['depart', 'point_de_depart', 'antenne', 'depot'],
  departAlt: ['antennecode', 'antenne_code', 'code_antenne'],
  dispo: ['disponible', 'dispo', 'disponibilite'],
  hmax: ['heures_max', 'heures_maxi', 'hmax', 'heures'],
  kmmax: ['km_max', 'km_maxi', 'kmmax', 'km']
};

/* utilitaires partagés : js/commun/texte-core.js (window.OptiTexte), lu à l'appel */
export const norm = (s) => globalThis.OptiTexte.norm(s);
export const parseCsv = (text) => globalThis.OptiTexte.parseCsv(text);

export function parseDispo(v) {
  const n = norm(v);
  if (n === '' || n.startsWith('journ') || n === 'jour') return 'journee';
  if (n.startsWith('mat')) return 'matin';
  if (n.startsWith('apres') || n === 'am' || n === 'pm' || n === 'aprem') return 'am';
  if (n.startsWith('abs')) return 'absent';
  return null;
}
const parseNum = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) && x >= 0 ? x : null; };

/* Retrouve le point de départ : id, libellé Isadom de l'antenne (ARARD 13), nom ; sinon correspondance partielle unique. */
export function findDepot(value, depots) {
  const n = norm(value); if (!n) return null;
  const exact = depots.find((d) => norm(d.id) === n || (d.isadom && norm(d.isadom) === n) || norm(d.nom) === n);
  if (exact) return exact;
  const part = depots.filter((d) => norm(d.nom).includes(n) || (d.isadom && norm(d.isadom).includes(n)));
  return part.length === 1 ? part[0] : null;
}

/* Prépare l'import. Ne modifie pas `existing` : renvoie la nouvelle liste et le compte rendu.
   - AMD retrouvé par code Isadom, sinon par nom identique (sans accents ni casse)
   - seules les colonnes présentes dans le fichier écrasent les valeurs existantes
   - les AMD absents du fichier sont conservés */
export function planAmdImport(text, existing, params) {
  const rows = parseCsv(text);
  const rep = { fatal: null, created: [], updated: [], errors: [], warnings: [], total: 0 };
  if (rows.length < 2) { rep.fatal = 'Fichier vide ou sans ligne de données.'; return { amd: existing, ...rep }; }
  const head = rows[0].map((h) => norm(h).replace(/ /g, '_'));
  const idx = {}; Object.entries(ALIASES).forEach(([k, al]) => { idx[k] = head.findIndex((h) => al.includes(h)); });
  if (idx.code < 0 && idx.nom < 0) {
    rep.fatal = 'Colonne « code » ou « nom » absente. Vérifiez la ligne d\'en-tête et le séparateur point-virgule.';
    return { amd: existing, ...rep };
  }
  const depots = params.depots || [];
  const defaultDepot = depots.find((d) => d.actif) || depots[0];
  const amd = existing.map((a) => Object.assign({}, a));
  const seenKeys = new Map(); const noDepot = [];

  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const get = (c) => { const v = idx[c] >= 0 ? (r[idx[c]] || '').trim() : ''; return /^null$/i.test(v) ? '' : v; };
    const has = (c) => idx[c] >= 0;
    const code = get('code'); const nom = [get('nom'), get('prenom')].filter(Boolean).join(' ').replace(/\s+/g, ' '); const pb = [];
    if (!code && !nom) { rep.errors.push(`Ligne ${line} : ni code ni nom`); return; }

    const patch = {};
    const dep = get('depart') || get('departAlt');
    if (has('depart') || has('departAlt')) {
      if (dep) {
        const d = findDepot(dep, depots);
        if (d) patch.depot = d.id; else pb.push('point de départ inconnu « ' + dep + ' »');
      }
    }
    if (has('dispo')) { const d = parseDispo(get('dispo')); if (d) patch.dispo = d; else pb.push('disponibilité invalide « ' + get('dispo') + ' »'); }
    if (has('hmax') && get('hmax') !== '') { const x = parseNum(get('hmax')); if (x != null) patch.hmax = x; else pb.push('heures max invalides « ' + get('hmax') + ' »'); }
    if (has('kmmax') && get('kmmax') !== '') { const x = parseNum(get('kmmax')); if (x != null) patch.kmmax = x; else pb.push('km max invalides « ' + get('kmmax') + ' »'); }
    if (pb.length) { rep.errors.push(`Ligne ${line} (${nom || code}) : ${pb.join(', ')}`); return; }

    const key = code ? 'c:' + code.toLowerCase() : 'n:' + norm(nom);
    if (seenKeys.has(key)) rep.warnings.push(`Ligne ${line} : « ${nom || code} » déjà présent à la ligne ${seenKeys.get(key)}, la dernière ligne l'emporte`);
    seenKeys.set(key, line);

    let target = code ? amd.find((a) => String(a.code || '').trim().toLowerCase() === code.toLowerCase()) : null;
    if (!target && nom) target = amd.find((a) => norm(a.nom) === norm(nom) && (!code || !a.code));
    if (target) {
      Object.assign(target, patch);
      if (code) target.code = code;
      if (nom) target.nom = nom;
      if (!rep.updated.includes(target)) rep.updated.push(target);
      return;
    }
    const a = { nom: nom || code, depot: patch.depot, dispo: patch.dispo || 'journee', hmax: patch.hmax ?? params.hmax, kmmax: patch.kmmax ?? params.kmmax, actif: true };
    if (code) a.code = code;
    if (!a.depot) { a.depot = defaultDepot && defaultDepot.id; noDepot.push(a.nom); }
    amd.push(a); rep.created.push(a);
  });
  if (noDepot.length) {
    rep.warnings.unshift(`${noDepot.length} AMD créé${noDepot.length > 1 ? 's' : ''} sans antenne dans le fichier : ${defaultDepot ? defaultDepot.nom : 'aucun point de départ'} appliqué, à corriger dans la liste (${noDepot.slice(0, 8).join(', ')}${noDepot.length > 8 ? '…' : ''})`);
  }
  rep.total = rows.length - 1;
  return { amd, ...rep };
}
