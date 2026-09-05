# Thin user installer: download the matching OpenSider binary from GitHub
# releases/latest, verify SHA-256, then run `opensider install`.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
# Windows PowerShell 5.1 defaults to TLS 1.0; GitHub requires 1.2+.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoDownload = "https://github.com/parksben/opensider/releases/latest/download"

function Write-InstallError {
    param([string]$Message)
    [Console]::Error.WriteLine("opensider install: $Message")
}

$arch = $env:PROCESSOR_ARCHITECTURE
switch ($arch) {
    "ARM64" { $name = "opensider-windows-arm64.exe" }
    "AMD64" { $name = "opensider-windows-amd64.exe" }
    default {
        Write-InstallError "unsupported architecture '$arch' (need AMD64 or ARM64)"
        exit 1
    }
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("opensider-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null

try {
    $sumsPath = Join-Path $work "SHA256SUMS"
    $binPath = Join-Path $work $name

    try {
        Invoke-WebRequest -Uri "$RepoDownload/SHA256SUMS" -OutFile $sumsPath -UseBasicParsing
    } catch {
        Write-InstallError "failed to download SHA256SUMS"
        throw
    }
    try {
        Invoke-WebRequest -Uri "$RepoDownload/$name" -OutFile $binPath -UseBasicParsing
    } catch {
        Write-InstallError "failed to download $name"
        throw
    }

    $expected = $null
    foreach ($line in Get-Content -LiteralPath $sumsPath) {
        if ($line -match '^\s*([A-Fa-f0-9]{64})\s+\*?(\S+)\s*$' -and $Matches[2] -eq $name) {
            $expected = $Matches[1].ToLowerInvariant()
            break
        }
    }
    if (-not $expected) {
        Write-InstallError "$name is not listed in SHA256SUMS"
        exit 1
    }

    $actual = (Get-FileHash -LiteralPath $binPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Write-InstallError "SHA256 mismatch for $name (expected $expected, got $actual)"
        exit 1
    }

    Push-Location $work
    try {
        & ".\$name" install
        if ($LASTEXITCODE -ne 0) {
            Write-InstallError "opensider install exited $LASTEXITCODE"
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
