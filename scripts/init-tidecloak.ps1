$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"

if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Missing .env. Copy .env.example to .env and set KC_BOOTSTRAP_ADMIN_PASSWORD."
}

Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

if ([string]::IsNullOrWhiteSpace($env:KC_BOOTSTRAP_ADMIN_PASSWORD)) {
    throw "KC_BOOTSTRAP_ADMIN_PASSWORD must be set in .env and has no default."
}

docker info | Out-Null
if (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch 'tidecloak') {
    throw "A container named tidecloak already exists. Inspect it before deciding whether to reuse or remove it."
}

$dataDirectory = Join-Path $projectRoot "data"
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$resolvedDataDirectory = (Resolve-Path -LiteralPath $dataDirectory).Path

docker run -d --name tidecloak `
    -v "${resolvedDataDirectory}:/opt/keycloak/data/h2" `
    -p 8080:8080 `
    -e "KC_BOOTSTRAP_ADMIN_USERNAME=$($env:KC_BOOTSTRAP_ADMIN_USERNAME)" `
    -e "KC_BOOTSTRAP_ADMIN_PASSWORD=$($env:KC_BOOTSTRAP_ADMIN_PASSWORD)" `
    tideorg/tidecloak-dev:latest

Write-Host "TideCloak is starting at http://localhost:8080. Wait until it is healthy before importing the realm."
