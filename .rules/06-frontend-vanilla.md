# Règles Front-end Vanilla JS (Modules ES)
- Modularité : Un fichier par responsabilité (`api.js`, `map.js`, `ui.js`).
- Exposition : `import`/`export` natifs sans bundler lourd.
- Évolution : Isoler la logique métier/carto du DOM pour pouvoir brancher Alpine.js ou Preact si l'UI se complexifie.
