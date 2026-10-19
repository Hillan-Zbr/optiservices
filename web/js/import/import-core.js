/* Optiservices — règles de lecture des imports CSV de RDV (sans DOM)
   Script classique chargé AVANT app.js, après js/commun/texte-core.js. Expose window.OptiImport ;
   testable sous Node (module.exports). app.js garde l'affichage du compte rendu et le journal. */
(function (root, factory) {
  const T = typeof module === 'object' && module.exports ? require('../commun/texte-core.js') : root.OptiTexte;
  const api = factory(T);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiImport = api;
}(typeof window !== 'undefined' ? window : globalThis, function (T) {
  'use strict';

  const hm2s = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };

  /* « 08:15:00 », « 1900-01-01 8:15 » -> « 08:15 » ; vide si aucune heure */
  const hhmm = (v) => { const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };

  /* code postal : espaces retirés, zéro initial rendu (Excel le supprime) ; null si ce n'est pas 5 chiffres */
  function cpNormalise(v) {
    let cp = String(v || '').replace(/\s/g, '');
    if (/^\d{4}$/.test(cp)) cp = '0' + cp;
    return /^\d{5}$/.test(cp) ? cp : null;
  }

  /* demi-journée saisie dans le CSV du banc de test */
  function parseCren(v) {
    const n = T.norm(v);
    if (n === 'matin' || n === 'am matin') return 'matin';
    if (n.startsWith('mi')) return 'mi';
    if (n.startsWith('apres') || n === 'pm' || n === 'aprem') return 'am';
    return null;
  }

  /* demi-journée d'un RDV Isadom : libellé s'il est fourni, sinon déduite des heures
     (Matin si fin <= 13h00, Après-midi si début >= 12h00, Journée sinon ou sans heures) */
  function crenFromIsadom(label, hDeb, hFin) {
    const n = T.norm(label);
    if (n === 'matin') return 'matin';
    if (n.startsWith('apres')) return 'am';
    if (n.startsWith('journee')) return 'jour';
    if (hDeb && hFin) { if (hm2s(hFin) <= hm2s('13:00')) return 'matin'; if (hm2s(hDeb) >= hm2s('12:00')) return 'am'; }
    return 'jour';
  }

  /* case à cocher Isadom exportée en CSV : « 1 », « True », « Vrai »… */
  const coche = (v) => /^(1|true|vrai|oui)$/i.test(String(v || '').trim());

  /* préférence de passage de la fréquence oxygène (OrdOxyAnnuaireFrequenceVisite.bMatin / bApresMidi, 19/10/2026) :
     'matin' ou 'am' si une seule demi-journée est cochée ; null si aucune ou les deux (pas de contrainte) */
  function prefPassage(matin, apresMidi) {
    const m = coche(matin), a = coche(apresMidi);
    return m === a ? null : m ? 'matin' : 'am';
  }

  /* fenêtre de passage [début, fin] (secondes) réduite à la demi-journée préférée wPref ;
     si elles ne se recouvrent pas (RDV posé sur l'autre demi-journée dans Isadom), le créneau Isadom l'emporte */
  function fenetrePref(w, wPref) {
    if (!wPref) return { w, conflit: false };
    const deb = Math.max(w[0], wPref[0]), fin = Math.min(w[1], wPref[1]);
    return fin > deb ? { w: [deb, fin], conflit: false } : { w, conflit: true };
  }

  /* coordonnées Isadom : W3W figées > lat/lon Isadom > W3W non figées ; null sinon (géocodage BAN).
     get(colonne) lit la ligne ; dansZone({lat, lon}) rejette les points hors de la carte (erreurs de saisie) */
  function isadomGeo(get, dansZone) {
    const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };
    const pt = (la, lo) => { const lat = num(get(la)), lon = num(get(lo)); return lat != null && lon != null && dansZone({ lat, lon }) ? { lat, lon } : null; };
    const w = pt('w3wlat', 'w3wlon'), c = pt('lat', 'lon');
    if (w && get('w3wfigee') === '1') return Object.assign(w, { label: 'What3Words figé (Isadom)', score: 1, src: 'w3w' });
    if (c) return Object.assign(c, { label: 'Coordonnées Isadom' + (get('geofigee') === '1' ? ' (figées)' : ''), score: 1, src: 'isadom' });
    if (w) return Object.assign(w, { label: 'What3Words (Isadom)', score: 1, src: 'w3w' });
    return null;
  }

  /* fusion d'un export Isadom dans les RDV existants : un RDV déjà connu (même IdRdv) est remplacé ;
     un RDV Isadom d'une date couverte par le fichier mais absent du fichier est retiré (annulé ou déplacé) ;
     les RDV saisis à la main sont conservés. nouveaux : Map IdRdv -> RDV, dates : Set des dates du fichier */
  function fusionIsadom(existants, nouveaux, dates) {
    let updated = 0, removed = 0;
    const keep = existants.filter((r) => {
      if (r.idRdv && nouveaux.has(r.idRdv)) { updated++; return false; }
      if (r.idRdv && dates.has(r.date)) { removed++; return false; }
      return true;
    });
    return { rdv: keep.concat([...nouveaux.values()]), updated, removed, added: nouveaux.size - updated };
  }

  return { hhmm, cpNormalise, parseCren, crenFromIsadom, prefPassage, fenetrePref, isadomGeo, fusionIsadom };
}));
