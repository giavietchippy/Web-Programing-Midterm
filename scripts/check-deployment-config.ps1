# Checks root .env without printing secrets. Run from repository root.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$f = Join-Path $repo '.env'
if (!(Test-Path $f)) { throw 'Missing .env in repository root. Copy .env.example and edit it.' }
$vars = @{}
foreach ($line in Get-Content $f) {
  if ($line -match '^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$') { $vars[$matches[1]] = $matches[2].Trim() }
}
foreach($key in @('JWT_SECRET','INTERNAL_API_KEY','TURN_SECRET','ADMIN_PASSWORD','TURN_HOST','TURN_EXTERNAL_IP')) {
  if (!$vars.ContainsKey($key) -or !$vars[$key] -or $vars[$key] -match 'REPLACE_WITH') { throw "$key must be configured in root .env" }
}
if ($vars['JWT_SECRET'].Length -lt 24 -or $vars['INTERNAL_API_KEY'].Length -lt 24 -or $vars['TURN_SECRET'].Length -lt 24) { throw 'Secrets must each be at least 24 characters.' }
if (($vars['JWT_SECRET'] -eq $vars['TURN_SECRET']) -or ($vars['JWT_SECRET'] -eq $vars['INTERNAL_API_KEY']) -or ($vars['TURN_SECRET'] -eq $vars['INTERNAL_API_KEY'])) { throw 'All 3 secrets must be DIFFERENT.' }
if (!(Test-Path (Join-Path $repo 'deploy\certs\fullchain.pem')) -or !(Test-Path (Join-Path $repo 'deploy\certs\privkey.pem'))) { throw 'HTTPS certs missing. Run scripts/generate-local-cert.ps1.' }
Write-Host 'Config looks valid; TURN_SECRET will be shared by Platform and coturn through Docker Compose.' -ForegroundColor Green
Write-Host 'This does NOT prove TURN relay works externally; test ICE candidate relay next.' -ForegroundColor Yellow
