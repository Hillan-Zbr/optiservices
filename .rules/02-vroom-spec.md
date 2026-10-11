# Spécifications & Modélisation VROOM (VRP)
- Moteur : VROOM (vroom-project/vroom).
- Entrée (`/solve`) : Respecter la syntaxe VROOM (`jobs`, `shipments`, `vehicles`). Coordonnées `[lon, lat]`. Gérer `capacity`, `delivery`/`pickup`, et `time_windows` (secondes Unix).
- Sortie : Extraire `summary` (distance/durée totales, `unassigned`), convertir `routes` en GeoJSON pour Leaflet, et traiter explicitement `unassigned`.
