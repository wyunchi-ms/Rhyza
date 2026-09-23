param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9-]+$')][string]$Take,
    [ValidateRange(2, 300)][int]$Seconds = 30
)

$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$recordingDirectory = Join-Path $projectDirectory '.cache/recordings'
$null = New-Item -ItemType Directory -Path $recordingDirectory -Force
$recordingPath = Join-Path $recordingDirectory ($Take + '.mp4')
if (Test-Path -LiteralPath $recordingPath) {
    throw 'Take already exists. Choose a new take name; recordings are never overwritten.'
}
$windows = @(Get-Process | Where-Object { $_.MainWindowTitle -eq 'Rhyza' })
if ($windows.Count -ne 1) {
    throw 'Open exactly one Rhyza window before recording. Desktop-wide capture is not used.'
}

# Inspect the Rhyza window before running this. Do not show private chats or credentials.
$ffmpeg = Join-Path $projectDirectory 'node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe'
& $ffmpeg -hide_banner -loglevel warning -n -f gdigrab -framerate 30 -draw_mouse 1 -i 'title=Rhyza' -t $Seconds -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2' -movflags +faststart $recordingPath
if ($LASTEXITCODE -ne 0) {
    throw "Window capture failed with code $LASTEXITCODE."
}
Write-Output ('Recorded take: ' + $recordingPath)
