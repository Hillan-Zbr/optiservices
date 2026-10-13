/* Optiservices — journal d'activité : fenêtre « Aide » (consultation, filtres, export CSV)
   Module ES ; s'appuie sur window.OptiJournal (journal-core.js). */

const J = window.OptiJournal;
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NIV_LBL = { info: 'INFO', warn: 'WARN', crit: 'CRIT' };
const PAGE = 200; // lignes affichées par tranche

const f = { niveaux: ['info', 'warn', 'crit'], categorie: '', du: '', au: '', texte: '' };
let shown = PAGE;
let dlg, btn;

function mount() {
  btn = $('#btn-aide');
  dlg = $('#dlg-aide');
  $('#jr-cat').innerHTML = '<option value="">Toutes</option>' + Object.entries(J.CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

  btn.addEventListener('click', open);
  $('#jr-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic sur le fond
  dlg.addEventListener('close', () => { J.markSeen(); resetClear(); });

  $('#jr-filtres').addEventListener('input', (e) => {
    const el = e.target;
    if (el.name === 'niveau') f.niveaux = [...dlg.querySelectorAll('input[name=niveau]:checked')].map((x) => x.value);
    else if (el.id === 'jr-cat') f.categorie = el.value;
    else if (el.id === 'jr-du') f.du = el.value;
    else if (el.id === 'jr-au') f.au = el.value;
    else if (el.id === 'jr-txt') f.texte = el.value;
    shown = PAGE; render();
  });
  $('#jr-reset').addEventListener('click', () => {
    Object.assign(f, { niveaux: ['info', 'warn', 'crit'], categorie: '', du: '', au: '', texte: '' });
    dlg.querySelectorAll('input[name=niveau]').forEach((x) => { x.checked = true; });
    $('#jr-cat').value = ''; $('#jr-du').value = ''; $('#jr-au').value = ''; $('#jr-txt').value = '';
    shown = PAGE; render();
  });
  $('#jr-more').addEventListener('click', () => { shown += PAGE; render(); });
  $('#jr-csv').addEventListener('click', exportCsv);
  $('#jr-clear-zone').addEventListener('click', onClear);

  J.subscribe(() => { badge(); if (dlg.open) render(); });
  badge();
}

function open() {
  shown = PAGE; render();
  dlg.showModal();
  J.info('action', 'Consultation du journal', 'Ouverture de la fenêtre Aide');
}

/* pastille : nombre d'alertes (warn/crit) apparues depuis la dernière consultation */
function badge() {
  const u = J.unseen(); const b = $('#btn-aide-n');
  const crit = u.some((e) => e.niveau === 'crit');
  b.hidden = !u.length; b.textContent = u.length > 99 ? '99+' : u.length;
  b.className = 'aide-n' + (crit ? ' crit' : '');
  btn.title = u.length ? `${u.length} alerte${u.length > 1 ? 's' : ''} depuis votre dernière consultation` : 'Aide et journal d’activité';
}

function current() { return J.filter(J.entries(), f).reverse(); } // plus récentes en tête

function render() {
  const all = J.entries(); const list = current();
  const cnt = { info: 0, warn: 0, crit: 0 }; list.forEach((e) => { cnt[e.niveau]++; });
  $('#jr-count').innerHTML = `${list.length} ligne${list.length > 1 ? 's' : ''}${list.length < all.length ? ` sur ${all.length}` : ''}`
    + ` · <span class="niv crit">${cnt.crit} CRIT</span> <span class="niv warn">${cnt.warn} WARN</span> <span class="niv info">${cnt.info} INFO</span>`;
  $('#jr-csv').disabled = !list.length;
  const vu = J.lastSeen();
  $('#jr-body').innerHTML = list.length
    ? list.slice(0, shown).map((e) => `<tr class="n-${e.niveau}${e.id > vu && e.niveau !== 'info' ? ' new' : ''}">
        <td class="mono nowrap">${esc(J.localStamp(e.ts))}</td>
        <td><span class="niv ${e.niveau}">${NIV_LBL[e.niveau]}</span></td>
        <td class="nowrap">${esc(J.CATEGORIES[e.categorie] || e.categorie)}</td>
        <td><b>${esc(e.action)}</b>${e.message ? '<div>' + esc(e.message) + '</div>' : ''}${e.details ? `<div class="hint det">${esc(e.details)}</div>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="4" class="empty">${all.length ? 'Aucune ligne ne correspond aux filtres.' : 'Le journal est vide.'}</td></tr>`;
  $('#jr-more').hidden = list.length <= shown;
  $('#jr-more').textContent = `Afficher ${Math.min(PAGE, list.length - shown)} lignes de plus (${list.length - shown} restantes)`;
}

function exportCsv() {
  const list = current();
  if (!list.length) return;
  const d = new Date(); const two = (n) => String(n).padStart(2, '0');
  const name = `journal_optiservices_${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}.csv`;
  const csv = J.toCsv(list.slice().reverse()); // ordre chronologique dans le fichier
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  J.info('action', 'Export du journal', `${list.length} ligne${list.length > 1 ? 's' : ''} exportée${list.length > 1 ? 's' : ''} dans ${name}`, describeFilter());
}
function describeFilter() {
  const out = {};
  if (f.niveaux.length < 3) out.niveaux = f.niveaux.join(', ') || 'aucun';
  if (f.categorie) out.categorie = J.CATEGORIES[f.categorie];
  if (f.du) out.du = f.du;
  if (f.au) out.au = f.au;
  if (f.texte) out.recherche = f.texte;
  return out;
}

/* vidage en deux temps, sans boîte de dialogue navigateur */
function resetClear() { $('#jr-clear-zone').innerHTML = '<button class="btn2 danger small" type="button" data-clear="ask">Vider le journal</button>'; }
function onClear(e) {
  const b = e.target.closest('[data-clear]'); if (!b) return;
  if (b.dataset.clear === 'ask') {
    $('#jr-clear-zone').innerHTML = `<b class="danger-txt">Supprimer les ${J.entries().length} lignes ?</b>
      <button class="btn2 danger small" type="button" data-clear="ok">Confirmer</button><button class="btn2 small" type="button" data-clear="no">Annuler</button>`;
  } else {
    if (b.dataset.clear === 'ok') J.clear();
    resetClear();
  }
}

if (J && document.getElementById('dlg-aide')) mount();
else console.warn('Journal : OptiJournal ou fenêtre Aide introuvable');
