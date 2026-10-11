# Création de l'arborescence .rules/ et rangement des fichiers - projet Optiservices
$racine = "O:\07_Projets\optiservices"
$dossierRegles = Join-Path $racine ".rules"

$fichiersRegles = @(
    "01-architecture-general.md",
    "02-vroom-spec.md",
    "03-leaflet-gis.md",
    "04-fastapi-backend.md",
    "05-data-duckdb-sqlite.md",
    "06-frontend-vanilla.md"
)

# 1. Création du dossier .rules s'il n'existe pas
if (-not (Test-Path $dossierRegles)) {
    New-Item -ItemType Directory -Path $dossierRegles | Out-Null
    Write-Host "Dossier créé : $dossierRegles" -ForegroundColor Green
}

# 2. .cursorrules : le navigateur peut avoir supprimé le point initial
$cursorrules = Join-Path $racine ".cursorrules"
$sansPoint   = Join-Path $racine "cursorrules"
if (-not (Test-Path $cursorrules) -and (Test-Path $sansPoint)) {
    Rename-Item -Path $sansPoint -NewName ".cursorrules"
    Write-Host "Renommé : cursorrules -> .cursorrules" -ForegroundColor Yellow
}
if (Test-Path $cursorrules) {
    Write-Host "OK : .cursorrules présent à la racine" -ForegroundColor Green
} else {
    Write-Host "MANQUANT : .cursorrules" -ForegroundColor Red
}

# 3. Déplacement des 6 fichiers de règles dans .rules/
foreach ($f in $fichiersRegles) {
    $source = Join-Path $racine $f
    if (Test-Path $source) {
        Move-Item -Path $source -Destination $dossierRegles -Force
        Write-Host "Déplacé : $f" -ForegroundColor Green
    } elseif (Test-Path (Join-Path $dossierRegles $f)) {
        Write-Host "Déjà en place : $f" -ForegroundColor Cyan
    } else {
        Write-Host "MANQUANT : $f" -ForegroundColor Red
    }
}

# 4. Contrôle final
Write-Host "`nArborescence finale :" -ForegroundColor Cyan
Get-ChildItem -Path $racine -Force | Where-Object { $_.Name -in ".cursorrules", ".rules" }
Get-ChildItem -Path $dossierRegles | Select-Object Name, Length