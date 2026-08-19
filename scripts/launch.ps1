[CmdletBinding()]
param(
    [switch]$NoInstall,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Usage: .\scripts\launch.ps1 [-NoInstall]"
    Write-Host "Launch the Figure Detection API, worker, and web UI on Windows."
    exit 0
}

if (-not $IsWindows) {
    throw "This launcher supports Windows. On Linux or macOS, use ./scripts/launch.sh."
}

$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

foreach ($Command in @("uv", "node", "npm", "ffmpeg", "ffprobe")) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Command"
    }
}

$ConfiguredHost = if ($env:FIGURE_DETECTION_HOST) { $env:FIGURE_DETECTION_HOST } else { "127.0.0.1" }
$ConfiguredPort = if ($env:FIGURE_DETECTION_PORT) { $env:FIGURE_DETECTION_PORT } else { "8000" }
if ($ConfiguredHost -ne "127.0.0.1" -or $ConfiguredPort -ne "8000") {
    throw "The launcher requires FIGURE_DETECTION_HOST=127.0.0.1 and FIGURE_DETECTION_PORT=8000 because the browser client uses that local API address."
}

Write-Host "Detected Windows."
if (-not $NoInstall) {
    Write-Host "Synchronizing Python dependencies..."
    $env:SAM2_BUILD_CUDA = "0"
    & uv sync --extra dev --extra vision
    if ($LASTEXITCODE -ne 0) { throw "uv sync failed with status $LASTEXITCODE" }

    Write-Host "Installing frontend dependencies..."
    & npm --prefix web install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with status $LASTEXITCODE" }
}

$Processes = @()
try {
    Write-Host "Starting API, worker, and web UI..."
    $Processes += Start-Process uv -ArgumentList "run", "figure-detection-api" -NoNewWindow -PassThru
    $Processes += Start-Process uv -ArgumentList "run", "figure-detection-worker" -NoNewWindow -PassThru
    $Processes += Start-Process npm.cmd -ArgumentList "--prefix", "web", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort" -NoNewWindow -PassThru

    Write-Host "Figure Detection: http://127.0.0.1:5173"
    Write-Host "API documentation: http://127.0.0.1:8000/docs"
    Write-Host "Press Ctrl+C to stop all services."

    while (($Processes | Where-Object { -not $_.HasExited }).Count -eq $Processes.Count) {
        Start-Sleep -Milliseconds 500
    }
    $Stopped = $Processes | Where-Object { $_.HasExited } | Select-Object -First 1
    if ($Stopped.ExitCode -ne 0) {
        throw "A service exited with status $($Stopped.ExitCode)."
    }
}
finally {
    foreach ($Process in $Processes) {
        if (-not $Process.HasExited) {
            & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
        }
    }
}
