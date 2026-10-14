# Optiservices — Spécification de la vue « Agenda » (écran 3)

Document destiné à un agent de développement. Il décrit ce qu'il faut ajouter à l'application statique du banc de test (vanilla JS en modules ES, Leaflet local, nginx, VROOM v1.14.0 + OSRM).

**Maquette de référence (rendu visuel à respecter)** : https://claude.ai/artifact/DGLerV3X31VcwoyF7j8tSo
Ses données sont fictives et le coefficient ×1,4 sur les trajets « actuel » n'est qu'un placeholder : ne pas les reprendre.

> **Mise à jour du 14/10/2026 — mode « AMD bloqué » par défaut.** Chaque RDV reste chez l'AMD affecté dans Isadom (compétence VROOM `100+i`) ; ce calcul unique est le résultat retenu, celui qui partira vers MJ2. Le 2e appel « répartition libre » est supprimé : le mode « Optimisé vs actuel » est donc désactivé pour les nouveaux résultats. Un RDV que son AMD ne peut pas tenir (créneau, heures ou km max, AMD absent, inconnu ou non renseigné) reste non affecté et ressort en alerte (bandeau en haut de l'écran 3, compteur dans l'en-tête de l'AMD, liste « RDV non affectés » / « À placer », journal WARN).

---

## 1. Objectif

Depuis l'écran 3 (Résultat), ajouter une vue **Agenda** type calendrier Outlook « Jour » :

- une **colonne par AMD** (7 AMD maximum), axe vertical = heures ;
- les RDV, trajets, stationnements, pauses et attentes positionnés à partir de la réponse VROOM ;
- une comparaison **optimisé vs actuel** ;
- un panneau de détail du RDV sélectionné et un panneau « À placer » pour les non-affectés.

Vocabulaire à respecter dans toute l'interface :
- **AMD** = les livreurs ;
- **Antenne** (et non « départ ») = lieu de départ et de retour des véhicules. En phase de test : Aubagne (siège, 13) et Sisteron (04) uniquement ;
- **Isadom** = ERP source des RDV et patients (hors périmètre ici, les données arrivent par le CSV existant).

## 2. Périmètre

**Inclus (v1)** : lecture seule, un jour à la fois, bascule Carte + liste / Agenda, filtre par antenne, mode Optimisé / Optimisé vs actuel, sélection d'un RDV, alertes visuelles, panneau « À placer ».

**Exclus (v1)** : glisser-déposer avec recalcul, vue Semaine, export ICS (voir §11, phase 2), envoi dans Outlook via Microsoft Graph.

## 3. Intégration dans l'application existante

### 3.1 Point d'entrée
Un sélecteur de vue en haut de l'écran 3 : **Carte + liste** (existant) | **Agenda**. Les deux vues partagent le même état de sélection (jour, AMD, RDV) : basculer ne doit rien perdre.

### 3.2 Fichiers à créer (proposition, à adapter à l'arborescence réelle de `./web`)

```
web/js/agenda/
  agenda-model.js   // pur, sans DOM : réponse VROOM -> modèle de vue (testable)
  agenda-view.js    // rendu DOM de la grille et des panneaux
  agenda-state.js   // état partagé + bus d'événements (sélection, filtres, mode)
  agenda-reasons.js // déduction du « motif probable » des non-affectés
web/css/agenda.css
```

Contraintes : zéro build, modules ES, pas de dépendance nouvelle. `agenda-model.js` ne touche jamais au DOM.

### 3.3 État partagé avec la carte
`agenda-state.js` expose un état `{ jour, antenne, mode, selectedJobId, hoveredJobId }` et un `EventTarget` qui émet `selectionchange` et `hoverchange`.
- Clic ou survol d'un bloc RDV → surbrillance du marqueur et du tracé sur la carte (et inversement).
- Le bouton « Voir sur la carte » du panneau de détail bascule sur la vue Carte avec ce RDV sélectionné.

## 4. Données d'entrée

### 4.1 Deux réponses VROOM
1. **Optimisé** : l'appel VROOM existant.
2. **Actuel** : le 2e appel existant (chaque RDV forcé sur son AMD actuel via `skill` 100+i, meilleur ordre par AMD).

Le modèle de vue doit être construit de la même façon pour les deux, puis les deux résultats sont appariés par AMD (via l'identifiant du véhicule).

### 4.2 Champs VROOM utilisés
Par route (`routes[]`) : `vehicle`, `steps[]`, `duration`, `distance` (si présent).
Par étape (`steps[]`) : `type` (`start`, `job`, `break`, `end`), `arrival`, `setup`, `service`, `waiting_time`, `job`, `location`, `distance` (cumulée, si présent), `duration` (cumulée).
Non-affectés : `unassigned[]` (`id`, `location`, `type`).

À vérifier sur une **réponse réelle** du banc de test avant de figer le code :
- l'ordre exact dans une étape `job` : trajet → attente → stationnement (`setup`) → service. Le modèle ci-dessous suppose cet ordre ;
- la présence de `distance` sur chaque étape (dépend de la configuration) ;
- VROOM v1.14 ne fournit pas de motif de non-affectation (voir §8).

### 4.3 Unité de temps
VROOM renvoie des **secondes depuis minuit**. Le modèle de vue travaille en **minutes depuis minuit** (entiers arrondis) et rattache les heures à la date du RDV du CSV. Hypothèse v1 : un lot de tournées = un jour. Si le CSV contient plusieurs dates, filtrer par jour avec un sélecteur de date (liste des dates distinctes du CSV).

## 5. Modèle de vue (`agenda-model.js`)

Fonction principale :

```js
/**
 * @param {object} vroomResponse  réponse VROOM brute
 * @param {object} context        { vehicles, jobsById, params } (infos métier : AMD, antenne, RDV du CSV, heures ouvrées)
 * @returns {AgendaDay}
 */
export function buildAgendaDay(vroomResponse, context) { ... }
```

Types (JSDoc) :

```js
/** @typedef {{ id:string, name:string, antenne:'aubagne'|'sisteron', startMin:number, endMin:number,
 *             segments:Segment[], retourMin:number, depasseHeuresOuvrees:boolean, nbRdv:number, trajetTotalMin:number }} AmdColumn */

/** @typedef {{ kind:'trajet'|'retour'|'setup'|'rdv'|'pause'|'attente',
 *             startMin:number, endMin:number,
 *             jobId?:string, patient?:string, ville?:string, intervention?:string, // rdv uniquement
 *             creneau?:string, trajetPrecedentMin?:number,
 *             warn?:boolean }} Segment */

/** @typedef {{ colonnes:AmdColumn[], nonAffectes:Unassigned[], bornes:{debutMin:number, finMin:number} }} AgendaDay */
```

### 5.1 Règles de construction des segments
Pour chaque route, parcourir `steps` dans l'ordre :

| Étape VROOM | Segments produits |
|---|---|
| `start` | rien (point d'ancrage, `startMin = arrival`) |
| `job` | `trajet` de (fin de l'étape précédente) à `arrival` ; puis `attente` si `waiting_time > 0` ; puis `setup` si `setup > 0` ; puis `rdv` de la fin du setup à `+ service` |
| `break` | `pause` de `arrival` à `arrival + service` |
| `end` | `retour` de la fin de l'étape précédente à `arrival` |

Notes :
- Ne produire un `trajet` que si sa durée est > 0.
- `retourMin` = `arrival` de l'étape `end`. `depasseHeuresOuvrees` = `retourMin > heureFinOuvrée` (paramètre existant des heures ouvrées de l'AMD).
- `warn` (liseré orange) sur un RDV dont l'arrivée est à moins de **15 min** de la fin de son créneau demandé (seuil à exposer en constante, voir §9).
- `trajetPrecedentMin` = durée du segment `trajet` qui précède le RDV.
- `patient` : prénom et nom issus du CSV via `jobsById`, jamais recopiés dans des logs.

### 5.2 Bornes de l'axe
`debutMin` = heure de début des heures ouvrées arrondie à l'heure inférieure moins 1 h ; `finMin` = heure de fin arrondie à l'heure supérieure plus 1 h. Étendre si un segment sort de cette plage. La maquette utilise 7h–19h pour des heures ouvrées de 8h–17h30.

### 5.3 Comparaison
`buildAgendaDay` est appelé deux fois (optimisé, actuel). La vue reçoit les deux et les apparie par `AmdColumn.id`. Si un AMD existe dans un résultat mais pas dans l'autre, afficher sa colonne sans voie « actuel ».

Indicateurs du résumé (barre d'outils) calculés à partir des modèles, **jamais saisis** : somme des durées `trajet` + `retour` pour chaque mode, nombre d'AMD et de RDV affichés.

## 6. Interface (`agenda-view.js`, `agenda.css`)

### 6.1 Barre d'outils
- **Jour** : `<select>` des dates du CSV.
- **Antenne** : groupe de 3 boutons exclusifs — Toutes / Aubagne / Sisteron.
- **Affichage** : groupe de 2 boutons exclusifs — Optimisé / Optimisé vs actuel.
- **Résumé** à droite : « N AMD · N RDV · trajets X h YY » ; en mode comparaison : « Trajets : X optimisé · Y actuel · N RDV ».

### 6.2 Grille
- Axe des heures à gauche (largeur 52 px), un libellé par heure (« 7h » … « 19h »), ligne horizontale à chaque heure.
- **72 px par heure** (constante `PX_PAR_HEURE`).
- Une colonne par AMD : en-tête fixe de **64 px** (nom, « Antenne X · N RDV », « Retour 16h40 »), puis zone positionnée en `position:absolute` : `top = (startMin - debutMin) / 60 * 72`, `height = (endMin - startMin) / 60 * 72`, avec 1 px de marge haut et bas.
- Zones hors heures ouvrées : fond grisé (`rgba(21,33,44,.07)`).
- Largeur minimale d'une colonne : 104 px en mode Optimisé, 230 px en mode comparaison. La zone défile horizontalement (`overflow-x:auto`) si besoin.
- Mode comparaison : la colonne se scinde en deux voies. Optimisé à gauche (reste de la largeur), **actuel à droite** (34 %), en teintes claires, contour pointillé, sans texte, non cliquable. L'en-tête ajoute « (actuel hh:mm) » à l'heure de retour.

### 6.3 Rendu des segments

| Segment | Rendu |
|---|---|
| `rdv` | `<button>` plein, 3 lignes : patient (gras, préfixe « O2 · » si intervention O2), ville, « hh:mm–hh:mm ». Fond `#2F6DB5` (standard) ou `#0A6B5C` (O2), texte blanc |
| `trajet` | bloc clair `#E9EEF3`, libellé « Trajet N min » seulement si ≥ 20 min |
| `retour` | idem, libellé « Retour N min » ; si `depasseHeuresOuvrees` : fond `#F6D4D1`, texte `#7A1912` |
| `setup` | bande fine `#AEBBC9`, sans libellé (infobulle) |
| `pause` | hachuré gris, « Pause N min » |
| `attente` | hachuré orange clair, « Attente N min » |
| `rdv` avec `warn` | liseré orange `#E07B00` (2 px d'écart blanc, 2 px de trait) |
| `rdv` sélectionné | liseré `#15212C` de même forme |

Un RDV de 45 min fait 54 px de haut : les 3 lignes (12 px, interligne 1,2) doivent y tenir. Prévoir `text-overflow:ellipsis` sur chaque ligne.

### 6.4 Panneau « Détail du RDV »
Patient, ville, type d'intervention ; arrivée prévue, fin d'intervention, créneau demandé, durée, trajet précédent, AMD ; bandeau orange si `warn` ; bouton « Voir sur la carte ». Par défaut, aucun RDV sélectionné : afficher un texte d'invite plutôt qu'un détail vide.

### 6.5 Panneau « À placer »
Liste des non-affectés avec le titre (patient · ville · intervention · créneau) et le **motif probable** (voir §8). Compteur « N non affectés » en rouge.

### 6.6 Légende
Reprendre les 9 entrées de la maquette (RDV standard, RDV O2, stationnement, trajet, pause, attente, proche de la fin du créneau, retour après les heures ouvrées, hors heures ouvrées).

## 7. Palette et tokens

À définir en variables CSS dans `agenda.css` (ne pas disperser les hexadécimaux) :

| Rôle | Valeur |
|---|---|
| Fond de page | `#F3F5F7` |
| Carte | `#FFFFFF`, bordure `#D9E0E6` |
| Texte | `#15212C` ; secondaire `#4B5A67` ; tertiaire `#33414E` |
| RDV standard / O2 | `#2F6DB5` / `#0A6B5C` |
| Trajet / stationnement | `#E9EEF3` / `#AEBBC9` |
| Alerte orange / rouge | `#E07B00` / `#B3261E` |
| Police | IBM Plex Sans (avec repli `system-ui`), à héberger **localement** si le poste n'a pas d'accès Internet |

Les couleurs RDV standard et O2 diffèrent par la luminosité, pas seulement par la teinte, et O2 est aussi signalé par le préfixe « O2 · » : ne pas supprimer ce préfixe.

## 8. Motif probable des non-affectés (`agenda-reasons.js`)

VROOM v1.14 ne dit pas pourquoi un job n'est pas affecté. Déduire un motif **à titre indicatif** (toujours libellé « Motif probable ») avec ces tests, dans cet ordre :

1. Le RDV exige O2 mais aucun véhicule du lot n'a le skill O2 → « aucun AMD avec la compétence O2 ».
2. Le créneau du RDV ne recoupe la fenêtre horaire d'aucun véhicule → « créneau hors des heures ouvrées ».
3. Le lieu est plus loin que `max_distance` / `max_travel_time` de toutes les antennes (utiliser la matrice OSRM déjà disponible) → « hors limite de km ou d'heures ».
4. Sinon → « créneau saturé ou capacité insuffisante sur cette antenne ».

Si le point n'a pas pu être géocodé ou n'est pas accessible par le réseau routier (erreur OSRM), le motif est « adresse non localisée » et prime sur les précédents.

## 9. Constantes à exposer (un seul endroit, en tête de module)

```js
export const PX_PAR_HEURE = 72;
export const HAUTEUR_ENTETE_COLONNE = 64;
export const SEUIL_PROCHE_FIN_CRENEAU_MIN = 15;
export const LARGEUR_MIN_COLONNE = 104;
export const LARGEUR_MIN_COLONNE_COMPARAISON = 230;
export const MAX_AMD_AFFICHES = 7; // au-delà : défilement horizontal, pas de troncature silencieuse
```

## 10. Cas limites à gérer

- **Aucun RDV pour un AMD** : colonne affichée vide avec la mention « Aucun RDV ».
- **Aucune solution VROOM** (`routes` vide) : message explicite, panneau « À placer » rempli, pas de grille vide muette.
- **Plus de 7 AMD** : ne rien masquer, laisser défiler.
- **Heures hors de la plage** : étendre l'axe (voir §5.2), ne pas rogner un bloc.
- **Antenne filtrée sans AMD** : message « Aucun AMD sur cette antenne ».
- **Données personnelles** : écrire les noms de patients avec `textContent`, jamais via `innerHTML` ; ne pas les écrire dans la console ni dans les logs ; ne pas les mettre dans des attributs `title` en dehors de l'interface locale. Les noms, adresses et téléphones viennent d'Isadom et restent soumis aux règles RGPD de l'organisation.
- **Accents et séparateurs** : le CSV est en UTF-8 avec `;` (déjà géré par l'application existante).

## 11. Accessibilité

- Chaque RDV est un vrai `<button>` avec un `aria-label` complet (patient, ville, heures).
- Les groupes de filtres sont des `role="group"` avec `aria-label` ; le bouton actif porte `aria-pressed="true"`.
- Cibles tactiles et clic ≥ 44 px pour les boutons de la barre d'outils.
- Navigation clavier : Tab parcourt les RDV dans l'ordre colonne par colonne puis chronologique ; Entrée sélectionne. Focus visible (contour 3 px).
- Contraste texte ≥ 4,5:1 (les couleurs de la palette ont été choisies pour cela).
- Ne pas transmettre l'information par la couleur seule : l'attente et la pause sont hachurées et libellées, le dépassement d'heures est aussi signalé par le texte de l'en-tête.

## 12. Phase 2 (hors v1, à ne pas implémenter maintenant)

- Export **ICS** par AMD ou par jour : un événement par RDV, avec adresse et durée, pour valider le rendu dans Outlook.
- Impression / PDF du planning de la journée.
- Vue Semaine pour un AMD si les CSV couvrent plusieurs jours.
- Glisser-déposer d'un RDV avec nouvel appel VROOM (à discuter : implique de gérer les conséquences sur les autres tournées).
- Envoi dans les calendriers via Microsoft Graph, avec le futur back-end FastAPI.

## 13. Critères d'acceptation

1. La bascule Carte + liste / Agenda conserve le jour, l'antenne et le RDV sélectionné.
2. Pour une réponse VROOM de test, chaque `job` apparaît exactement une fois comme bloc `rdv`, aux heures d'arrivée et de fin calculées (test unitaire sur `buildAgendaDay`, sans DOM).
3. La somme des durées des segments d'une colonne, de `start` à `end`, est égale à la durée totale de la route VROOM, à ± 1 minute d'arrondi.
4. Un retour après l'heure de fin ouvrée affiche le bloc `retour` en rouge et un « ⚠ » dans l'en-tête.
5. Le filtre Antenne ne laisse que les AMD de l'antenne choisie ; le résumé se met à jour.
6. En mode comparaison, les totaux de trajet affichés correspondent aux sommes réelles des deux modèles.
7. Les non-affectés sont tous listés avec un motif, et leur nombre est égal à `unassigned.length`.
8. Aucun nom de patient n'apparaît dans la console du navigateur ni dans une requête vers `/vroom/`, `/osrm/` ou `/geocode/` autre que ce que l'application envoie déjà.
9. L'ensemble est utilisable au clavier et ne casse pas l'écran 3 existant (carte, liste, comparaison actuelle).

## 14. Points à confirmer avec Franck avant de coder

- Les heures ouvrées sont-elles identiques pour tous les AMD, ou individuelles (temps partiel) ? Le modèle ci-dessus lit déjà l'horaire **par véhicule** pour que les deux cas fonctionnent.
- Le créneau « mi-journée » par défaut est 11h–14h (déjà noté « à confirmer » dans l'architecture) : il influence directement le seuil d'alerte « proche de la fin du créneau ».
- Le seuil de 15 minutes pour cette alerte convient-il ?
