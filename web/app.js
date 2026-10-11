/* Opriservices — banc de test des tournées AMD (VROOM + OSRM)
   Application statique : les appels passent par le proxy nginx
   /vroom/ -> VROOM, /osrm/ -> OSRM, /geocode/ -> Géoplateforme IGN (BAN). */
'use strict';

/* ---------- utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm2s = (hm) => { const [h, m] = String(hm || '0:0').split(':').map(Number); return (h || 0) * 3600 + (m || 0) * 60; };
const s2hm = (s) => { s = Math.round(s / 60); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtDur = (s) => { const m = Math.round(s / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const fmtKm = (m) => (m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' km';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clone = (o) => JSON.parse(JSON.stringify(o));
const COLORS = ['#1d4f91', '#2e8b7a', '#c26a1a', '#7a5bb5', '#b5476a', '#4f7a1f', '#8a6d00', '#0f7c9c', '#a33b3b', '#555f6e'];

const CRENEAUX = [
  { code: 'matin', nom: 'Matin', badge: 'b-matin' },
  { code: 'mi', nom: 'Mi-journée', badge: 'b-mi' },
  { code: 'am', nom: 'Après-midi', badge: 'b-am' }
];
const crenOf = (c) => CRENEAUX.find((x) => x.code === c) || CRENEAUX[0];
const DISPOS = [
  { code: 'journee', nom: 'Journée' },
  { code: 'matin', nom: 'Matin seulement' },
  { code: 'am', nom: 'Après-midi seulement' },
  { code: 'absent', nom: 'Absent' }
];

/* ---------- valeurs par défaut ---------- */
const DEFAULT_PARAMS = {
  creneaux: { matin: ['08:00', '12:00'], mi: ['11:00', '14:00'], am: ['13:30', '17:30'] },
  pauseDeb: '12:00', pauseFin: '13:30', pauseDuree: 60, stationnement: 10,
  ampDeb: '08:00', ampFin: '17:30', hmax: 5, kmmax: 250, coef: 15,
  types: [
    { code: 'LIV', nom: 'Livraison simple', duree: 15, o2: false },
    { code: 'O2', nom: 'Installation oxygène', duree: 45, o2: true },
    { code: 'PPC', nom: 'Installation PPC', duree: 40, o2: false },
    { code: 'LIT', nom: 'Installation lit médicalisé', duree: 60, o2: false },
    { code: 'REC', nom: 'Récupération de matériel', duree: 20, o2: false },
    { code: 'CTL', nom: 'Visite de contrôle', duree: 30, o2: false }
  ],
  depots: [
    { id: 'aub', nom: 'Siège · Aubagne (13)', adr: "Parc d'activités de Napollon, 100 avenue des Templiers, 13676 Aubagne", actif: true },
    { id: 'sis', nom: 'Antenne · Sisteron (04/05)', adr: 'Parc d’activités de Sisteron Val de Durance, 14 allée des Romarins, 04200 Sisteron', actif: true },
    { id: 'stj', nom: 'Antenne · Saint-Jeannet (06)', adr: 'ZAC de Saint-Estève, route de la Baronne, 06640 Saint-Jeannet', actif: false },
    { id: 'cue', nom: 'Antenne · Cuers (83)', adr: 'ZAC des Bousquets, 593 avenue des Bousquets, 83390 Cuers', actif: false },
    { id: 'cau', nom: 'Antenne · Caumont-sur-Durance (84)', adr: 'ZAC des Balarucs, 15 rue Toussaint Fléchaire, 84510 Caumont-sur-Durance', actif: false },
    { id: 'bas', nom: 'Antenne · Bastia (20)', adr: 'Zone industrielle Furiani, immeuble Agostini, 20200 Bastia', actif: false },
    { id: 'aja', nom: 'Antenne · Ajaccio (20)', adr: '13 avenue Maréchal Juin, résidence Les Fleurs, 20090 Ajaccio', actif: false }
  ]
};
const DEFAULT_AMD = [
  { nom: 'GALLIANO Jean-Marc', depot: 'aub', dispo: 'journee', hmax: 5, kmmax: 250, o2: false },
  { nom: 'SI-MOHAMMED Bounouar', depot: 'aub', dispo: 'journee', hmax: 5, kmmax: 250, o2: false },
  { nom: 'GUINET FONTAINE Franck', depot: 'sis', dispo: 'journee', hmax: 5, kmmax: 250, o2: true },
  { nom: 'IDOUDI Ayadi', depot: 'sis', dispo: 'matin', hmax: 5, kmmax: 250, o2: false }
];
const DEMO_RDV = [
  ['Patient test 01', '04100', 'Manosque', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 02', '04110', 'Reillanne', 'PPC', 'matin', 'GALLIANO'],
  ['Patient test 03', '04800', 'Saint-Martin-de-Brome', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 04', '04210', 'Brunet', 'REC', 'matin', 'GALLIANO'],
  ['Patient test 05', '04270', "Bras-d'Asse", 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 06', '04500', 'Riez', 'CTL', 'matin', 'GALLIANO'],
  ['Patient test 07', '04500', 'Montagnac-Montpezat', 'LIV', 'matin', 'GALLIANO'],
  ['Patient test 08', '04120', 'La Palud-sur-Verdon', 'LIT', 'am', 'GALLIANO'],
  ['Patient test 09', '83630', 'Aiguines', 'LIV', 'am', 'GALLIANO'],
  ['Patient test 10', '04000', 'Digne-les-Bains', 'O2', 'matin', 'GUINET FONTAINE'],
  ['Patient test 11', '04000', 'La Robine-sur-Galabre', 'LIV', 'matin', 'GUINET FONTAINE']
];
const CSV_COLS = [
  ['date', 'Oui', 'JJ/MM/AAAA. Seules les lignes de la date planifiée sont optimisées.', '16/10/2026'],
  ['patient', 'Oui', 'Nom ou identifiant de test', 'Patient test 01'],
  ['code_postal', 'Oui', '5 chiffres', '04100'],
  ['ville', 'Oui', 'Nom de la commune', 'Manosque'],
  ['adresse', 'Non', 'Numéro et rue. Vide : centre de la commune', '12 rue Exemple'],
  ['intervention', 'Oui', 'Code défini dans les paramètres (voir liste ci-dessous)', 'O2'],
  ['demi_journee', 'Oui', 'matin · mi-journee · apres-midi', 'matin'],
  ['amd_actuel', 'Non', 'Nom de l’AMD prévu aujourd’hui, pour la comparaison', 'GALLIANO']
];

/* ---------- état et persistance ---------- */
const KEY = 'opriservices.v1';
let state;
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
  state = Object.assign({ params: clone(DEFAULT_PARAMS), amd: clone(DEFAULT_AMD), rdv: [], results: {}, geo: {}, date: null }, s || {});
  state.params = Object.assign(clone(DEFAULT_PARAMS), state.params);
  // ancien format : un seul résultat
  if (state.result) { state.results[state.result.date] = state.result; delete state.result; }
}
let saveTimer;
function save(flag) {
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); break; } catch (e) {
      // stockage plein : on oublie le résultat le plus ancien et on réessaie
      const old = Object.values(state.results).sort((a, b) => a.at.localeCompare(b.at));
      if (old.length < 2) { console.warn('Sauvegarde impossible', e); break; }
      delete state.results[old[0].date];
    }
  }
  if (flag) {
    const f = $('#saved-flag'); f.hidden = false; clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { f.hidden = true; }, 1500);
  }
}
const typeOf = (code) => state.params.types.find((t) => t.code === code);
const depotOf = (id) => state.params.depots.find((d) => d.id === id);

/* ---------- navigation ---------- */
const VIEWS = ['parametres', 'trajet', 'planification', 'resultat'];
function route() {
  let v = location.hash.replace('#', '') || 'parametres';
  if (!VIEWS.includes(v)) v = 'parametres';
  VIEWS.forEach((x) => { $('#v-' + x).hidden = x !== v; });
  document.body.dataset.view = v;
  const tab = v === 'trajet' ? 'parametres' : v;
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (v === 'parametres') renderParams();
  if (v === 'planification') renderPlan();
  if (v === 'resultat') renderResult();
  if (v === 'trajet') initTrajet();
  window.scrollTo(0, 0);
}

/* ---------- géocodage (BAN via Géoplateforme) ---------- */
async function geocode(q, postcode) {
  const key = norm(q) + '|' + (postcode || '');
  if (state.geo[key]) return state.geo[key];
  let url = '/geocode/search?limit=1&q=' + encodeURIComponent(q);
  if (postcode) url += '&postcode=' + encodeURIComponent(postcode);
  const r = await fetch(url);
  if (!r.ok) throw new Error('Géocodage indisponible (HTTP ' + r.status + ')');
  const j = await r.json();
  const f = j.features && j.features[0];
  const res = f ? { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], label: f.properties.label, score: f.properties.score } : { none: true };
  state.geo[key] = res;
  return res;
}
async function geocodeRdv(r) {
  const q = r.adresse ? r.adresse + ' ' + r.ville : r.ville;
  const g = await geocode(q, r.cp);
  r.geo = g.none ? { none: true } : g;
}
async function geocodeDepot(d) {
  const cp = (d.adr.match(/\b\d{5}\b/) || [])[0];
  const g = await geocode(d.adr, cp);
  d.geo = g.none ? { none: true } : g;
}
async function pool(items, fn, n = 5) {
  const q = items.slice(); const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { errs.push(e); } }
  }));
  if (errs.length) throw errs[0];
}
function geoBadge(g) {
  if (!g) return '<span class="geo no">À localiser</span>';
  if (g.none) return '<span class="geo ko">Introuvable</span>';
  const cls = g.score >= 0.6 ? 'ok' : 'low';
  return `<span class="geo ${cls}" title="${esc(g.label)} · score ${g.score.toFixed(2)}">${cls === 'ok' ? 'Localisé' : 'À vérifier'}</span>`;
}

/* ---------- 1. paramètres ---------- */
function renderParams() {
  const p = state.params;
  $('#t-creneaux').innerHTML = CRENEAUX.map((c) => `<tr><td>${c.nom}</td>
    <td><input type="time" class="mono" data-cren="${c.code}" data-pos="0" value="${p.creneaux[c.code][0]}" aria-label="Début ${c.nom}"></td>
    <td><input type="time" class="mono" data-cren="${c.code}" data-pos="1" value="${p.creneaux[c.code][1]}" aria-label="Fin ${c.nom}"></td></tr>`).join('');
  $$('[data-param]').forEach((el) => { el.value = p[el.dataset.param]; });
  $('#t-types').innerHTML = p.types.map((t, i) => `<tr>
    <td style="width:110px"><input class="mono" data-type="${i}" data-k="code" value="${esc(t.code)}" aria-label="Code"></td>
    <td><input data-type="${i}" data-k="nom" value="${esc(t.nom)}" aria-label="Libellé"></td>
    <td style="width:170px"><input type="number" min="0" step="5" class="mono" data-type="${i}" data-k="duree" value="${t.duree}" aria-label="Durée"></td>
    <td><input type="checkbox" data-type="${i}" data-k="o2" ${t.o2 ? 'checked' : ''} aria-label="Réservé O2"></td>
    <td><button class="icon-btn" data-type-del="${i}" type="button" aria-label="Supprimer ce type">×</button></td></tr>`).join('');
  $('#l-depots').innerHTML = p.depots.map((d, i) => `<div class="depot ${d.actif ? 'on' : ''}">
    <div class="row-between"><b>${esc(d.nom)}</b>
      <label><input type="checkbox" data-depot="${i}" data-k="actif" ${d.actif ? 'checked' : ''}> Inclus dans le test</label></div>
    <input data-depot="${i}" data-k="adr" value="${esc(d.adr)}" aria-label="Adresse ${esc(d.nom)}">
    <div>${geoBadge(d.geo)} ${d.geo && !d.geo.none ? '<span class="hint">' + esc(d.geo.label) + '</span>' : ''}</div></div>`).join('');
}
function bindParams() {
  const v = $('#v-parametres');
  v.addEventListener('change', (e) => {
    const el = e.target; const p = state.params;
    if (el.dataset.param) {
      p[el.dataset.param] = el.type === 'number' ? Number(el.value) : el.value;
    } else if (el.dataset.cren) {
      p.creneaux[el.dataset.cren][Number(el.dataset.pos)] = el.value;
    } else if (el.dataset.type) {
      const t = p.types[Number(el.dataset.type)];
      t[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : (el.dataset.k === 'code' ? el.value.trim().toUpperCase() : el.value);
    } else if (el.dataset.depot) {
      const d = p.depots[Number(el.dataset.depot)];
      if (el.dataset.k === 'actif') d.actif = el.checked; else { d.adr = el.value; delete d.geo; }
      renderParams();
    } else return;
    save(true);
  });
  v.addEventListener('click', (e) => {
    const del = e.target.closest('[data-type-del]');
    if (del) { state.params.types.splice(Number(del.dataset.typeDel), 1); save(true); renderParams(); }
  });
  $('#type-add').addEventListener('click', () => {
    state.params.types.push({ code: 'NOUV', nom: 'Nouveau type', duree: 30, o2: false }); save(true); renderParams();
  });
  $('#depot-geo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await pool(state.params.depots, geocodeDepot); } catch (err) { console.error(err); const f = $('#saved-flag'); f.textContent = err.message; f.hidden = false; }
    e.target.disabled = false; save(true); renderParams();
  });
  $('#cfg-export').addEventListener('click', () => {
    download('opriservices-config.json', JSON.stringify({ params: state.params, amd: state.amd }, null, 2), 'application/json');
  });
  $('#cfg-import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.params) state.params = Object.assign(clone(DEFAULT_PARAMS), j.params);
      if (Array.isArray(j.amd)) state.amd = j.amd;
      save(true); renderParams();
    } catch (err) { window.console.error(err); }
    e.target.value = '';
  });
}

/* ---------- 2. planification ---------- */
function nextWorkday() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DATE_ATTRS = 'placeholder="jj/mm/aaaa" maxlength="10" inputmode="numeric" autocomplete="off"';
function frDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function longDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function alertMsg(sel, html, kind) {
  const el = $(sel); el.className = 'msg' + (kind ? ' ' + kind : ''); el.innerHTML = html; el.hidden = !html;
}
function renderPlan() {
  if (!state.date) state.date = nextWorkday();
  $('#pl-date').value = frDate(state.date);
  const deps = state.params.depots;
  $('#c-amd').textContent = '· ' + state.amd.filter((a) => a.dispo !== 'absent').length;
  $('#t-amd').innerHTML = state.amd.map((a, i) => {
    const d = depotOf(a.depot); const off = a.dispo === 'absent' || !d || !d.actif;
    return `<tr class="${off ? 'off' : ''}">
    <td><input data-amd="${i}" data-k="nom" value="${esc(a.nom)}" aria-label="Nom de l'AMD"></td>
    <td><select data-amd="${i}" data-k="depot" aria-label="Point de départ">${deps.map((x) => `<option value="${x.id}" ${x.id === a.depot ? 'selected' : ''}>${esc(x.nom)}${x.actif ? '' : ' (hors test)'}</option>`).join('')}</select></td>
    <td><select data-amd="${i}" data-k="dispo" aria-label="Disponibilité">${DISPOS.map((x) => `<option value="${x.code}" ${x.code === a.dispo ? 'selected' : ''}>${x.nom}</option>`).join('')}</select></td>
    <td style="width:100px"><input type="number" min="0" step="0.5" class="mono" data-amd="${i}" data-k="hmax" value="${a.hmax}" aria-label="Heures max"></td>
    <td style="width:100px"><input type="number" min="0" step="10" class="mono" data-amd="${i}" data-k="kmmax" value="${a.kmmax}" aria-label="Km max"></td>
    <td><input type="checkbox" data-amd="${i}" data-k="o2" ${a.o2 ? 'checked' : ''} aria-label="Habilité O2"></td>
    <td><button class="icon-btn" data-amd-del="${i}" type="button" aria-label="Retirer cet AMD">×</button></td></tr>`;
  }).join('');

  const types = state.params.types;
  const nDay = state.rdv.filter((r) => r.date === state.date).length;
  $('#c-rdv').textContent = `· ${state.rdv.length} au total · ${nDay} le ${frDate(state.date)}`;
  $('#t-rdv').innerHTML = state.rdv.length ? state.rdv.map((r, i) => `<tr class="${r.date === state.date ? '' : 'off'}">
    <td style="width:150px"><input class="mono" ${DATE_ATTRS} data-rdv="${i}" data-k="date" value="${frDate(r.date)}" aria-label="Date"></td>
    <td><input data-rdv="${i}" data-k="patient" value="${esc(r.patient)}" aria-label="Patient"></td>
    <td style="width:88px"><input class="mono" data-rdv="${i}" data-k="cp" value="${esc(r.cp)}" aria-label="Code postal"></td>
    <td><input data-rdv="${i}" data-k="ville" value="${esc(r.ville)}" aria-label="Ville"></td>
    <td><input data-rdv="${i}" data-k="adresse" value="${esc(r.adresse)}" aria-label="Adresse"></td>
    <td><select data-rdv="${i}" data-k="type" aria-label="Intervention">${types.map((t) => `<option value="${esc(t.code)}" ${t.code === r.type ? 'selected' : ''}>${esc(t.nom)}</option>`).join('')}${typeOf(r.type) ? '' : `<option selected value="${esc(r.type)}">${esc(r.type)} (inconnu)</option>`}</select></td>
    <td style="width:130px"><select data-rdv="${i}" data-k="cren" aria-label="Demi-journée">${CRENEAUX.map((c) => `<option value="${c.code}" ${c.code === r.cren ? 'selected' : ''}>${c.nom}</option>`).join('')}</select></td>
    <td><input data-rdv="${i}" data-k="amdActuel" value="${esc(r.amdActuel)}" aria-label="AMD prévu"></td>
    <td>${geoBadge(r.geo)}</td>
    <td><button class="icon-btn" data-rdv-del="${i}" type="button" aria-label="Supprimer ce RDV">×</button></td></tr>`).join('')
    : '<tr><td colspan="10" class="empty">Aucun RDV. Importez un fichier CSV, ajoutez un RDV ou chargez l\'exemple.</td></tr>';

  $('#t-csvfmt').innerHTML = CSV_COLS.map((c) => `<tr><td class="mono"><b>${c[0]}</b></td><td>${c[1]}</td><td>${esc(c[2])}</td><td class="mono">${esc(c[3])}</td></tr>`).join('')
    + `<tr><td colspan="4" class="hint">Codes d'intervention actuels : ${types.map((t) => `<code>${esc(t.code)}</code> ${esc(t.nom)}`).join(' · ')}</td></tr>`;
  resetDelZone();
}
function resetDelZone() {
  $('#del-zone').innerHTML = '<button class="btn2 danger" id="rdv-clear" type="button">Tout supprimer</button>';
}
function bindPlan() {
  const v = $('#v-planification');
  v.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'pl-date' || el.dataset.k === 'date') {
      const iso = parseDate(el.value);
      if (!iso) { el.setCustomValidity('Date attendue au format jj/mm/aaaa'); el.reportValidity(); return; }
      el.setCustomValidity('');
      if (el.id === 'pl-date') state.date = iso; else state.rdv[Number(el.dataset.rdv)].date = iso;
      save(); renderPlan(); return;
    }
    const isNum = el.type === 'number';
    if (el.dataset.amd) {
      const a = state.amd[Number(el.dataset.amd)];
      a[el.dataset.k] = el.type === 'checkbox' ? el.checked : isNum ? Number(el.value) : el.value;
      save(); if (['depot', 'dispo'].includes(el.dataset.k)) renderPlan();
    } else if (el.dataset.rdv) {
      const r = state.rdv[Number(el.dataset.rdv)];
      r[el.dataset.k] = el.value;
      if (['cp', 'ville', 'adresse'].includes(el.dataset.k)) delete r.geo;
      save(); if (['date', 'cp', 'ville', 'adresse'].includes(el.dataset.k)) renderPlan();
    }
  });
  v.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id !== 'pl-date' && el.dataset.k !== 'date') return;
    el.setCustomValidity('');
    if (e.inputType && e.inputType.startsWith('delete')) return;
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    if (/^\d+$/.test(el.value)) el.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
  });
  v.addEventListener('click', (e) => {
    const t = e.target;
    const ad = t.closest('[data-amd-del]');
    if (ad) { state.amd.splice(Number(ad.dataset.amdDel), 1); save(); renderPlan(); return; }
    const rd = t.closest('[data-rdv-del]');
    if (rd) { state.rdv.splice(Number(rd.dataset.rdvDel), 1); save(); renderPlan(); return; }
    if (t.id === 'rdv-clear') {
      if (!state.rdv.length) return;
      $('#del-zone').innerHTML = `<span style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="color:var(--danger)">Supprimer les ${state.rdv.length} RDV ?</b>
        <button class="btn2 danger" id="rdv-clear-ok" type="button">Confirmer</button><button class="btn2" id="rdv-clear-no" type="button">Annuler</button></span>`;
      return;
    }
    if (t.id === 'rdv-clear-ok') { state.rdv = []; save(); $('#csv-report').hidden = true; renderPlan(); return; }
    if (t.id === 'rdv-clear-no') { resetDelZone(); }
  });
  $('#amd-add').addEventListener('click', () => {
    const p = state.params; const d = p.depots.find((x) => x.actif) || p.depots[0];
    state.amd.push({ nom: 'NOUVEL AMD', depot: d.id, dispo: 'journee', hmax: p.hmax, kmmax: p.kmmax, o2: false }); save(); renderPlan();
  });
  $('#rdv-add').addEventListener('click', () => {
    state.rdv.push({ date: state.date, patient: 'Patient test ' + String(state.rdv.length + 1).padStart(2, '0'), cp: '', ville: '', adresse: '', type: state.params.types[0].code, cren: 'matin', amdActuel: '' });
    save(); renderPlan();
  });
  $('#rdv-demo').addEventListener('click', () => {
    DEMO_RDV.forEach(([patient, cp, ville, type, cren, amd]) => state.rdv.push({ date: state.date, patient, cp, ville, adresse: '', type, cren, amdActuel: amd }));
    save(); renderPlan();
  });
  $('#csv-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    importCsv(await f.text(), f.name); e.target.value = '';
  });
  $('#pl-go').addEventListener('click', optimize);
  $('#r-opt').addEventListener('click', optimize);
  $('#r-prev').addEventListener('click', () => gotoDay(-1));
  $('#r-next').addEventListener('click', () => gotoDay(1));
  document.addEventListener('keydown', (e) => {
    if ($('#v-resultat').hidden || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,select,textarea')) return;
    if (e.key === 'ArrowLeft') gotoDay(-1);
    if (e.key === 'ArrowRight') gotoDay(1);
  });
}

/* ---------- import CSV ---------- */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
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
function parseCren(v) {
  const n = norm(v);
  if (n === 'matin' || n === 'am matin') return 'matin';
  if (n.startsWith('mi')) return 'mi';
  if (n.startsWith('apres') || n === 'pm' || n === 'aprem') return 'am';
  return null;
}
function parseDate(v) {
  v = v.trim();
  let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  const iso = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  return iso && new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso ? iso : null;
}
function importCsv(text, name) {
  const rows = parseCsv(text);
  const rep = $('#csv-report');
  if (rows.length < 2) { rep.className = 'warn'; rep.hidden = false; rep.innerHTML = 'Fichier vide ou sans ligne de données.'; return; }
  const head = rows[0].map((h) => norm(h).replace(/ /g, '_'));
  const idx = {}; CSV_COLS.forEach(([c]) => { idx[c] = head.indexOf(c); });
  const missing = CSV_COLS.filter((c) => c[1] === 'Oui' && idx[c[0]] < 0).map((c) => c[0]);
  if (missing.length) {
    rep.className = 'warn'; rep.hidden = false;
    rep.innerHTML = `Colonnes obligatoires absentes : <b>${missing.map(esc).join(', ')}</b>. Vérifiez la ligne d'en-tête et le séparateur point-virgule.`;
    return;
  }
  const codes = new Map(state.params.types.map((t) => [norm(t.code), t.code]));
  const errs = []; let ok = 0;
  rows.slice(1).forEach((r, k) => {
    const get = (c) => (idx[c] >= 0 ? (r[idx[c]] || '').trim() : '');
    const line = k + 2; const pb = [];
    const date = parseDate(get('date')); if (!date) pb.push('date invalide « ' + get('date') + ' »');
    let cp = get('code_postal').replace(/\s/g, ''); if (/^\d{4}$/.test(cp)) cp = '0' + cp;
    if (!/^\d{5}$/.test(cp)) pb.push('code postal invalide « ' + get('code_postal') + ' »');
    const ville = get('ville'); if (!ville) pb.push('ville vide');
    const type = codes.get(norm(get('intervention'))); if (!type) pb.push('code intervention inconnu « ' + get('intervention') + ' »');
    const cren = parseCren(get('demi_journee')); if (!cren) pb.push('demi-journée invalide « ' + get('demi_journee') + ' »');
    if (pb.length) { errs.push(`Ligne ${line} : ${pb.join(', ')}`); return; }
    state.rdv.push({ date, patient: get('patient') || 'Patient ligne ' + line, cp, ville, adresse: get('adresse'), type, cren, amdActuel: get('amd_actuel') });
    ok++;
  });
  save();
  rep.hidden = false; rep.className = errs.length ? 'warn' : 'ok';
  rep.innerHTML = `<b>${esc(name)}</b> : ${ok} RDV importé${ok > 1 ? 's' : ''}${errs.length ? `, ${errs.length} ligne${errs.length > 1 ? 's' : ''} ignorée${errs.length > 1 ? 's' : ''}` : ''}.`
    + (errs.length ? '<ul>' + errs.slice(0, 30).map((x) => '<li>' + esc(x) + '</li>').join('') + (errs.length > 30 ? '<li>…</li>' : '') + '</ul>' : '');
  const dates = [...new Set(state.rdv.map((r) => r.date))];
  if (ok && !state.rdv.some((r) => r.date === state.date) && dates.length) state.date = dates.sort()[0];
  save(); renderPlan();
}

/* ---------- optimisation ---------- */
function vehicleWindow(a, p) {
  if (a.dispo === 'matin') return [hm2s(p.ampDeb), hm2s(p.pauseDeb)];
  if (a.dispo === 'am') return [hm2s(p.pauseDeb) + p.pauseDuree * 60, hm2s(p.ampFin)];
  return [hm2s(p.ampDeb), hm2s(p.ampFin)];
}
const sameAmd = (name, a) => { const n = norm(name); const m = norm(a.nom); return !!n && (m === n || m.startsWith(n + ' ') || m.includes(n)); };

async function optimize() {
  const onResult = location.hash === '#resultat';
  const msg = onResult ? '#r-msg' : '#pl-msg';
  const btn = onResult ? $('#r-opt') : $('#pl-go'); const p = state.params;
  const day = state.rdv.filter((r) => r.date === state.date);
  if (!day.length) { alertMsg(msg, `Aucun RDV le ${frDate(state.date)}.`, 'err'); return; }
  const amds = state.amd.filter((a) => a.dispo !== 'absent' && depotOf(a.depot) && depotOf(a.depot).actif);
  if (!amds.length) { alertMsg(msg, 'Aucun AMD disponible partant d’un point de départ inclus dans le test.', 'err'); return; }
  if (btn) btn.disabled = true;
  try {
    alertMsg(msg, 'Localisation des adresses…');
    const deps = [...new Set(amds.map((a) => a.depot))].map(depotOf).filter((d) => !d.geo || d.geo.none);
    await pool(deps, geocodeDepot);
    await pool(day.filter((r) => !r.geo), geocodeRdv);
    save(); renderPlan();
    const badDep = amds.filter((a) => depotOf(a.depot).geo.none);
    if (badDep.length) throw new Error('Adresse introuvable pour : ' + [...new Set(badDep.map((a) => depotOf(a.depot).nom))].join(', ') + '. Corrigez-la dans les paramètres.');
    const jobsR = day.filter((r) => r.geo && !r.geo.none);
    const excluded = day.filter((r) => !r.geo || r.geo.none);
    const badType = jobsR.filter((r) => !typeOf(r.type));
    if (badType.length) throw new Error('Type d’intervention inconnu pour ' + badType.map((r) => esc(r.patient)).join(', '));

    alertMsg(msg, 'Calcul des tournées…');
    const sf = 1 / (1 + (Number(p.coef) || 0) / 100);
    const vehicles = amds.map((a, i) => {
      const d = depotOf(a.depot); const loc = [d.geo.lon, d.geo.lat];
      const v = {
        id: i + 1, description: a.nom, profile: 'car', start: loc, end: loc,
        time_window: vehicleWindow(a, p), speed_factor: Math.min(5, Math.max(0.2, sf)),
        skills: a.o2 ? [1] : []
      };
      if (a.hmax > 0) v.max_travel_time = Math.round(a.hmax * 3600);
      if (a.kmmax > 0) v.max_distance = Math.round(a.kmmax * 1000);
      if (a.dispo === 'journee' && p.pauseDuree > 0) {
        v.breaks = [{ id: i + 1, description: 'Pause', time_windows: [[hm2s(p.pauseDeb), Math.max(hm2s(p.pauseDeb), hm2s(p.pauseFin) - p.pauseDuree * 60)]], service: p.pauseDuree * 60 }];
      }
      return v;
    });
    const jobs = jobsR.map((r, j) => {
      const t = typeOf(r.type); const c = p.creneaux[r.cren];
      return {
        id: j + 1, description: r.patient, location: [r.geo.lon, r.geo.lat],
        setup: p.stationnement * 60, service: t.duree * 60,
        time_windows: [[hm2s(c[0]), hm2s(c[1])]], skills: t.o2 ? [1] : []
      };
    });
    const req = { vehicles, jobs, options: { g: true } };
    const res = await callVroom(req);

    let cmp = null, resAct = null;
    const withCur = jobsR.map((r, j) => ({ j, a: amds.findIndex((a) => sameAmd(r.amdActuel, a)) })).filter((x) => x.a >= 0);
    if (withCur.length) {
      const creq = clone(req); creq.options = { g: false };
      creq.vehicles.forEach((v, i) => { v.skills = v.skills.concat([100 + i]); });
      creq.jobs = withCur.map(({ j, a }) => Object.assign(clone(req.jobs[j]), { skills: req.jobs[j].skills.concat([100 + a]) }));
      const keep = new Set(withCur.map((x) => x.j + 1));
      const cres = await callVroom(creq);
      resAct = cres; // gardé en entier pour la voie « actuel » de l'agenda
      const optSub = sumRoutes(res, keep);
      cmp = { act: summarize(cres), opt: optSub, n: withCur.length, total: jobsR.length };
    }
    state.results[state.date] = { date: state.date, at: new Date().toISOString(), amds: clone(amds), rdv: clone(jobsR), excluded: clone(excluded), res, resAct, cmp };
    save();
    alertMsg(msg, '');
    if (onResult) renderResult(); else location.hash = '#resultat';
  } catch (err) {
    console.error(err);
    alertMsg(msg, esc(err.message || String(err)), 'err');
  } finally { if (btn) btn.disabled = false; }
}
async function callVroom(req) {
  let r;
  try {
    r = await fetch('/vroom/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  } catch (e) { throw new Error('VROOM ne répond pas. Vérifiez que les conteneurs tournent (docker compose ps).'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== 0) throw new Error('Erreur VROOM' + (j.error ? ' : ' + j.error : ' (HTTP ' + r.status + ')'));
  return j;
}
function summarize(res) {
  return { distance: res.summary.distance || 0, duration: res.summary.duration || 0, routes: res.routes.length, unassigned: res.unassigned.length };
}
function sumRoutes(res, keepJobs) {
  // indicateurs de la solution optimisée, restreints aux RDV qui ont un AMD actuel (comparaison à périmètre égal si tous en ont un)
  const s = summarize(res);
  s.unassigned = res.unassigned.filter((u) => keepJobs.has(u.id)).length;
  return s;
}

/* ---------- 3. résultat ---------- */
let mapR, layerR, mapT, layerT;
function decodePolyline(str) {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    let b, s = 0, r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lat += r & 1 ? ~(r >> 1) : r >> 1; s = 0; r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
/* journées navigables : toutes celles qui ont des RDV ou un résultat */
function resultDays() {
  return [...new Set(state.rdv.map((r) => r.date).concat(Object.keys(state.results)))].filter(Boolean).sort();
}
function gotoDay(step) {
  const days = resultDays(); if (!days.length) return;
  const i = days.indexOf(state.date);
  const j = i < 0 ? (step > 0 ? days.findIndex((d) => d > state.date) : days.length - 1 - [...days].reverse().findIndex((d) => d < state.date)) : i + step;
  if (j < 0 || j >= days.length || !days[j]) return;
  state.date = days[j]; save(); alertMsg('#r-msg', ''); renderResult();
}
function renderDayNav() {
  const days = resultDays(); const i = days.indexOf(state.date);
  $('#r-prev').disabled = !days.length || (i < 0 ? !days.some((d) => d < state.date) : i === 0);
  $('#r-next').disabled = !days.length || (i < 0 ? !days.some((d) => d > state.date) : i === days.length - 1);
  $('#r-pos').textContent = days.length > 1 && i >= 0 ? `Journée ${i + 1} / ${days.length}` : '';
}
function clearResult() {
  $('#r-routes').innerHTML = ''; $('#r-compare').hidden = true; unRows = null; renderUnassigned();
  if (layerR) { layerR.remove(); layerR = null; }
}
function renderResult() {
  if (!state.date) state.date = nextWorkday();
  renderDayNav();
  const R = state.results[state.date];
  const box = $('#r-routes');
  $('#r-opt-zone').hidden = !!R;
  $('#r-csv').disabled = $('#r-print').disabled = !R;
  if (!R) {
    const n = state.rdv.filter((r) => r.date === state.date).length;
    $('#r-titre').textContent = 'Tournées · ' + longDate(state.date);
    $('#r-sub').textContent = n ? `Journée non optimisée · ${n} RDV prévu${n > 1 ? 's' : ''}.` : 'Aucun RDV ce jour. Préparez la journée à l’écran 2.';
    $('#r-opt').hidden = !n;
    clearResult();
    if (mapR) setTimeout(() => mapR.invalidateSize(), 50);
    appBus.dispatchEvent(new CustomEvent('render'));
    return;
  }
  const res = R.res;
  $('#r-titre').textContent = 'Tournées optimisées · ' + longDate(R.date);
  const used = res.routes.length;
  $('#r-sub').textContent = `${R.rdv.length + R.excluded.length} RDV · ${R.amds.length} AMD disponibles · ${used} AMD mobilisé${used > 1 ? 's' : ''} · ${fmtKm(res.summary.distance)} · ${fmtDur(res.summary.duration)} de conduite`;

  // comparaison
  if (R.cmp) {
    const a = R.cmp.act, o = R.cmp.opt;
    const pct = (x, y) => (x ? Math.round(((y - x) / x) * 100) : 0);
    const sign = (n, unit) => (n > 0 ? '+ ' : n < 0 ? '− ' : '') + Math.abs(n) + unit;
    const dMin = Math.round((o.duration - a.duration) / 60);
    $('#t-compare').innerHTML = [
      ['Kilomètres totaux', fmtKm(a.distance), fmtKm(o.distance), sign(pct(a.distance, o.distance), ' %')],
      ['Temps de conduite total', fmtDur(a.duration), fmtDur(o.duration), sign(dMin, ' min')],
      ['AMD mobilisés', a.routes, o.routes, sign(o.routes - a.routes, '')],
      ['RDV impossibles à tenir', a.unassigned, o.unassigned, sign(o.unassigned - a.unassigned, '')]
    ].map((r) => `<tr><td>${r[0]}</td><td class="num mono">${r[1]}</td><td class="num mono"><b>${r[2]}</b></td><td class="num mono">${r[3]}</td></tr>`).join('');
    $('#r-compare').hidden = false;
    if (R.cmp.n < R.cmp.total) $('#t-compare').insertAdjacentHTML('beforeend', `<tr><td colspan="4" class="hint">Comparaison partielle : ${R.cmp.n} RDV sur ${R.cmp.total} ont un AMD actuel reconnu. Les totaux optimisés portent sur tous les RDV.</td></tr>`);
  } else $('#r-compare').hidden = true;

  // tournées
  box.innerHTML = R.amds.map((a, i) => {
    const vid = i + 1; const col = COLORS[i % COLORS.length];
    const r = res.routes.find((x) => x.vehicle === vid);
    const d = depotOf(a.depot) || { nom: a.depot };
    if (!r) return `<section class="route"><div class="route-h"><div class="who"><span class="dot" style="background:${col}"></span><b>${esc(a.nom)}</b><span>${esc(d.nom)}</span></div><div class="tot mono"><span>0 RDV</span></div></div><div class="empty">Aucun RDV affecté : AMD disponible pour une autre mission.</div></section>`;
    const jobsN = r.steps.filter((s) => s.type === 'job').length;
    const kmOver = a.kmmax > 0 && r.distance > a.kmmax * 1000;
    const hOver = a.hmax > 0 && r.duration > a.hmax * 3600;
    const start = r.steps[0], end = r.steps[r.steps.length - 1];
    let n = 0;
    const li = r.steps.map((s) => {
      if (s.type === 'start') return `<li class="aux"><span class="n">⌂</span><span class="t">${s2hm(s.arrival)}</span><span>Départ ${esc(d.nom)}</span><span></span></li>`;
      if (s.type === 'end') return `<li class="aux"><span class="n">⌂</span><span class="t">${s2hm(s.arrival)}</span><span>Retour ${esc(d.nom)}</span><span></span></li>`;
      if (s.type === 'break') return `<li class="aux"><span class="n">‖</span><span class="t">${s2hm(s.arrival + (s.waiting_time || 0))}</span><span>Pause déjeuner · ${Math.round(s.service / 60)} min</span><span></span></li>`;
      if (s.type !== 'job') return '';
      n++; const rd = R.rdv[s.job - 1]; const t = typeOf(rd.type) || { nom: rd.type }; const c = crenOf(rd.cren);
      const wait = s.waiting_time > 60 ? ` · attente ${Math.round(s.waiting_time / 60)} min` : '';
      return `<li class="pick" data-job="${s.job}" tabindex="0" title="Voir sur la carte"><span class="n" style="background:${col}">${n}</span><span class="t">${s2hm(s.arrival)}</span>
        <span><b>${esc(rd.patient)}</b> <span class="w">· ${esc(rd.ville)} · ${esc(t.nom)}${rd.adresse ? ' · ' + esc(rd.adresse) : ''}${wait}</span></span>
        <span class="badge ${c.badge}">${c.nom}</span></li>`;
    }).join('');
    return `<section class="route"><div class="route-h"><div class="who"><span class="dot" style="background:${col}"></span><b>${esc(a.nom)}</b><span>${esc(d.nom)}</span></div>
      <div class="tot mono"><span>${jobsN} RDV</span><span class="${kmOver ? 'over' : ''}">${fmtKm(r.distance)}${a.kmmax ? ' / ' + a.kmmax + ' km' : ''}</span><span class="${hOver ? 'over' : ''}">${fmtDur(r.duration)}${a.hmax ? ' / ' + a.hmax + ' h' : ''} conduite</span><span>${s2hm(start.arrival)}–${s2hm(end.arrival)}</span></div></div>
      <ol class="steps">${li}</ol></section>`;
  }).join('');

  // non affectés
  const why = (rd) => {
    const t = typeOf(rd.type);
    if (t && t.o2 && !R.amds.some((a) => a.o2)) return 'aucun AMD habilité O2 disponible';
    const c = state.params.creneaux[rd.cren];
    if (!R.amds.some((a) => { const w = vehicleWindow(a, state.params); return w[0] < hm2s(c[1]) && w[1] > hm2s(c[0]); })) return 'aucun AMD disponible sur ce créneau';
    return 'créneau, heures ou km max trop serrés';
  };
  unRows = res.unassigned.map((u) => ({ rd: R.rdv[u.id - 1], job: u.id, why: why(R.rdv[u.id - 1]) })).concat(R.excluded.map((rd) => ({ rd, why: 'adresse introuvable' })));
  renderUnassigned();

  drawResultMap(R);
  appBus.dispatchEvent(new CustomEvent('render'));
}
let unRows = null;
const unSort = { key: 'ville', dir: 1 };
const unVal = {
  date: (x) => x.rd.date, patient: (x) => x.rd.patient, cp: (x) => x.rd.cp, ville: (x) => x.rd.ville, adresse: (x) => x.rd.adresse,
  type: (x) => (typeOf(x.rd.type) || { nom: x.rd.type }).nom, cren: (x) => CRENEAUX.indexOf(crenOf(x.rd.cren)),
  amd: (x) => x.rd.amdActuel, why: (x) => x.why
};
function renderUnassigned() {
  const rows = unRows || [];
  $('#c-unassigned').textContent = unRows ? '· ' + rows.length : '';
  $('#r-un-empty').hidden = rows.length > 0;
  $('#r-un-empty').textContent = unRows ? 'Tous les RDV de la journée sont planifiés.' : 'Rien à afficher.';
  $('#r-un-wrap').hidden = !rows.length;
  $$('#r-unassigned [data-sort]').forEach((b) => {
    const th = b.parentElement;
    if (b.dataset.sort === unSort.key) th.setAttribute('aria-sort', unSort.dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
  });
  const f = unVal[unSort.key];
  const sorted = rows.slice().sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true, sensitivity: 'base' });
    return c * unSort.dir || String(a.rd.ville ?? '').localeCompare(String(b.rd.ville ?? ''), 'fr');
  });
  $('#t-unassigned').innerHTML = sorted.map(({ rd, job, why }) => {
    const t = typeOf(rd.type) || { nom: rd.type }; const c = crenOf(rd.cren);
    return `<tr${job ? ` class="pick" data-job="${job}" tabindex="0" title="Voir sur la carte"` : ''}><td class="mono">${esc(frDate(rd.date))}</td><td><b>${esc(rd.patient)}</b></td><td class="mono">${esc(rd.cp)}</td><td>${esc(rd.ville || '?')}</td><td>${esc(rd.adresse)}</td>
      <td>${esc(t.nom)}</td><td><span class="badge ${c.badge}">${c.nom}</span></td><td>${esc(rd.amdActuel)}</td><td class="hint">${esc(why)}</td></tr>`;
  }).join('');
  if (pickedJob != null) $$(`#t-unassigned .pick[data-job="${pickedJob}"]`).forEach((x) => x.classList.add('sel'));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('#r-unassigned [data-sort]'); if (!b) return;
  if (unSort.key === b.dataset.sort) unSort.dir = -unSort.dir; else { unSort.key = b.dataset.sort; unSort.dir = 1; }
  renderUnassigned();
});
function pinIcon(txt, col, dep) {
  return L.divIcon({ className: '', html: `<div class="pin ${dep ? 'dep' : ''}" style="${dep ? '' : 'background:' + col}">${txt}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}
function drawResultMap(R) {
  if (typeof L === 'undefined') { $('#map-result').innerHTML = '<p class="empty">Carte indisponible (Leaflet non chargé).</p>'; return; }
  if (!mapR) { mapR = L.map('map-result'); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(mapR); }
  if (layerR) layerR.remove();
  layerR = L.featureGroup().addTo(mapR);
  markersR = {}; linesR = {}; jobVehR = {}; pickedJob = null; hoveredJob = null;
  R.amds.forEach((a, i) => {
    const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return;
    const col = COLORS[i % COLORS.length];
    if (r.geometry) linesR[r.vehicle] = L.polyline(decodePolyline(r.geometry), { color: col, weight: 4, opacity: 0.85 }).addTo(layerR);
    let n = 0;
    r.steps.forEach((s) => {
      if (s.type === 'start') L.marker([s.location[1], s.location[0]], { icon: pinIcon('D', col, true) }).bindTooltip(esc((depotOf(a.depot) || {}).nom || 'Départ')).addTo(layerR);
      if (s.type === 'job') {
        n++; const rd = R.rdv[s.job - 1];
        markersR[s.job] = L.marker([s.location[1], s.location[0]], { icon: pinIcon(n, col) })
          .bindTooltip(`<b>${esc(rd.patient)}</b> · ${esc(rd.ville)}<br>${esc(a.nom)} · n° ${n} · ${s2hm(s.arrival)}`)
          .on('click', () => pickJob(s.job, true)).addTo(layerR);
        jobVehR[s.job] = r.vehicle;
      }
    });
  });
  // RDV non affectés mais localisés : repère gris
  R.res.unassigned.forEach((u) => {
    const rd = R.rdv[u.id - 1]; if (!rd || !rd.geo || rd.geo.none) return;
    markersR[u.id] = L.marker([rd.geo.lat, rd.geo.lon], { icon: pinIcon('!', '#8a94a3') })
      .bindTooltip(`<b>${esc(rd.patient)}</b> · ${esc(rd.ville)}<br>Non affecté`)
      .on('click', () => pickJob(u.id, true)).addTo(layerR);
  });
  Object.entries(markersR).forEach(([job, m]) => m
    .on('mouseover', () => hoverJob(Number(job), true))
    .on('mouseout', () => hoverJob(null, true)));
  setTimeout(() => { mapR.invalidateSize(); if (layerR.getLayers().length) mapR.fitBounds(layerR.getBounds(), { padding: [24, 24] }); else mapR.setView([43.7, 6], 8); }, 50);
}
/* mise en évidence d'un RDV : ligne <-> repère sur la carte <-> agenda (via appBus) */
let markersR = {}, linesR = {}, jobVehR = {}, pickedJob = null, hoveredJob = null;
const appBus = new EventTarget();
const mapVisible = () => !!mapR && $('#map-result').offsetParent !== null;
function pickJob(job, fromMap) {
  selectJob(pickedJob === job && !fromMap ? null : job, { fly: true, scroll: fromMap });
}
function selectJob(job, { fly = false, scroll = false } = {}) {
  job = job == null ? null : Number(job);
  if (pickedJob != null && markersR[pickedJob]) {
    const m = markersR[pickedJob]; m.closeTooltip(); m.setZIndexOffset(0);
    const el = m.getElement(); if (el) el.firstElementChild.classList.remove('hl');
  }
  Object.values(linesR).forEach((l) => l.setStyle({ weight: 4, opacity: 0.85 }));
  $$('#v-resultat .pick.sel').forEach((x) => x.classList.remove('sel'));
  const changed = pickedJob !== job;
  pickedJob = job;
  if (job != null) {
    $$(`#v-resultat .pick[data-job="${job}"]`).forEach((x) => {
      x.classList.add('sel');
      if (scroll && x.offsetParent) x.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const line = linesR[jobVehR[job]]; if (line) line.setStyle({ weight: 7, opacity: 1 }).bringToFront();
    const m = markersR[job];
    if (m) {
      m.setZIndexOffset(1000);
      const el = m.getElement(); if (el) el.firstElementChild.classList.add('hl');
      if (fly && mapVisible()) { mapR.flyTo(m.getLatLng(), Math.max(mapR.getZoom(), 12), { duration: 0.6 }); m.openTooltip(); }
    }
  }
  if (changed) appBus.dispatchEvent(new CustomEvent('pick', { detail: { job } }));
}
function hoverJob(job, fromMap) {
  job = job == null ? null : Number(job);
  if (hoveredJob === job) return;
  const prev = hoveredJob != null && markersR[hoveredJob];
  if (prev && prev.getElement()) prev.getElement().firstElementChild.classList.remove('hov');
  hoveredJob = job;
  const m = job != null && markersR[job];
  if (m && m.getElement()) m.getElement().firstElementChild.classList.add('hov');
  if (fromMap) appBus.dispatchEvent(new CustomEvent('hover', { detail: { job } }));
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('#v-resultat .pick'); if (row) pickJob(Number(row.dataset.job));
});
document.addEventListener('keydown', (e) => {
  const row = e.target.closest && e.target.closest('#v-resultat .pick');
  if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickJob(Number(row.dataset.job)); }
});
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
function exportCsv() {
  const R = state.results[state.date]; if (!R) return;
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['date', 'amd', 'ordre', 'heure_arrivee', 'patient', 'code_postal', 'ville', 'adresse', 'intervention', 'demi_journee', 'attente_min'].join(';')];
  R.amds.forEach((a, i) => {
    const r = R.res.routes.find((x) => x.vehicle === i + 1); if (!r) return; let n = 0;
    r.steps.filter((s) => s.type === 'job').forEach((s) => {
      n++; const rd = R.rdv[s.job - 1];
      lines.push([frDate(R.date), a.nom, n, s2hm(s.arrival), rd.patient, rd.cp, rd.ville, rd.adresse, (typeOf(rd.type) || {}).nom || rd.type, crenOf(rd.cren).nom, Math.round((s.waiting_time || 0) / 60)].map(q).join(';'));
    });
  });
  R.res.unassigned.forEach((u) => { const rd = R.rdv[u.id - 1]; lines.push([frDate(R.date), 'NON AFFECTÉ', '', '', rd.patient, rd.cp, rd.ville, rd.adresse, rd.type, crenOf(rd.cren).nom, ''].map(q).join(';')); });
  download(`tournees_${R.date}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- test trajet ---------- */
let trajetReady = false;
function initTrajet() {
  $('#dl-depots').innerHTML = state.params.depots.map((d) => `<option value="${esc(d.nom)}"></option>`).join('');
  if (typeof L !== 'undefined' && !mapT) {
    mapT = L.map('map-trajet').setView([43.6, 5.8], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(mapT);
  }
  setTimeout(() => mapT && mapT.invalidateSize(), 50);
  if (trajetReady) return; trajetReady = true;
  $('#tr-go').addEventListener('click', calcTrajet);
  $('#tr-terrain').addEventListener('input', showEcart);
}
let lastTrajetMin = null;
async function placeOf(text) {
  const d = state.params.depots.find((x) => norm(x.nom) === norm(text));
  if (d) { if (!d.geo || d.geo.none) await geocodeDepot(d); if (d.geo.none) throw new Error('Adresse introuvable : ' + d.nom); return d.geo; }
  const cp = (text.match(/\b\d{5}\b/) || [])[0];
  const g = await geocode(text.replace(/\b\d{5}\b/, '').trim() || text, cp);
  if (g.none) throw new Error('Lieu introuvable : « ' + text + ' »');
  return g;
}
async function calcTrajet() {
  const btn = $('#tr-go'); btn.disabled = true; alertMsg('#tr-msg', 'Calcul…');
  try {
    const a = await placeOf($('#tr-dep').value), b = await placeOf($('#tr-arr').value);
    save();
    const r = await fetch(`/osrm/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error('OSRM : ' + (j.message || j.code));
    const rt = j.routes[0]; const coef = 1 + (Number(state.params.coef) || 0) / 100;
    const maj = rt.duration * coef; lastTrajetMin = maj / 60;
    $('#tr-km').textContent = fmtKm(rt.distance);
    $('#tr-min').textContent = Math.round(rt.duration / 60) + ' min';
    $('#tr-maj').textContent = Math.round(maj / 60) + ' min';
    $('#tr-eta').textContent = s2hm(hm2s($('#tr-h').value) + maj);
    $('#tr-geo').textContent = `Départ localisé : ${a.label} · Arrivée localisée : ${b.label}. Temps majoré de ${state.params.coef} % (paramètre « Majoration trafic »).`;
    showEcart();
    if (mapT) {
      if (layerT) layerT.remove();
      layerT = L.featureGroup().addTo(mapT);
      L.geoJSON(rt.geometry, { style: { color: '#1d4f91', weight: 5 } }).addTo(layerT);
      L.marker([a.lat, a.lon], { icon: pinIcon('A', '#1d4f91', true) }).addTo(layerT);
      L.marker([b.lat, b.lon], { icon: pinIcon('B', '#c26a1a') }).addTo(layerT);
      mapT.fitBounds(layerT.getBounds(), { padding: [24, 24] });
    }
    alertMsg('#tr-msg', '');
  } catch (err) { alertMsg('#tr-msg', esc(err.message), 'err'); }
  finally { btn.disabled = false; }
}
function showEcart() {
  const v = Number($('#tr-terrain').value); const el = $('#tr-ecart');
  if (!v || lastTrajetMin == null) { el.textContent = 'Saisir pour comparer avec le calcul'; return; }
  const d = Math.round(v - lastTrajetMin);
  el.textContent = d === 0 ? 'Identique au calcul majoré' : `Terrain ${d > 0 ? 'plus long' : 'plus court'} de ${Math.abs(d)} min (${Math.round((d / lastTrajetMin) * 100)} %) que le calcul majoré`;
}

/* ---------- pont vers les modules ES (vue Agenda) ---------- */
window.OptiApp = {
  bus: appBus, // événements : 'render' (écran 3 redessiné), 'pick' (sélection), 'hover' (survol d'un repère)
  get params() { return state.params; },
  date: () => state.date,
  days: resultDays,
  result: () => state.results[state.date] || null,
  hasResult: (iso) => !!state.results[iso],
  setDate(iso) { if (iso && iso !== state.date) { state.date = iso; save(); alertMsg('#r-msg', ''); renderResult(); } },
  typeOf, depotOf, crenOf, hm2s, longDate, frDate,
  vehicleWindow: (a) => vehicleWindow(a, state.params),
  pickedJob: () => pickedJob,
  selectJob, hoverJob,
  refreshMap() { if (mapR) setTimeout(() => mapR.invalidateSize(), 0); }
};

/* ---------- démarrage ---------- */
load();
bindParams();
bindPlan();
$('#r-csv').addEventListener('click', exportCsv);
$('#r-print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', route);
route();
