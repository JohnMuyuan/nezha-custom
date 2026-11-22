param(
    [string]$Version = "custom",
    [string[]]$Targets = @("linux/amd64", "linux/arm64", "windows/amd64"),
    [string]$ReleaseTag = "",
    [switch]$Publish
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $RootDir "agent"
$OutDir = Join-Path $RootDir "dist\agent"

if (Test-Path $OutDir) {
    Remove-Item -Recurse -Force $OutDir
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $AgentDir
try {
    foreach ($target in $Targets) {
        $parts = $target.Split("/")
        $goos = $parts[0]
        $goarch = $parts[1]
        $ext = if ($goos -eq "windows") { ".exe" } else { "" }
        $binName = "nezha-agent$ext"
        $tmpDir = Join-Path $OutDir "tmp_${goos}_${goarch}"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        $binPath = Join-Path $tmpDir $binName
        $zipPath = Join-Path $OutDir "nezha-agent_${goos}_${goarch}.zip"

        Write-Host "==> Building agent for $goos/$goarch (version: $Version)..." -ForegroundColor Cyan
        $env:CGO_ENABLED = "0"
        $env:GOOS = $goos
        $env:GOARCH = $goarch
        & go build -trimpath -ldflags "-s -w -X github.com/nezhahq/agent/pkg/monitor.Version=$Version -X main.arch=$goarch" -o $binPath ./cmd/agent
        if ($LASTEXITCODE -ne 0) {
            throw "go build failed for $goos/$goarch"
        }

        Compress-Archive -Path $binPath -DestinationPath $zipPath -Force
        Remove-Item -Recurse -Force $tmpDir
        Write-Host "    Created $zipPath" -ForegroundColor Green
    }
} finally {
    Pop-Location
}

$zips = Get-ChildItem -Path $OutDir -Filter "*.zip"
$checksumLines = foreach ($z in $zips) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $z.FullName).Hash.ToLower()
    "$hash  $($z.Name)"
}
$checksumPath = Join-Path $OutDir "agent-checksums.txt"
[System.IO.File]::WriteAllLines($checksumPath, $checksumLines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "==> Checksums written to $checksumPath" -ForegroundColor Green

if ($Publish) {
    if (-not $ReleaseTag) {
        throw "Please specify -ReleaseTag (e.g. -ReleaseTag agent-v2.4.0-custom.1) when using -Publish."
    }
    $files = @($zips.FullName) + @($checksumPath)
    Write-Host "==> Publishing release $ReleaseTag to GitHub..." -ForegroundColor Cyan
    & gh release create $ReleaseTag @files --title $ReleaseTag --generate-notes
    if ($LASTEXITCODE -ne 0) {
        throw "gh release create failed"
    }
}
