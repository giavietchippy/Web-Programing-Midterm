# Generate a root .env with strong secrets. Run once from repository root.
param(
  [string]$AdminPassword
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dest = Join-Path $repo '.env'
if (Test-Path $dest) { throw 'Root .env already exists; refusing to overwrite secrets.' }
function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
$envAdminPassword = New-Secret
if (-not [string]::IsNullOrEmpty($AdminPassword)) {
  $passwordBytes = [System.Text.Encoding]::UTF8.GetByteCount($AdminPassword)
  if ($passwordBytes -lt 8 -or $passwordBytes -gt 72 -or
      $AdminPassword.Contains("'") -or $AdminPassword.Contains("`r") -or $AdminPassword.Contains("`n")) {
    throw 'AdminPassword must be 8-72 UTF-8 bytes and cannot include quotes or line breaks.'
  }
  $envAdminPassword = "'" + $AdminPassword + "'"
}
$txt = [System.IO.File]::ReadAllText((Join-Path $repo '.env.example'))
$txt = $txt.Replace('REPLACE_WITH_NEW_RANDOM_JWT_SECRET_AT_LEAST_24_CHARS',(New-Secret))
$txt = $txt.Replace('REPLACE_WITH_NEW_RANDOM_INTERNAL_KEY_AT_LEAST_24_CHARS',(New-Secret))
$txt = $txt.Replace('REPLACE_WITH_NEW_RANDOM_TURN_SECRET_AT_LEAST_24_CHARS',(New-Secret))
$txt = $txt.Replace('REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD',$envAdminPassword)
[System.IO.File]::WriteAllText($dest,$txt)
Write-Host "Created $dest with random secrets (not printed)." -ForegroundColor Green
Write-Host 'NEXT: edit TURN_HOST and TURN_EXTERNAL_IP in root .env to YOUR reachable Windows/VPS IPv4 address.' -ForegroundColor Yellow
Write-Host 'Run ipconfig in PowerShell to find Windows LAN IPv4. Keep .env private.' -ForegroundColor Yellow
