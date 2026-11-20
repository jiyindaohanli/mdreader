# A signing identity for this machine when no CA certificate exists yet.
#
# It creates a self-signed code signing certificate (CN=fivenull (MDReader)),
# keeps the private key in certs\mdreader-local.pfx (git-ignored), and can:
#   -Trust    add the certificate to this Windows user's Root and
#             TrustedPublisher stores, so the signature verifies as Valid here
#   -Untrust  remove those two trust anchors again
#   -Sign     build with the certificate (MDR_SIGN_CERT + password for mygo)
#   -Clean    delete the trust anchors, the certificate and its files
#
# Windows on another machine does not trust this certificate: a downloaded
# installer still gets the SmartScreen warning. See SIGNING.md.
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-signing.ps1 -Trust -Sign
#   ... -Signtool "C:\path\to\signtool.exe"    when it is not on PATH

param([switch]$Trust, [switch]$Untrust, [switch]$Clean, [switch]$Sign, [string]$Signtool)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 on some machines starts with PowerShell 7's modules on
# PSModulePath, which breaks the Certificate provider: no Cert: drive, and
# New-SelfSignedCertificate fails. Point it at its own modules first.
if (-not (Get-PSDrive -PSProvider Certificate -ErrorAction SilentlyContinue)) {
  $env:PSModulePath = "$PSHOME\Modules"
  Import-Module Microsoft.PowerShell.Security -Force -ErrorAction Stop
}
if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
  Import-Module PKI -Force -ErrorAction Stop
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

$certDir = Join-Path $root "certs"
$pfx = Join-Path $certDir "mdreader-local.pfx"
$passwordFile = "$pfx.password"
$cer = Join-Path $certDir "mdreader-local.cer"
$subject = "CN=fivenull (MDReader)"
$stores = @("Cert:\CurrentUser\Root", "Cert:\CurrentUser\TrustedPublisher")

function Get-LocalCert {
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $subject } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
}

function Remove-FromStore {
  param([string]$store)
  Get-ChildItem $store -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $subject } |
    ForEach-Object { Remove-Item -Path "$store\$($_.Thumbprint)" -Force }
}

function New-LocalCert {
  New-Item -ItemType Directory -Force $certDir | Out-Null
  $old = Get-LocalCert
  if ($old) { Remove-Item -Path "Cert:\CurrentUser\My\$($old.Thumbprint)" -Force }
  # Anchors of an older certificate would otherwise stay behind.
  foreach ($store in $stores) { Remove-FromStore $store }
  $cert = New-SelfSignedCertificate `
    -Subject $subject `
    -Type CodeSigningCert `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation "Cert:\CurrentUser\My"
  $password = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")).Substring(0, 32)
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Set-Content -Path $passwordFile -Value $password -NoNewline
  return $cert
}

function Add-Trust {
  $cert = Get-LocalCert
  if (-not $cert) { throw "no local certificate: run this script without -Trust first" }
  if (-not (Test-Path $cer)) { Export-Certificate -Cert $cert -FilePath $cer | Out-Null }
  foreach ($store in $stores) {
    $there = Get-ChildItem $store -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if (-not $there) { Import-Certificate -FilePath $cer -CertStoreLocation $store | Out-Null }
  }
  Write-Host "Trusted for this Windows user: Root + TrustedPublisher" -ForegroundColor Green
  Write-Host "  (only this user on this machine; another machine still sees no trusted signer)"
}

function Find-Signtool {
  param([string]$hint)
  if ($hint) {
    if (Test-Path $hint) { return (Resolve-Path $hint).Path }
    throw "signtool not found at $hint"
  }
  $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  # A single signtool.exe from the SDK BuildTools works on its own: drop one
  # here on a machine that has no Windows SDK.
  $local = Join-Path $env:LOCALAPPDATA "MDReader\signtool.exe"
  if (Test-Path $local) { return $local }
  $kits = "C:\Program Files (x86)\Windows Kits\10\bin"
  if (Test-Path $kits) {
    $found = Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\" } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

function Add-SigntoolToPath {
  $tool = Find-Signtool $Signtool
  if (-not $tool) { return $null }
  $dir = Split-Path -Parent $tool
  if (($env:PATH -split ";") -notcontains $dir) { $env:PATH = "$dir;$env:PATH" }
  return $tool
}

try {
  if ($Clean) {
    foreach ($store in $stores) { Remove-FromStore $store }
    $cert = Get-LocalCert
    if ($cert) { Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force }
    foreach ($file in @($pfx, $passwordFile, $cer)) {
      if (Test-Path $file) { Remove-Item $file -Force }
    }
    if ((Test-Path $certDir) -and -not (Get-ChildItem $certDir)) { Remove-Item $certDir -Force }
    Write-Host "Removed the local certificate, its trust anchors and certs\mdreader-local.*" -ForegroundColor Green
    exit 0
  }

  if ($Untrust) {
    foreach ($store in $stores) { Remove-FromStore $store }
    Write-Host "Untrusted for this Windows user; the certificate and pfx remain" -ForegroundColor Green
    exit 0
  }

  $cert = Get-LocalCert
  if (-not $cert -or -not (Test-Path $pfx) -or -not (Test-Path $passwordFile)) {
    $cert = New-LocalCert
    Write-Host "Created a local signing certificate: $subject" -ForegroundColor Green
    Write-Host "  pfx      $pfx"
    Write-Host "  password $passwordFile"
    Write-Host "  cer      $cer"
  } else {
    Write-Host "Local signing certificate: $subject ($($cert.Thumbprint))" -ForegroundColor Green
  }

  if ($Trust) { Add-Trust }
  else {
    $trusted = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
      Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if ($trusted) {
      Write-Host "Trusted for this Windows user: Root + TrustedPublisher" -ForegroundColor Green
    } else {
      Write-Host "Not trusted on this user yet: pass -Trust to add the Root + TrustedPublisher anchors." -ForegroundColor Yellow
    }
  }

  if (-not $Sign) {
    Write-Host @"

Sign a build without editing mygo.config.ts (it reads MDR_SIGN_CERT):
  `$env:MDR_SIGN_CERT = "$pfx"
  `$env:MYGO_WINDOWS_CERTIFICATE_PASSWORD = (Get-Content "$passwordFile" -Raw).Trim()
  npx mygo build

Or all of it, trust included:
  powershell -ExecutionPolicy Bypass -File scripts/setup-signing.ps1 -Trust -Sign

Undo:
  ... -Untrust     remove the trust anchors
  ... -Clean       remove anchors, certificate and files

"@ -ForegroundColor Cyan
    exit 0
  }

  $tool = Add-SigntoolToPath
  if (-not $tool) {
    throw "signtool.exe not found: install the Windows SDK signing tools (SIGNING.md section 2), pass -Signtool, or put signtool.exe in $env:LOCALAPPDATA\MDReader"
  }
  Write-Host "signtool: $tool"

  $env:MDR_SIGN_CERT = $pfx
  $env:MYGO_WINDOWS_CERTIFICATE_PASSWORD = (Get-Content $passwordFile -Raw).Trim()

  Write-Host "`nBuilding with $pfx" -ForegroundColor Cyan
  npx mygo build
  if ($LASTEXITCODE -ne 0) { throw "mygo build failed with exit code $LASTEXITCODE" }

  Write-Host "`nSignatures:" -ForegroundColor Cyan
  Get-ChildItem "build\windows-amd64\MDReader.exe", "build\windows-amd64\mdreader-setup-*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $check = Get-AuthenticodeSignature $_.FullName
      $signer = if ($check.SignerCertificate) { $check.SignerCertificate.Subject } else { "none" }
      Write-Host ("  {0}: {1} - {2}" -f $_.Name, $check.Status, $signer)
    }
  if (-not $Trust) {
    Write-Host "`nStatus stays untrusted until you run this script with -Trust." -ForegroundColor Yellow
  }
} finally {
  Pop-Location
}
