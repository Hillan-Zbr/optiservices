# Contrat d'interface Optiservices → MaJournée V2 (MJ2)

Version du contrat : **1.0** (15/10/2026). Toute évolution incompatible change le préfixe `/api/v1`.

## 1. Principes

- **Optiservices est sur le LAN, MJ2 en DMZ.** Toutes les connexions partent d'Optiservices vers MJ2. MJ2 n'ouvre aucune connexion vers le LAN.
- MJ2 expose une petite API HTTPS. Optiservices l'appelle quand la Responsable valide une tournée, envoie un message, retire un message ou actualise les accusés de lecture.
- **Format** : JSON en UTF-8. Dates au format `AAAA-MM-JJ`, heures `HH:MM` (heure locale de Paris), horodatages ISO 8601 avec fuseau (`2026-10-15T17:42:00+02:00`).
- **Authentification** : en-tête `X-Api-Key` (clé partagée, longue et aléatoire). MJ2 n'accepte que l'IP du serveur Optiservices. La clé n'est jamais dans le dépôt : elle est dans le `.env` du serveur Optiservices et dans la configuration de MJ2.
- **Idempotence** : rejouer un appel ne crée jamais de doublon. Une tournée remplace la précédente ; un message est identifié par son `id`, généré par Optiservices.
- **Champ `commentaire`** : présent sur la tournée, sur chaque étape et sur le message. Texte libre facultatif (`""` par défaut), prévu pour des usages non encore définis. Sur une étape, Optiservices y signale une adresse introuvable dont la position GPS est le centre de la commune (16/10/2026). MJ2 le stocke et peut l'afficher ; il ne porte aucune règle.
- **Champs inconnus** : MJ2 doit ignorer un champ qu'il ne connaît pas (ajout compatible sans changer de version).
- **RGPD** : les données patients ne servent qu'à la tournée. MJ2 ne les conserve que de J-1 à J+1 (purge automatique) et ne les met jamais dans une notification push (le push ne porte qu'un signal).

## 2. Appels

| Méthode | Chemin | Corps | Réponse attendue |
|---|---|---|---|
| `PUT` | `/api/v1/tournees/{date}/{amd_code}` | Tournée (§3) | `200` ou `201` : `{ "version": n }` |
| `POST` | `/api/v1/messages` | Message (§4) | `200` ou `201` : `{ "id": "…" }` |
| `DELETE` | `/api/v1/messages/{id}` | — | `204` (aussi si le message n'existe plus) |
| `GET` | `/api/v1/accuses?depuis={horodatage}` | — | `200` : liste d'accusés (§5) |

Codes d'erreur : `400` corps invalide (réponse `{ "erreurs": ["…"] }`), `401` clé absente ou fausse, `409` version de tournée plus ancienne que celle déjà reçue, `5xx` indisponibilité (Optiservices réessaie).

**Retrait d'une tournée** : un `PUT` avec `etapes: []` signifie « plus de tournée pour cet AMD ce jour-là ».

## 3. Tournée

Une tournée = un AMD, une date. Elle est toujours envoyée **complète**.

```json
{
  "version_contrat": "1.0",
  "date": "2026-10-16",
  "version": 2,
  "publiee_le": "2026-10-15T17:42:00+02:00",
  "modifiee_jour_meme": false,
  "commentaire": "",
  "amd": { "code": "AMD001", "nom": "DUPONT Jean" },
  "antenne": { "code": "aub", "nom": "Siège · Aubagne (13)" },
  "depart": { "heure": "08:00" },
  "retour": { "heure": "16:45" },
  "pause": { "heure": "12:10", "duree_min": 60 },
  "distance_km": 142.3,
  "conduite_min": 185,
  "placement_force": "",
  "etapes": [
    {
      "ordre": 1,
      "id_rdv": "123456",
      "heure_estimee": "08:35",
      "attente_min": 0,
      "duree_sur_place_min": 15,
      "creneau": { "nom": "Matin", "debut": "08:00", "fin": "12:00" },
      "hors_creneau": false,
      "patient": { "nom": "MARTIN Paul", "code": "P000123" },
      "adresse": { "ligne": "12 rue Exemple", "code_postal": "13400", "ville": "Aubagne", "lat": 43.2927, "lon": 5.5708 },
      "types_visite": [ { "code": "LIN", "libelle": "Livraison nutrition" } ],
      "type_visite": "Livraison",
      "prestation": "Nutrition",
      "type_besoin": "Planifié",
      "info_rdv": "",
      "acces": { "tel1": "", "tel2": "", "batiment": "", "etage": "", "porte": "", "interphone": "", "info": "" },
      "commentaire": ""
    }
  ]
}
```

| Champ | Règle |
|---|---|
| `version` | Entier croissant par (date, AMD). MJ2 refuse (`409`) une version inférieure à celle qu'il a. |
| `modifiee_jour_meme` | `true` si la tournée est republiée le jour même : MJ2 doit **alerter** l'AMD. |
| `amd.code` | Identifiant commun aux deux applications : code annuaire Isadom de l'AMD. |
| `placement_force` | Réglage appliqué quand la tournée a été desserrée pour placer tous les RDV (ex. « temps sur place 80 % »), vide sinon. |
| `etapes[].ordre` | Ordre de passage, à partir de 1. |
| `etapes[].heure_estimee` | Heure d'arrivée estimée par l'optimisation, indicative. |
| `etapes[].hors_creneau` | `true` si l'arrivée estimée dépasse la fin du créneau Isadom. |
| `etapes[].adresse.lat/lon` | Coordonnées WGS84 utilisées pour le calcul (navigation GPS). |

## 4. Message

Deux types, un seul format :
- `flash` : information **immédiate**. MJ2 notifie l'AMD dès réception.
- `debut_tournee` : conseil ou rappel affiché **avant la tournée**, à la première ouverture de la journée, pendant toute sa période de validité.

```json
{
  "version_contrat": "1.0",
  "id": "5f0c1d2e-8a4b-4c7d-9e21-3b6a0f9d1c44",
  "type": "debut_tournee",
  "cible": { "type": "antenne", "codes": ["aub", "sis"] },
  "valide_du": "2026-10-16",
  "valide_au": "2026-10-20",
  "priorite": "normale",
  "titre": "Rappel O2",
  "texte": "Vérifiez le niveau des cuves avant le départ.",
  "commentaire": "",
  "auteur": "Responsable",
  "cree_le": "2026-10-15T17:50:00+02:00"
}
```

| Champ | Règle |
|---|---|
| `id` | UUID généré par Optiservices. Un renvoi avec le même `id` remplace le message. |
| `cible.type` | `tous` (`codes` vide), `antenne` (codes d'antenne) ou `amd` (codes AMD). |
| `valide_du` / `valide_au` | Bornes incluses. Un `flash` vaut en général pour le jour même. |
| `priorite` | `normale` ou `haute` (mise en avant dans MJ2). |
| `titre` | Facultatif, 80 caractères au plus. |
| `texte` | Obligatoire, 2 000 caractères au plus, texte brut (pas de HTML). |

## 5. Accusé de lecture

Réponse de `GET /api/v1/accuses?depuis=…` : les lectures enregistrées après l'horodatage donné.

```json
[
  { "id_message": "5f0c1d2e-8a4b-4c7d-9e21-3b6a0f9d1c44", "amd_code": "AMD001", "lu_le": "2026-10-16T07:52:10+02:00" }
]
```

## 6. Côté Optiservices

- Le navigateur de la Responsable appelle `/mj2/api/v1/…` sur le site Optiservices. nginx relaie vers MJ2 (`MJ2_URL`) en ajoutant l'en-tête `X-Api-Key` (`MJ2_CLE`), tous deux lus dans le `.env` du serveur.
- Construction et contrôle des JSON : `web/js/mj2/mj2-core.js`, testé dans `tests/mj2.test.mjs`.
