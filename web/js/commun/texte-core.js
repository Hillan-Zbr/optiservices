/* Optiservices — utilitaires de texte, de dates et de CSV partagés (sans DOM)
   Script classique chargé EN PREMIER (avant les autres *-core.js et app.js). Expose window.OptiTexte ;
   testable sous Node (module.exports). Les modules ES (amd-csv.js) le lisent via globalThis.OptiTexte. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiTexte = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* retire les accents (« Énergie » -> « Energie ») */
  const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  /* forme de comparaison : sans accents ni casse, ponctuation remplacée par des espaces */
  const norm = (s) => sansAccents(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /* accord simple : pluriel(2, 'RDV importé') -> « 2 RDV importés » ; forme plurielle explicite si besoin */
  const pluriel = (n, un, plusieurs) => n + ' ' + (n > 1 ? (plusieurs || un.replace(/(\S+)$/, '$1s')) : un);
  /* « s » final quand n > 1, pour les phrases où le mot n'est pas juste après le nombre */
  const s = (n, suffixe = 's') => (n > 1 ? suffixe : '');

  /* date locale AAAA-MM-JJ (toISOString donnerait la date UTC : la veille entre minuit et 2 h à Paris) */
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* jj/mm/aaaa, j/m/aa, jj.mm.aaaa ou AAAA-MM-JJ -> AAAA-MM-JJ ; null si la date n'existe pas (32/10…) */
  function parseDate(v) {
    v = String(v ?? '').trim();
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    const iso = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    if (!iso) return null;
    const d = new Date(iso + 'T12:00:00Z'); // midi UTC : la conversion ne change jamais de jour
    return !isNaN(d) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }

  /* lecture CSV : séparateur « ; » ou « , » deviné sur l'en-tête, guillemets doublés, BOM ignoré, lignes vides retirées */
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  /* cellule CSV pour Excel : guillemets systématiques, retours à la ligne aplatis.
     Une valeur qui commence par = + - @ (ou tabulation) serait exécutée comme une formule : on la préfixe d'une apostrophe. */
  function csvCell(v) {
    let t = String(v ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }
  /* fichier CSV pour Excel : BOM UTF-8, en-tête sans guillemets, séparateur « ; », fins de ligne Windows */
  const toCsv = (entete, lignes) => '﻿' + [entete.join(';')].concat(lignes.map((l) => l.map(csvCell).join(';'))).join('\r\n');

  return { sansAccents, norm, pluriel, s, isoLocal, parseDate, parseCsv, csvCell, toCsv };
}));
