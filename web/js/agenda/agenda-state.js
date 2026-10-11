/* Optiservices — vue Agenda : état partagé avec la carte + bus d'événements
   Événements émis : 'selectionchange', 'hoverchange', 'change' (jour, antenne, mode, vue). */

const VUE_KEY = 'optiservices.resultat.vue';
const readVue = () => { try { return localStorage.getItem(VUE_KEY) === 'agenda' ? 'agenda' : 'carte'; } catch (e) { return 'carte'; } };
const writeVue = (v) => { try { localStorage.setItem(VUE_KEY, v); } catch (e) { /* stockage indisponible : sans effet */ } };

export const bus = new EventTarget();

export const state = {
  jour: null,          // date ISO affichée
  antenne: 'all',      // 'all' ou identifiant d'antenne
  mode: 'opt',         // 'opt' | 'cmp'
  vue: readVue(),      // 'carte' | 'agenda'
  selectedJobId: null, // identifiant VROOM du job (chaîne)
  hoveredJobId: null
};

const norm = (id) => (id == null ? null : String(id));

export function select(jobId) {
  const id = norm(jobId);
  if (state.selectedJobId === id) return;
  state.selectedJobId = id;
  bus.dispatchEvent(new CustomEvent('selectionchange', { detail: { jobId: id } }));
}

export function hover(jobId) {
  const id = norm(jobId);
  if (state.hoveredJobId === id) return;
  state.hoveredJobId = id;
  bus.dispatchEvent(new CustomEvent('hoverchange', { detail: { jobId: id } }));
}

export function set(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (k in state && state[k] !== v) { state[k] = v; changed = true; }
  }
  if ('vue' in patch) writeVue(state.vue);
  if (changed) bus.dispatchEvent(new CustomEvent('change', { detail: patch }));
}
