# Optiservices — déploiement du banc de test sur le VPS Debian

> Document destiné à Claude Code, exécuté sur le VPS. Objectif : mettre en ligne
> le banc de test dans `/srv/optiservices` pour que Franck puisse le tester depuis son poste.
> Le nom du projet est **Optiservices** (pas « Opriservices », faute présente dans le nom des archives).

## 0. Règles de conduite

- Réponds et commente en **français**.
- Annonce chaque étape avant de l'exécuter, puis affiche le résultat du contrôle associé.
- **Demande confirmation avant** toute action destructrice (`rm -rf`, écrasement de `/srv/optiservices`, `docker system prune`, modification du pare-feu).
- **Ne publie aucun port sur Internet.** Tout est lié à `127.0.0.1` ; l'accès de test se fait par tunnel SSH (étape 7).
- Ne stocke aucun mot de passe ni clé dans les fichiers du projet.
- Les tests se font avec des **données fictives** : le CSV réel des RDV contient des noms de patients (données de santé, RGPD). Ne pas l'envoyer sur ce VPS.
- Si une étape échoue, diagnostique (logs, `docker compose logs`) et propose un correctif avant de continuer. Ne contourne pas un contrôle.

## 1. Architecture cible

Répertoire : `/srv/optiservices`

| Service | Image / version | Rôle | Port interne |
|---|---|---|---|
| `osrm` | osrm-backend **v5.27.1** | Routage, carte PACA + Corse fusionnée → `/data/paca-corse.osrm` | 5000 |
| `vroom` | vroom-docker **v1.14.0** | Optimisation de tournées, `config.yml` avec host `osrm` | 3000 |
| `web` | nginx **1.27-alpine** | Sert `./web` (JS vanilla + Leaflet local) et proxifie `/vroom/`, `/osrm/`, `/geocode/` | 8080 |

- `/geocode/` est proxifié vers `https://data.geopf.fr/geocodage` (BAN / IGN). Le VPS doit donc pouvoir sortir en HTTPS vers ce domaine.
- L'application est statique : le stockage est le `localStorage` du navigateur (export/import JSON de la configuration).

## 2. Prérequis à vérifier

```bash
cat /etc/os-release | head -3
docker --version && docker compose version
free -h            # RAM disponible
df -h /srv         # espace disque
nproc
```

Contrôles :
- Docker et le plugin Compose sont installés. Sinon, propose l'installation depuis le dépôt officiel Docker pour Debian et attends la confirmation de Franck.
- Espace disque : prévoir au moins **10 Go** libres (carte PBF + fichiers `.osrm`).
- RAM : le prétraitement OSRM (étape 4) est gourmand. Si moins de 4 Go de RAM, ajoute du swap temporaire ou prévois que le prétraitement soit fait ailleurs.

## 3. Récupération du projet

Les archives sont `opriservices-web.tar.gz` (à privilégier : conserve les permissions Linux) et `opriservices-web.zip` (sauvegarde Windows, à ne pas utiliser si le `.tar.gz` est présent). Cherche-les dans `/tmp` ou le répertoire personnel.

```bash
ls -la /tmp/opriservices-web.* ~/opriservices-web.* 2>/dev/null

# Contrôle du contenu AVANT extraction
tar tzf /tmp/opriservices-web.tar.gz | head -40
```

Contrôles :
- Repère s'il y a un dossier racine unique. Si oui, extrais avec `--strip-components=1`.
- Si `/srv/optiservices` existe déjà et n'est pas vide : sauvegarde-le d'abord.

```bash
[ -d /srv/optiservices ] && sudo tar czf /srv/optiservices-backup-$(date +%Y%m%d-%H%M).tar.gz -C /srv/optiservices .
sudo mkdir -p /srv/optiservices
sudo tar xzf /tmp/opriservices-web.tar.gz -C /srv/optiservices   # + --strip-components=1 si nécessaire
sudo chown -R "$USER":"$USER" /srv/optiservices
cd /srv/optiservices && ls -la
```

Structure attendue (adapte si elle diffère, sans rien casser) :

```
/srv/optiservices/
├── docker-compose.yml
├── data/            # carte OSRM (peut être absente à ce stade)
├── vroom-conf/      # config.yml (host: osrm)
├── nginx/           # config nginx (ou default.conf)
└── web/             # index.html, JS, CSS, Leaflet local
```

Si `docker-compose.yml` est absent, ne l'invente pas : signale-le à Franck et propose un squelette à valider, d'après le tableau de la section 1.

## 4. Données OSRM (carte PACA + Corse)

Vérifie d'abord si la carte est déjà présente :

```bash
ls -lh /srv/optiservices/data/ 2>/dev/null
```

Si `paca-corse.osrm*` existe (copié depuis SRVDEB-DOCKER-LAN) : passe à l'étape 5.

Sinon, deux options, **à faire valider par Franck** :
- **A (recommandé, rapide)** : copier le dossier `data/` depuis SRVDEB-DOCKER-LAN (`rsync -avP`), depuis le poste de Franck ou le serveur source.
- **B** : régénérer sur le VPS (long, gourmand en RAM) :

```bash
cd /srv/optiservices/data
curl -LO https://download.geofabrik.de/europe/france/provence-alpes-cote-d-azur-latest.osm.pbf
curl -LO https://download.geofabrik.de/europe/france/corse-latest.osm.pbf

# Fusion (osmium-tool : sudo apt install osmium-tool)
osmium merge provence-alpes-cote-d-azur-latest.osm.pbf corse-latest.osm.pbf -o paca-corse.osm.pbf

# Prétraitement OSRM v5.27.1 (MLD), profil voiture
docker run --rm -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/car.lua /data/paca-corse.osm.pbf
docker run --rm -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-partition /data/paca-corse.osrm
docker run --rm -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-customize /data/paca-corse.osrm
```

Contrôle : les fichiers `paca-corse.osrm.*` (notamment `.mldgr`, `.cell_metrics`) sont présents.

## 5. Exposition limitée à localhost

Avant de démarrer, vérifie dans `docker-compose.yml` que **aucun port n'est publié sur `0.0.0.0`**. Crée `docker-compose.override.yml` si besoin :

```yaml
services:
  osrm:
    ports: !reset []
  vroom:
    ports: !reset []
  web:
    ports:
      - "127.0.0.1:8080:80"
```

Adapte le port interne de `web` à celui réellement écouté par la config nginx (80 dans l'image par défaut).

Contrôle après démarrage :

```bash
docker compose config | grep -A3 ports
sudo ss -tlnp | grep -E '8080|5000|3000'   # tout doit être sur 127.0.0.1 uniquement
```

## 6. Démarrage et vérifications

```bash
cd /srv/optiservices
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=50
```

Tests (tous depuis le VPS) :

```bash
# 1. nginx sert la page
curl -sI http://127.0.0.1:8080/ | head -1                      # attendu : HTTP/1.1 200

# 2. OSRM répond (Aubagne -> Sisteron)
curl -s "http://127.0.0.1:8080/osrm/route/v1/driving/5.5703,43.2927;5.9438,44.0937?overview=false" | head -c 300
# attendu : "code":"Ok"

# 3. VROOM répond
curl -s http://127.0.0.1:8080/vroom/health
# attendu : réponse 200 / {"status":"ok"} selon la version

# 4. Géocodage BAN via proxy
curl -s "http://127.0.0.1:8080/geocode/search?q=place+de+la+mairie+aubagne&limit=1" | head -c 300
# attendu : GeoJSON avec une feature
```

Test VROOM minimal (1 véhicule, 2 jobs) à lancer en direct sur `/vroom/` :

```bash
curl -s -X POST http://127.0.0.1:8080/vroom/ -H 'Content-Type: application/json' -d '{
  "vehicles":[{"id":1,"start":[5.5703,43.2927],"end":[5.5703,43.2927]}],
  "jobs":[{"id":1,"location":[5.4474,43.2965]},{"id":2,"location":[5.3698,43.2965]}]
}' | head -c 600
# attendu : "code":0 et une route avec 2 étapes job
```

Cas d'erreur courants à diagnostiquer :
- VROOM `"Route: ... Error"` ou timeout → l'hôte `osrm` n'est pas résolu : vérifier `vroom-conf/config.yml` (host `osrm`) et le réseau Docker.
- OSRM `NoSegment` → point trop loin d'une route, ou hors de l'emprise PACA + Corse.
- OSRM crash au démarrage → fichiers `.osrm` incomplets ou RAM insuffisante.
- `/geocode/` en 502 → sortie HTTPS vers `data.geopf.fr` bloquée depuis le VPS.

## 7. Accès pour Franck (tunnel SSH, rien d'exposé)

À lancer depuis le **poste Windows** de Franck (PowerShell), pas sur le VPS :

```powershell
ssh -L 8080:127.0.0.1:8080 utilisateur@IP_DU_VPS
```

Puis ouvrir `http://localhost:8080` dans le navigateur, tant que la session SSH reste ouverte.

Scénario de test à suivre :
1. Écran **Paramètres** : vérifier le lien « Test trajet » (Aubagne → Sisteron).
2. Écran **Planification** : importer un CSV **fictif** (`date;patient;code_postal;ville;adresse;intervention;demi_journee;amd_actuel`, UTF-8, séparateur `;`).
3. Écran **Résultat** : vérifier les tournées sur la carte, les RDV non affectés et la comparaison « actuel ».

Rappel : phase de test = départs **siège Aubagne (13)** et **antenne Sisteron (04)** uniquement ; colonne `pni` ignorée ; créneau mi-journée par défaut 11h–14h (à confirmer).

## 8. Compte rendu attendu

À la fin, produis un récapitulatif court :
- état de chaque service (`docker compose ps`) ;
- résultat des 4 tests + test VROOM ;
- écarts constatés par rapport à la structure attendue ;
- ce qui reste à décider : accès public (domaine + HTTPS + mot de passe, ex. Caddy) ou VPN (WireGuard), et validation RGPD/HDS avec la DPO avant d'y mettre des données patients réelles.
