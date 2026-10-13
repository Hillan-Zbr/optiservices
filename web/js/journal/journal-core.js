/* Optiservices — journal d'activité : stockage et logique (sans DOM)
   Script classique chargé AVANT app.js pour que tout le code puisse journaliser de façon synchrone.
   Expose window.OptiJournal ; testable sous Node (module.exports).

   Une entrée = { id, ts (ISO), niveau: 'info'|'warn'|'crit', categorie, action, message, details }
   Catégories : import (intégration CSV), action (actions utilisateur), parametres, optimisation, systeme.
   Persistance : localStorage (clé dédiée, distincte des données métier), rotation à MAX_ENTREES. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OptiJournal = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const KEY = 'optiservices.journal.v1';
  const SEEN_KEY = 'optiservices.journal.vu';
  const MAX_ENTREES = 3000; // ≈ 1 Mo : laisse la place aux données métier dans le localStorage
  const NIVEAUX = ['info', 'warn', 'crit'];
  const CATEGORIES = {
    import: 'Intégration CSV',
    action: 'Action utilisateur',
    parametres: 'Paramètres',
    optimisation: 'Optimisation',
    systeme: 'Système'
  };

  /* stockage injectable (tests) ; localStorage peut être absent ou lever une exception */
  let store = null;
  try { store = root.localStorage || null; } catch (e) { store = null; }

  let entries = [];
  let seq = 0;
  const listeners = new Set();

  function read() {
    try { const j = JSON.parse(store && store.getItem(KEY)); entries = Array.isArray(j) ? j : []; } catch (e) { entries = []; }
    seq = entries.reduce((m, e) => Math.max(m, e.id || 0), 0);
  }
  /* écriture groupée : un import peut produire des centaines de lignes d'affilée */
  let dirty = false;
  function schedule() {
    if (dirty) return; dirty = true;
    if (typeof root.setTimeout === 'function' && root.document) root.setTimeout(flush, 0); else flush();
  }
  function flush() { if (!dirty) return; dirty = false; write(); }
  function write() {
    if (!store) return;
    for (;;) {
      try { store.setItem(KEY, JSON.stringify(entries)); return; } catch (e) {
        // quota dépassé : on abandonne la moitié la plus ancienne et on réessaie
        if (entries.length < 20) return;
        entries = entries.slice(Math.floor(entries.length / 2));
      }
    }
  }
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* écouteur défaillant : ignoré */ } });

  /* sérialise les détails (objet, tableau, erreur) en texte lisible sur une ligne CSV */
  function detailsText(d) {
    if (d == null || d === '') return '';
    if (d instanceof Error) return d.message + (d.stack ? ' | ' + String(d.stack).split('\n').slice(1, 3).map((s) => s.trim()).join(' | ') : '');
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(detailsText).join(' | ');
    try {
      return Object.entries(d).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => k + ' : ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' | ');
    } catch (e) { return String(d); }
  }

  function log(niveau, categorie, action, message, details) {
    if (!NIVEAUX.includes(niveau)) niveau = 'info';
    if (!CATEGORIES[categorie]) categorie = 'systeme';
    const e = { id: ++seq, ts: new Date().toISOString(), niveau, categorie, action: String(action || ''), message: String(message || ''), details: detailsText(details) };
    entries.push(e);
    if (entries.length > MAX_ENTREES) entries.splice(0, entries.length - MAX_ENTREES);
    schedule();
    emit();
    return e;
  }

  /* filtre : { niveaux: ['warn','crit'], categorie, du: 'AAAA-MM-JJ', au: 'AAAA-MM-JJ', texte } — dates en heure locale */
  const localDay = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function filter(list, f = {}) {
    const niv = f.niveaux && f.niveaux.length ? new Set(f.niveaux) : null;
    const txt = fold(f.texte).trim();
    return list.filter((e) => {
      if (niv && !niv.has(e.niveau)) return false;
      if (f.categorie && e.categorie !== f.categorie) return false;
      if (f.du || f.au) { const d = localDay(e.ts); if (f.du && d < f.du) return false; if (f.au && d > f.au) return false; }
      if (txt && !fold(e.action + ' ' + e.message + ' ' + e.details).includes(txt)) return false;
      return true;
    });
  }

  /* CSV pour Excel : UTF-8 avec BOM, séparateur « ; », guillemets systématiques, heure locale */
  const two = (n) => String(n).padStart(2, '0');
  function localStamp(iso) {
    const d = new Date(iso);
    return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }
  function toCsv(list) {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const head = ['horodatage', 'niveau', 'categorie', 'action', 'message', 'details'].join(';');
    const rows = list.map((e) => [localStamp(e.ts), e.niveau.toUpperCase(), CATEGORIES[e.categorie] || e.categorie, e.action, e.message, e.details].map(q).join(';'));
    return '﻿' + [head].concat(rows).join('\r\n');
  }

  /* entrées warn/crit non encore vues (pastille du bouton Aide) */
  function lastSeen() { try { return Number(store && store.getItem(SEEN_KEY)) || 0; } catch (e) { return 0; } }
  function unseen() { const s = lastSeen(); return entries.filter((e) => e.id > s && e.niveau !== 'info'); }
  function markSeen() { try { store && store.setItem(SEEN_KEY, String(seq)); } catch (e) { /* sans effet */ } emit(); }

  function clear() {
    entries = []; dirty = true; flush();
    try { store && store.setItem(SEEN_KEY, '0'); } catch (e) { /* sans effet */ }
    seq = 0;
    log('warn', 'systeme', 'Journal vidé', 'Le journal a été vidé par l’utilisateur');
  }

  read();

  /* erreurs JavaScript non interceptées -> niveau crit */
  if (typeof root.addEventListener === 'function' && root.document) {
    root.addEventListener('pagehide', flush);
    root.addEventListener('error', (ev) => {
      if (!ev.message) return; // erreur de chargement d'une ressource (image, tuile) : non journalisée
      log('crit', 'systeme', 'Erreur JavaScript', ev.message, { fichier: String(ev.filename || '').split('/').pop(), ligne: ev.lineno });
    });
    root.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason;
      log('crit', 'systeme', 'Erreur asynchrone', r && r.message ? r.message : String(r), r instanceof Error ? r : '');
    });
  }

  return {
    NIVEAUX, CATEGORIES, MAX_ENTREES,
    log,
    info: (cat, action, msg, det) => log('info', cat, action, msg, det),
    warn: (cat, action, msg, det) => log('warn', cat, action, msg, det),
    crit: (cat, action, msg, det) => log('crit', cat, action, msg, det),
    entries: () => entries.slice(),
    filter, toCsv, localStamp, detailsText,
    unseen, markSeen, lastSeen, clear,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /* tests : remplace le stockage et recharge */
    _useStore(s) { store = s; read(); }
  };
}));
