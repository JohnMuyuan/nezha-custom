param(
    [string]$Image = "ghcr.io/johnmuyuan/nezha-custom",
    [string]$Tag = "latest",
    [string]$Platforms = "linux/amd64",
    [string]$Version = "custom",
    [string]$IpInfoToken = "",
    [switch]$WithCommunityThemes,
    [switch]$Push,
    [string]$ExportTar = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or not in PATH. Please install Docker Desktop (or run inside WSL with Docker)."
}

$RootDir = Split-Path -Parent $PSScriptRoot
$fullTag = "${Image}:${Tag}"
$communityFlag = if ($WithCommunityThemes) { "true" } else { "false" }

$argsList = @(
    "buildx", "build",
    "--platform", $Platforms,
    "--build-arg", "VERSION=$Version",
    "--build-arg", "WITH_COMMUNITY_THEMES=$communityFlag",
    "-t", $fullTag
)

if ($IpInfoToken) {
    $argsList += @("--build-arg", "IPINFO_TOKEN=$IpInfoToken")
}

if ($Push) {
    $argsList += "--push"
} elseif ($ExportTar) {
    $argsList += @("--output", "type=docker,dest=$ExportTar")
} else {
    $argsList += "--load"
}

$argsList += $RootDir

Write-Host "==> Running: docker $($argsList -join ' ')" -ForegroundColor Cyan
& docker @argsList
if ($LASTEXITCODE -ne 0) {
    throw "Docker build failed."
}

Write-Host "==> Done: $fullTag" -ForegroundColor Green
