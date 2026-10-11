# Règles Cartographiques & Leaflet.js
- Style : Couleur distincte par véhicule, marqueurs numérotés (`L.divIcon` CSS custom), icône/couleur d'avertissement pour `unassigned`.
- Optimisation : `layerGroup.clearLayers()` avant de redessiner. Centrer avec `map.fitBounds(geojsonLayer.getBounds())`.
- Interactivité : Popups détaillés sur chaque marqueur et polyline (client, étape, heure d'arrivée, quantité).
