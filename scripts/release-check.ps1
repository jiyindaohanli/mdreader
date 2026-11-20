# Runs everything a release needs that a machine can check, and says plainly
# what a person still has to do. The manual steps are in RELEASE.md.
#
#   powershell -ExecutionPolicy Bypass -File scripts/release-check.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/release-check.ps1 -Build
#
# Exits 1 when a blocking check fails (a missing changelog section, a red test).

param([switch]$Build)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

$failed = $false
$todo = 0

function Step($name) { Write-Host "`n== $name" -ForegroundColor Cyan }
function Ok($message) { Write-Host "  ok   $message" -ForegroundColor Green }
function Bad($message) { Write-Host "  FAIL $message" -ForegroundColor Red; $script:failed = $true }
function Todo($message) { Write-Host "  todo $message" -ForegroundColor Yellow; $script:todo++ }
function Info($message) { Write-Host "  info $message" -ForegroundColor DarkGray }

try {
  # 1. The version an installer is named after has release notes.
  Step "Version"
  $config = Get-Content mygo.config.ts -Raw
  $match = [regex]::Match($config, 'version:\s*"([^"]+)"')
  if (-not $match.Success) {
    Bad "mygo.config.ts has no version"
  } else {
    $version = $match.Groups[1].Value
    Ok "mygo.config.ts = $version"
    if (-not (Test-Path CHANGELOG.md)) {
      Bad "CHANGELOG.md is missing"
    } elseif (Select-String -Path CHANGELOG.md -Pattern "^## $([regex]::Escape($version))\b" -Quiet) {
      Ok "CHANGELOG.md has $version"
    } else {
      Bad "CHANGELOG.md has no '## $version' section"
    }
  }

  # 2. Typecheck, frontend regression, Go vet and Go regression.
  Step "Automated checks"
  npm run verify
  if ($LASTEXITCODE -ne 0) { Bad "npm run verify failed" } else { Ok "verify passed" }

  # 3. Signing is optional: it only changes the warning people see when they
  # download the installer. See RELEASE.md section 3.
  Step "Code signing"
  $signCert = $env:MDR_SIGN_CERT
  $literal = $config -match '(?m)^\s*(certificate|signCommand):(?!\s*process\.env)'
  if ($literal) {
    Ok "mygo.config.ts is configured to sign"
  } elseif ($signCert -and (Test-Path $signCert)) {
    Ok "MDR_SIGN_CERT = $signCert (local certificate, not trusted by other machines)"
  } elseif (Test-Path "certs\mdreader-local.pfx") {
    Info "unsigned build (accepted, RELEASE.md section 3); a local certificate can sign it: npm run sign:build"
  } else {
    Info "unsigned build (accepted, RELEASE.md section 3); a CA certificate removes the SmartScreen warning"
  }

  # 4. The icon is licensed for public distribution.
  Step "Icon licence"
  $icon = Get-Content resources/ICON-LICENSE.md -Raw
  if ($icon -match "STATUS:\s*UNCONFIRMED") {
    Todo "resources/icon.png is unlicensed for public release (resources/ICON-LICENSE.md)"
  } else {
    Ok "icon licence recorded"
  }

  # 5. The installers a release uploads.
  if ($Build) {
    Step "Build (portable exe)"
    npx mygo build -skip-installer
    if ($LASTEXITCODE -ne 0) { Bad "mygo build failed" }
    else {
      $exe = "build/windows-amd64/MDReader.exe"
      if (Test-Path $exe) { Ok $exe } else { Bad "$exe is missing" }
      $helpers = @(Get-ChildItem "build/windows-amd64/*.cmd" -ErrorAction SilentlyContinue)
      if ($helpers.Count -ge 2) { Ok "$($helpers.Count) shell .cmd helpers" }
      else { Bad "the register/unregister .cmd helpers are missing" }

      Step "Signature on the executable"
      $signtoolPath = $null
      $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
      if ($command) { $signtoolPath = $command.Source }
      else {
        $local = Join-Path $env:LOCALAPPDATA "MDReader\signtool.exe"
        if (Test-Path $local) { $signtoolPath = $local }
      }
      if (-not $signtoolPath) {
        Info "signtool.exe not found: signature not checked (unsigned is accepted, RELEASE.md section 3)"
      } elseif (Test-Path $exe) {
        # signtool prints "No signature found" to stderr; with ErrorActionPreference
        # at Stop that would abort the whole check.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $signtoolPath verify /pa /v $exe 2>&1 | Out-Null
        $signed = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $previous
        if ($signed) { Ok "$exe is signed" }
        else { Info "$exe is unsigned (SmartScreen will warn; accepted)" }
      }
    }
  } else {
    Step "Build"
    Todo "not run: pass -Build to produce and check MDReader.exe"
  }
} catch {
  Bad "release check stopped: $_"
} finally {
  Pop-Location
}

if ($failed) {
  Write-Host "`nBlocking failures: fix the FAIL lines above." -ForegroundColor Red
  exit 1
}
if ($todo -gt 0) {
  Write-Host "`nAutomated checks passed. $todo manual item(s) remain: see RELEASE.md." -ForegroundColor Yellow
} else {
  Write-Host "`nAll checks passed: ready to tag and upload (see RELEASE.md)." -ForegroundColor Green
}
