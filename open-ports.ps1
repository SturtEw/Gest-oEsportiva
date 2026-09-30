<#  Port Setup Script for Windows (Run as Administrator)
    Opens firewall ports for Gestao Esportiva Escolar
    Usage:  .\open-ports.ps1
#>

param(
    [int[]]$Ports = @(5173, 8000, 27017)
)

foreach ($port in $Ports) {
    $ruleName = "GestaoEsportiva-$port"
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        Write-Host "Rule already exists: TCP/$port" -ForegroundColor Yellow
    } else {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $port -Protocol TCP -Action Allow
        Write-Host "Created rule: TCP/$port" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "All ports configured. Ports open:" -ForegroundColor Cyan
Write-Host "  5173  - Vite (Frontend)"
Write-Host "  8000  - FastAPI (Backend)"
Write-Host "  27017 - MongoDB"