# Run from repository root: powershell.exe -File .\scripts\generate-local-cert.ps1
# Generates a self-signed LOCAL DEVELOPMENT cert. Browser warning is expected.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$certDir = Join-Path $repo 'deploy\certs'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
if ((Test-Path (Join-Path $certDir 'fullchain.pem')) -or (Test-Path (Join-Path $certDir 'privkey.pem'))) {
  throw 'Cert files already exist. Refusing to overwrite. Back up/remove BOTH files before regeneration.'
}
# Use OpenSSL inside an ephemeral Alpine container, so Windows need not install it.
$script = 'apk add --no-cache openssl >/dev/null && openssl req -x509 -nodes -newkey rsa:2048 -days 7 -keyout /certs/privkey.pem -out /certs/fullchain.pem -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1'
& docker run --rm -v "${certDir}:/certs" alpine:3.21 sh -c $script
if ($LASTEXITCODE -ne 0) { throw 'Could not generate local certificate. Is Docker Desktop running?' }
Write-Host 'Generated SELF-SIGNED cert for https://localhost:8443 (local tests only).' -ForegroundColor Green
Write-Host 'For a public domain, replace with a valid CA certificate and private key.' -ForegroundColor Yellow
