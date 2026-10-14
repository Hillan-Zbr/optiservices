/* Optiservices — vue Agenda : rendu DOM de la grille et des panneaux
   Données patients écrites uniquement par textContent / aria-label (jamais innerHTML, jamais en console). */

import {
  PX_PAR_HEURE, HAUTEUR_ENTETE_COLONNE, LARGEUR_MIN_COLONNE, LARGEUR_MIN_COLONNE_COMPARAISON,
  MAX_AMD_AFFICHES, LARGEUR_AXE_HEURES, SEUIL_LIBELLE_TRAJET_MIN, HAUTEUR_RDV_COMPACT_PX
} from './agenda-constants.js';
import { dureeMin, fmtHeure, fmtDuree } from './agenda-model.js';

/* création d'élément : h('div.a.b', { attrs }, enfants…) — les chaînes deviennent des nœuds texte */
function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name);
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'style') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const LEGENDE = [
  ['g-pni', 'PNI'], ['g-oxy', 'OXY'], ['g-des', 'DES'], ['g-autre', 'Autre type'], ['setup', 'Stationnement'], ['trajet', 'Trajet'],
  ['pause', 'Pause'], ['attente', 'Attente avant créneau'], ['warn', 'Proche de la fin du créneau'],
  ['over', 'Retour après les heures ouvrées'], ['off', 'Hors heures ouvrées']
];

let refs = null;
let handlers = null;

/**
 * Construit le squelette (une seule fois).
 * @param {HTMLElement} root
 * @param {object} h_ { onJour(iso), onAntenne(id), onMode(m), onSelect(jobId), onHover(jobId|null), onVoirCarte(jobId) }
 */
export function mountAgenda(root, h_) {
  handlers = h_;
  const jour = h('select', { id: 'ag-jour', onchange: (e) => handlers.onJour(e.target.value) });
  const antennes = h('div.ag-segbtns');
  const modes = h('div.ag-segbtns');
  const summary = h('div.ag-summary', { 'aria-live': 'polite' });
  const toolbar = h('div.ag-toolbar.ag-card',
    {},
    h('div.ag-field', {}, h('label', { for: 'ag-jour', text: 'Jour' }), jour),
    h('div.ag-field', { role: 'group', 'aria-label': 'Département' }, h('span.ag-flabel', { text: 'Département', 'aria-hidden': 'true' }), antennes),
    h('div.ag-field', { role: 'group', 'aria-label': 'Affichage' }, h('span.ag-flabel', { text: 'Affichage', 'aria-hidden': 'true' }), modes),
    summary
  );

  const msg = h('p.ag-msg', { hidden: true });
  const note = h('p.ag-note', { hidden: true });
  const grid = h('div.ag-grid');
  const scroll = h('div.ag-scroll', {}, grid);
  const legend = h('ul.ag-legend', { 'aria-label': 'Légende' },
    LEGENDE.map(([k, l]) => h('li', {}, h('span.ag-swatch.sw-' + k.replace(' ', '-'), { 'aria-hidden': 'true' }), l)));
  const main = h('section.ag-card.ag-main', { 'aria-label': 'Agenda des AMD' }, msg, note, scroll, legend);

  const detailBody = h('div.ag-detail-body');
  const detail = h('section.ag-card.ag-detail', { 'aria-labelledby': 'ag-detail-t' }, h('h2', { id: 'ag-detail-t', text: 'Détail du RDV' }), detailBody);
  const unCount = h('span.ag-uncount');
  const unList = h('ul.ag-unlist');
  const unEmpty = h('p.ag-hint', { text: 'Tous les RDV de la journée sont placés.', hidden: true });
  const placer = h('section.ag-card.ag-placer', { 'aria-labelledby': 'ag-placer-t' },
    h('div.ag-row', {}, h('h2', { id: 'ag-placer-t', text: 'À placer' }), unCount), unEmpty, unList);
  const side = h('aside.ag-side', {}, detail, placer);
  const body = h('div.ag-body', {}, main, side);

  root.replaceChildren(toolbar, body);
  refs = { root, jour, antennes, modes, summary, msg, note, grid, scroll, main, detailBody, unCount, unList, unEmpty, placer, legend };
}

function segBtns(container, opts, current, onPick) {
  container.replaceChildren(...opts.map((o) => h('button.ag-opt', {
    type: 'button', 'aria-pressed': String(o.value === current), disabled: o.disabled, title: o.title,
    onclick: () => onPick(o.value)
  }, o.label)));
}

/**
 * Rendu complet.
 * @param {object} vm  {
 *   jours:[{iso,label}], jour, antennes:[{value,label}], antenne, mode, cmpDisponible, cmpTitre,
 *   message?:string, note?:string, pairs:[{opt:AmdColumn, act:AmdColumn|null}], bornes, summary:string,
 *   nonAffectes:[{key, jobId?, titre, motif}], detail:object|null, selectedJobId, hoveredJobId }
 */
export function renderAgenda(vm) {
  const r = refs;
  r.jour.replaceChildren(...vm.jours.map((d) => h('option', { value: d.iso, selected: d.iso === vm.jour }, d.label)));
  r.jour.disabled = !vm.jours.length;
  segBtns(r.antennes, [{ value: 'all', label: 'Toutes' }].concat(vm.antennes), vm.antenne, handlers.onAntenne);
  segBtns(r.modes, [
    { value: 'opt', label: 'Optimisé' },
    { value: 'cmp', label: 'Optimisé vs actuel', disabled: !vm.cmpDisponible, title: vm.cmpDisponible ? null : vm.cmpTitre }
  ], vm.mode, handlers.onMode);
  r.summary.textContent = vm.summary || '';

  r.msg.hidden = !vm.message; r.msg.textContent = vm.message || '';
  r.note.hidden = !vm.note; r.note.textContent = vm.note || '';
  r.scroll.hidden = !vm.pairs.length;
  r.legend.hidden = !vm.pairs.length;
  renderGrid(vm);
  renderPlacer(vm);
  renderDetail(vm.detail);
}

/* ---------- grille ---------- */
function renderGrid(vm) {
  const { pairs, bornes, mode } = vm;
  const cmp = mode === 'cmp';
  const y = (m) => ((m - bornes.debutMin) / 60) * PX_PAR_HEURE;
  const hauteur = y(bornes.finMin);
  const pos = (s, e, minH = 2) => ({ top: y(s) + 1 + 'px', height: Math.max(minH, y(e) - y(s) - 2) + 'px' });

  const grid = refs.grid;
  grid.style.setProperty('--ag-col-min', (cmp ? LARGEUR_MIN_COLONNE_COMPARAISON : LARGEUR_MIN_COLONNE) + 'px');
  grid.style.setProperty('--ag-max-cols', MAX_AMD_AFFICHES);
  grid.style.setProperty('--ag-axe', LARGEUR_AXE_HEURES + 'px');
  grid.style.setProperty('--ag-entete', HAUTEUR_ENTETE_COLONNE + 'px');
  grid.style.setProperty('--ag-pph', PX_PAR_HEURE + 'px');
  grid.classList.toggle('cmp', cmp);

  const ticks = [];
  for (let m = bornes.debutMin; m <= bornes.finMin; m += 60) ticks.push(h('div.ag-tick', { style: { top: y(m) + 'px' } }, Math.floor(m / 60) + 'h'));
  const axe = h('div.ag-axis', { 'aria-hidden': 'true' }, h('div.ag-colh'), h('div.ag-colb', { style: { height: hauteur + 'px' } }, ticks));

  const cols = pairs.map(({ opt, act }) => {
    const ho = opt.heuresOuvrees;
    const over = opt.depasseHeuresOuvrees;
    let fin = opt.retourMin != null ? 'Retour ' + fmtHeure(opt.retourMin) : 'Pas de tournée';
    if (cmp) fin += act && act.retourMin != null ? ' (actuel ' + fmtHeure(act.retourMin) + ')' : ' (actuel —)';
    const head = h('div.ag-colh', {},
      h('div.ag-amd', {}, opt.name),
      h('div.ag-sub', {}, 'Dép. ' + opt.antenneNom + ' · ' + opt.nbRdv + ' RDV'),
      h('div.ag-fin' + (over ? '.over' : ''), {}, fin, over ? h('span', {}, ' ⚠', h('span.ag-sr', {}, ' retour après les heures ouvrées')) : null)
    );
    const shades = [
      ho.debutMin > bornes.debutMin ? h('div.ag-off', { style: { top: '0px', height: y(ho.debutMin) + 'px' } }) : null,
      ho.finMin < bornes.finMin ? h('div.ag-off', { style: { top: y(ho.finMin) + 'px', height: hauteur - y(ho.finMin) + 'px' } }) : null
    ];
    const optLane = h('div.ag-lane.opt', {}, opt.segments.map((s) => segEl(s, opt, pos, vm)));
    const actLane = cmp ? h('div.ag-lane.act', { 'aria-hidden': 'true' }, (act ? act.segments : []).map((s) => actEl(s, pos))) : null;
    const vide = opt.vide ? h('div.ag-vide', {}, 'Aucun RDV') : null;
    return h('div.ag-col', { role: 'group', 'aria-label': opt.name }, head,
      h('div.ag-colb', { style: { height: hauteur + 'px' } }, shades, optLane, actLane, vide));
  });
  grid.replaceChildren(axe, ...cols);
}

function segEl(s, col, pos, vm) {
  const d = dureeMin(s);
  if (s.kind === 'rdv') {
    const style = pos(s.startMin, s.endMin, 14);
    const heures = fmtHeure(s.startMin) + '–' + fmtHeure(s.endMin);
    const label = [s.o2 ? 'O2' : null, s.patient, s.ville, heures, s.warn ? 'arrivée proche de la fin du créneau' : null].filter(Boolean).join(', ');
    const compact = parseFloat(style.height) < HAUTEUR_RDV_COMPACT_PX;
    const sel = vm.selectedJobId === s.jobId;
    return h('button.ag-seg.k-rdv.g-' + String(s.groupe || 'AUTRE').toLowerCase() + (s.warn ? '.warn' : '') + (sel ? '.sel' : '') + (compact ? '.compact' : '') + (vm.hoveredJobId === s.jobId ? '.hov' : ''), {
      type: 'button', style, 'data-job': s.jobId, 'aria-label': label, 'aria-pressed': String(sel),
      onclick: () => handlers.onSelect(vm.selectedJobId === s.jobId ? null : s.jobId),
      onmouseenter: () => handlers.onHover(s.jobId), onmouseleave: () => handlers.onHover(null),
      onfocus: () => handlers.onHover(s.jobId), onblur: () => handlers.onHover(null)
    },
    h('span.l1', {}, (s.o2 ? 'O2 · ' : '') + (s.patient || 'RDV ' + s.jobId)),
    h('span.l2', {}, s.ville || ''),
    h('span.l3', {}, heures));
  }
  const style = pos(s.startMin, s.endMin);
  let txt = '', title = '', cls = 'k-' + s.kind;
  if (s.kind === 'trajet' || s.kind === 'retour') {
    const over = s.kind === 'retour' && col.depasseHeuresOuvrees;
    if (over) cls += '.over';
    txt = d >= SEUIL_LIBELLE_TRAJET_MIN ? (s.kind === 'retour' ? 'Retour ' : 'Trajet ') + d + ' min' : '';
    title = (s.kind === 'retour' ? 'Retour à l’antenne, ' : 'Trajet, ') + fmtDuree(d) + (over ? ' — après les heures ouvrées' : '');
  } else if (s.kind === 'setup') title = 'Stationnement ' + d + ' min';
  else if (s.kind === 'pause') { txt = 'Pause ' + d + ' min'; title = 'Pause ' + fmtHeure(s.startMin) + '–' + fmtHeure(s.endMin); }
  else if (s.kind === 'attente') { txt = 'Attente ' + d + ' min'; title = 'Attente avant le créneau, ' + fmtDuree(d); }
  return h('div.ag-seg.' + cls, { style, title }, txt);
}

function actEl(s, pos) {
  return h('div.ag-seg.act.k-' + s.kind + (s.kind === 'rdv' ? '.g-' + String(s.groupe || 'AUTRE').toLowerCase() : ''), { style: pos(s.startMin, s.endMin) });
}

/* ---------- panneaux ---------- */
function renderPlacer(vm) {
  const n = vm.nonAffectes.length;
  refs.placer.hidden = !vm.jour;
  refs.unCount.textContent = n ? n + ' non affecté' + (n > 1 ? 's' : '') : '';
  refs.unEmpty.hidden = n > 0 || !vm.pairs.length;
  refs.unList.replaceChildren(...vm.nonAffectes.map((u) => {
    const inner = [h('span.ag-untitre', {}, u.titre), h('span.ag-unmotif', {}, 'Motif probable : ' + u.motif)];
    return h('li', {}, u.jobId
      ? h('button.ag-unitem' + (vm.selectedJobId === u.jobId ? '.sel' : ''), { type: 'button', 'data-job': u.jobId, 'aria-pressed': String(vm.selectedJobId === u.jobId), onclick: () => handlers.onSelect(vm.selectedJobId === u.jobId ? null : u.jobId) }, inner)
      : h('div.ag-unitem', {}, inner));
  }));
}

function renderDetail(d) {
  const b = refs.detailBody;
  const fill = (...kids) => b.replaceChildren(...kids.filter(Boolean));
  if (!d) {
    b.replaceChildren(h('p.ag-hint', {}, 'Sélectionnez un RDV dans l’agenda (clic ou touche Entrée) pour afficher son détail.'));
    return;
  }
  const kv = (k, v) => h('div', {}, h('div.ag-k', {}, k), h('div.ag-v', {}, v));
  const voir = h('button.ag-voir', { type: 'button', onclick: () => handlers.onVoirCarte(d.jobId), disabled: !d.surCarte }, 'Voir sur la carte');
  if (d.nonAffecte) {
    fill(
      h('div', {}, h('div.ag-patient', {}, d.patient), h('div.ag-ville', {}, d.ville + ' · ' + d.intervention)),
      h('div.ag-kv', {}, kv('Créneau demandé', d.creneau), kv('Statut', 'Non affecté'), kv('Visite | Prestation', d.visitePrest || '—')),
      d.infoRdv ? h('div.ag-kv.ag-kv1', {}, kv('Info RDV', d.infoRdv)) : null,
      h('p.ag-alert', {}, 'Motif probable : ' + d.motif),
      voir);
    return;
  }
  fill(
    h('div', {}, h('div.ag-patient', {}, (d.o2 ? 'O2 · ' : '') + d.patient), h('div.ag-ville', {}, d.ville + ' · ' + d.intervention)),
    h('div.ag-kv', {},
      kv('Arrivée prévue', fmtHeure(d.arriveeMin)), kv('Fin d’intervention', fmtHeure(d.endMin)),
      kv('Créneau demandé', d.creneau || '—'), kv('Durée', fmtDuree(dureeMin(d))),
      kv('Trajet précédent', d.trajetPrecedentMin ? fmtDuree(d.trajetPrecedentMin) : '—'), kv('AMD', d.amd),
      kv('Visite | Prestation', d.visitePrest || '—')),
    d.infoRdv ? h('div.ag-kv.ag-kv1', {}, kv('Info RDV', d.infoRdv)) : null,
    d.warn ? h('p.ag-warn', {}, 'Arrivée proche de la fin du créneau : peu de marge en cas d’aléa de circulation.') : null,
    voir);
}

/* ---------- mises à jour légères (sans reconstruire la grille) ---------- */
export function applySelection(jobId, detail) {
  if (!refs) return;
  refs.root.querySelectorAll('[data-job]').forEach((el) => {
    const on = el.dataset.job === jobId;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-pressed', String(on));
  });
  renderDetail(detail);
}

export function applyHover(jobId) {
  if (!refs) return;
  refs.grid.querySelectorAll('.k-rdv.hov').forEach((el) => el.classList.remove('hov'));
  if (jobId != null) refs.grid.querySelectorAll(`.k-rdv[data-job="${CSS.escape(jobId)}"]`).forEach((el) => el.classList.add('hov'));
}

export function focusJob(jobId) {
  const el = refs && refs.grid.querySelector(`.k-rdv[data-job="${CSS.escape(jobId)}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
