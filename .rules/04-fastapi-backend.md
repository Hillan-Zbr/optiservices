# Règle Back-end FastAPI (Python)
- Validation : Modèles Pydantic pour valider les payloads géographiques et VROOM.
- Asynchronisme : `async/await` pour les appels VROOM/OSRM et endpoints.
- Architecture : Routes séparées dans des modules (ex: `routers/vrp.py`, `routers/clients.py`).
- Erreurs : Capturer les erreurs réseau/VROOM pour renvoyer des réponses HTTP explicites.
