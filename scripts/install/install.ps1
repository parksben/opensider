# Thin user installer: download the matching OpenSider binary from GitHub
# releases/latest, verify SHA-256, then run `opensider install`.
# Built for stock Windows 10/11: Windows PowerShell 5.1, no curl.exe, no admin.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-InstallError {
    param([string]$Message)
    [Console]::Error.WriteLine("opensider install: $Message")
}

function Enable-Tls12 {
    # 3072 = Tls12, 12288 = Tls13. Numeric so older .NET without the enum still works.
    foreach ($flag in @(12288, 3072)) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor $flag
        } catch {
            # Tls13 is missing on older OS
        }
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

function Get-WindowsArch {
    if ($env:PROCESSOR_ARCHITEW6432) {
        return $env:PROCESSOR_ARCHITEW6432
    }
    return $env:PROCESSOR_ARCHITECTURE
}

function Get-ReleaseFile {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$OutFile
    )
    $wc = New-Object System.Net.WebClient
    try {
        $wc.Headers.Add("User-Agent", "opensider-install")
        $wc.DownloadFile($Url, $OutFile)
    } finally {
        $wc.Dispose()
    }
}

Enable-Tls12

$RepoDownload = "https://github.com/parksben/opensider/releases/latest/download"

$arch = Get-WindowsArch
switch ($arch) {
    "ARM64" { $name = "opensider-windows-arm64.exe" }
    "AMD64" { $name = "opensider-windows-amd64.exe" }
    default {
        Write-InstallError "unsupported architecture '$arch' (need 64-bit Windows: AMD64 or ARM64)"
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
        Write-InstallError "failed to download SHA256SUMS (check network access to github.com)"
        throw
    }
    try {
        Get-ReleaseFile -Url "$RepoDownload/$name" -OutFile $binPath
    } catch {
        Write-InstallError "failed to download $name (check network access to github.com)"
        throw
    }

    if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
        Unblock-File -LiteralPath $binPath -ErrorAction SilentlyContinue
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
