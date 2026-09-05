# Thin user installer: download the matching OpenSider binary from GitHub
# releases/latest, verify SHA-256, then run `opensider install`.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-InstallError {
    param([string]$Message)
    [Console]::Error.WriteLine("opensider install: $Message")
}

function Enable-Tls12 {
    try {
        $tls = [Net.SecurityProtocolType]::Tls12
        if ([enum]::GetNames([Net.SecurityProtocolType]) -contains "Tls13") {
            $tls = $tls -bor [Net.SecurityProtocolType]::Tls13
        }
        [Net.ServicePointManager]::SecurityProtocol = $tls
    } catch {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    }

    # Make later Windows PowerShell 5.1 sessions default to TLS 1.2 (no admin).
    foreach ($key in @(
            "HKCU:\SOFTWARE\Microsoft\.NETFramework\v4.0.30319",
            "HKCU:\SOFTWARE\Wow6432Node\Microsoft\.NETFramework\v4.0.30319"
        )) {
        try {
            if (-not (Test-Path $key)) {
                New-Item -Path $key -Force | Out-Null
            }
            New-ItemProperty -Path $key -Name SchUseStrongCrypto -Value 1 -PropertyType DWord -Force | Out-Null
        } catch {
            # roaming / locked profile
        }
    }
}

function Get-ReleaseFile {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & curl.exe -fsSL $Url -o $OutFile
        if ($LASTEXITCODE -ne 0) {
            throw "curl.exe exited $LASTEXITCODE"
        }
        return
    }
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

Enable-Tls12

$RepoDownload = "https://github.com/parksben/opensider/releases/latest/download"

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
        Get-ReleaseFile -Url "$RepoDownload/SHA256SUMS" -OutFile $sumsPath
    } catch {
        Write-InstallError "failed to download SHA256SUMS"
        throw
    }
    try {
        Get-ReleaseFile -Url "$RepoDownload/$name" -OutFile $binPath
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
