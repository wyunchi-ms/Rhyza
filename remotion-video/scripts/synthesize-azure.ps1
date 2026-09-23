param(
    [Parameter(Mandatory = $true)][string]$ResourceGroupName,
    [Parameter(Mandatory = $true)][string]$AccountName,
    [string]$Only = ''
)

$ErrorActionPreference = 'Stop'
if (-not (Get-AzContext)) {
    throw 'Sign in with Connect-AzAccount before running this script.'
}

$speechAccount = Get-AzCognitiveServicesAccount -ResourceGroupName $ResourceGroupName -Name $AccountName
$speechKeys = Get-AzCognitiveServicesAccountKey -ResourceGroupName $ResourceGroupName -Name $AccountName

try {
    # Credentials stay in this PowerShell process; never log or save them.
    $synthesisArguments = @((Join-Path $PSScriptRoot 'synthesize-azure.mjs'))
    if ($Only) {
        $synthesisArguments += @('--only', $Only)
    }
    & node @synthesisArguments --prepare
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not prepare synthesis requests.'
    }
    $requestFile = Join-Path $PSScriptRoot '../.cache/azure-tts/requests.json'
    $requests = Get-Content -Raw -LiteralPath $requestFile | ConvertFrom-Json
    $headers = @{
        'Ocp-Apim-Subscription-Key' = $speechKeys.Key1
        'X-Microsoft-OutputFormat' = 'riff-48khz-16bit-mono-pcm'
        'User-Agent' = 'Rhyza-Video-Narration'
    }
    $endpoint = $speechAccount.Endpoint.TrimEnd('/') + '/tts/cognitiveservices/v1'
    foreach ($request in $requests) {
        if ((Test-Path -LiteralPath $request.file) -and (Get-Item -LiteralPath $request.file).Length -gt 44) {
            Write-Output ('Cache: ' + $request.id)
            continue
        }
        Write-Output ('Azure synthesis: ' + $request.id)
        $completed = $false
        for ($attempt = 0; $attempt -lt 3; $attempt++) {
            try {
                Invoke-WebRequest -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/ssml+xml' -Body ([Text.Encoding]::UTF8.GetBytes($request.ssml)) -OutFile ($request.file + '.part') -TimeoutSec 45
                if ((Get-Item -LiteralPath ($request.file + '.part')).Length -le 44) {
                    throw 'Empty synthesis response.'
                }
                Move-Item -LiteralPath ($request.file + '.part') -Destination $request.file -Force
                $completed = $true
                break
            } catch {
                $statusCode = [int]$_.Exception.Response.StatusCode
                if ($attempt -eq 2 -or ($statusCode -ge 400 -and $statusCode -lt 500 -and $statusCode -ne 429)) {
                    throw ('Azure synthesis failed for ' + $request.id + ': HTTP ' + $statusCode)
                }
                Start-Sleep -Seconds ([Math]::Pow(2, $attempt + 1))
            }
        }
        if (-not $completed) {
            throw ('No audio generated for ' + $request.id)
        }
    }
    & node @synthesisArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Synthesis exited with code $LASTEXITCODE."
    }
} finally {
    $speechKeys = $null
    $headers = $null
}
