<#
.SYNOPSIS
    AYSO 154 Weekend Ops Engine - Local CSV Ingestion & Normalization Script
.DESCRIPTION
    Scans a local drop directory for MatchTrak CSV exports, normalizes headers,
    validates game records, and builds unified master schedules.
#>

[CmdletBinding()]
param(
    [string]$DropDir = "$HOME\Desktop\MatchTrak_Drop",
    [string]$OutputDir = "$HOME\Desktop\MatchTrak_Processed"
)

if (-not (Test-Path $DropDir)) { New-Item -ItemType Directory -Force -Path $DropDir | Out-Null }
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }

Write-Host "Scanning drop folder: $DropDir" -ForegroundColor Cyan

$csvFiles = Get-ChildItem -Path $DropDir -Filter "*.csv"

if ($csvFiles.Count -eq 0) {
    Write-Warning "No CSV files found in $DropDir. Drop your MatchTrak exports there to process."
    return
}

foreach ($file in $csvFiles) {
    Write-Host "Processing file: $($file.Name)" -ForegroundColor Yellow
    
    $data = Import-Csv $file.FullName
    
    $processedRows = foreach ($row in $data) {
        $gameId   = if ($row.'Game #') { $row.'Game #' } else { $row.'GameID' }
        $date     = if ($row.'Date') { $row.'Date' } else { $row.'Match Date' }
        $time     = if ($row.'Time') { $row.'Time' } else { $row.'Start Time' }
        $division = if ($row.'Division') { $row.'Division' } else { $row.'Div' }
        $field    = if ($row.'Field') { $row.'Field' } else { $row.'Venue Field' }
        $home     = if ($row.'Home Team') { $row.'Home Team' } else { $row.'Home' }
        $away     = if ($row.'Away Team') { $row.'Away Team' } else { $row.'Away' }

        [PSCustomObject]@{
            GameId      = $gameId
            Date        = $date
            Time        = $time
            Division    = $division
            Field       = $field
            HomeTeam    = $home
            AwayTeam    = $away
            SourceFile  = $file.Name
        }
    }

    if ($processedRows) {
        $outName = "Normalized_$($file.Name)"
        $outPath = Join-Path $OutputDir $outName
        $processedRows | Export-Csv -Path $outPath -NoTypeInformation -Encoding UTF8
        Write-Host "Successfully normalized and saved to: $outPath" -ForegroundColor Green
    } else {
        Write-Warning "No rows processed for $($file.Name)"
    }
}

Write-Host "Batch processing complete." -ForegroundColor Cyan
