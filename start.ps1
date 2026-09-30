#requires -RunAsAdministrator
<#
.SYNOPSIS
  Startup script for the Gestão Esportiva Escolar full stack.
  Ensures MongoDB is running, opens required firewall ports,
  and starts backend (FastAPI:8000) + frontend (Vite:5173).

  Usage (PowerShell):  .\start.ps1
#>

param(
    [string]$BackendPort  = "8000",
    [string]$FrontendPort = "5173",
    [string]$MongoDBPort  = "27017",
    [string]$NodePath = "C:\Program Files\nodejs",
    [string]$PythonPath = "C:\Users\carlo\AppData\Local\Programs\Python\Python312",
    [switch]$SkipFirewall,
    [int]$BackendWaitSeconds = 60
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "student-portal"

# Refactor de workspace: os logs de teste em backend/ e student-portal/ apontam para
# C:\Users\carlo\Downloads\emergent. Se este script rodar de la, o backend sobe no
# clone ERRADO e o .env que ele le nao e o deste repositorio.
if ($Root -match '[\\/]Downloads[\\/]emergent$') {
    Write-Host "AVISO: o script esta rodando no clone antigo ($Root)." -ForegroundColor Red
    Write-Host "        Rode a partir de c:\Users\carlo\Projetos\GestaoEsportiva." -ForegroundColor Red
}

# python.exe local do py launcher exposto como 'py'. Usado no pre-flight do Mongo
# em vez de depender do PATH, que neste PowerShell nao tem py/node/python.
$pyLauncher = Join-Path $env:LOCALAPPDATA "Programs\Python\Launcher\py.exe"
if (-not (Test-Path $pyLauncher)) { $pyLauncher = "$PythonPath\python.exe" }

Write-Host "=== Gestao Esportiva Escolar - Startup ===" -ForegroundColor Cyan
Write-Host ""
# node/npm/python nao estao no PATH deste PowerShell: anteceda manualmente.
$env:PATH = "$NodePath;$PythonPath;$PythonPath\Scripts;$env:PATH"

# ─── 1. Firewall Rules ────────────────────────────────────────────────────────
if (-not $SkipFirewall) {
    Write-Host "[1/4] Opening firewall ports..." -ForegroundColor Yellow
    $ports = @(5173, 8000, $MongoDBPort)
    foreach ($port in $ports) {
        $ruleName = "GestaoEsportiva-$port"
        if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort $port -Protocol TCP -Action Allow
            Write-Host "   Opened TCP/$port" -ForegroundColor Green
        } else {
            Write-Host "   TCP/$port already open" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "[1/4] Skipping firewall configuration" -ForegroundColor DarkGray
}

# ─── 2. MongoDB Check ────────────────────────────────────────────────────────
# Pre-flight REAL. Antes bastava haver um listener em 27017 para o script seguir,
# mas o mongod local roda como replica set (rs0): antes do rs.initiate() o listener
# existe e o ping passa, porem o $changeStream falha. Confirma-se o ping de fato e,
# se falhar, aborta ANTES de subir o backend -- antes o uvicorn subia e morria no
# startup, deixando o Vite com ECONNREFUSED 127.0.0.1:8000.
Write-Host "[2/4] Checking MongoDB (port $MongoDBPort)..." -ForegroundColor Yellow
$mongoRunning = Get-NetTCPConnection -LocalPort $MongoDBPort -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
if (-not $mongoRunning) {
    Write-Host "   MongoDB not detected. Attempting to start..." -ForegroundColor Yellow
    $mongoExe = Get-Command "mongod" -ErrorAction SilentlyContinue
    if ($mongoExe) {
        Start-Process -FilePath "mongod" -ArgumentList "--port $MongoDBPort" -WindowStyle Minimized -PassThru | Out-Null
        Start-Sleep -Seconds 3
        Write-Host "   MongoDB started (port $MongoDBPort)" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: mongod not found in PATH. Tentando MongoDB externo." -ForegroundColor Red
        Write-Host "   Update backend/.env with MONGO_URL if using Atlas or remote MongoDB." -ForegroundColor Red
    }
}

$mongoProbe = Join-Path $Backend "scripts\check_mongo.py"
if ((Test-Path $mongoProbe) -and (Test-Path $pyLauncher)) {
    Push-Location $Backend
    try {
        $probeOut = & $pyLauncher $mongoProbe 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   MongoDB inacessivel para o backend:" -ForegroundColor Red
            $probeOut | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
            Write-Host "   Suba o mongod (com --replSet rs0) ou aponte MONGO_URL em backend/.env." -ForegroundColor Red
            Write-Host "   Backend NAO iniciado (evita ECONNREFUSED 127.0.0.1:$BackendPort no proxy do Vite)." -ForegroundColor Red
            exit 1
        }
        Write-Host "   MongoDB respondeu ping ($($probeOut | Select-Object -Last 1))" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "   Pre-flight do Mongo indisponivel; seguindo apenas com o listener de porta." -ForegroundColor DarkYellow
}

# ─── 3. Backend (FastAPI) ─────────────────────────────────────────────────────
Write-Host "[3/4] Starting backend (FastAPI on :$BackendPort)..." -ForegroundColor Yellow
Set-Location $Backend
$uvicorn = "python -m uvicorn server:app --reload --port $BackendPort --host 0.0.0.0"
if (Test-Path "./venv/Scripts/python.exe") {
    $uvicorn = "./venv/Scripts/python.exe -m uvicorn server:app --reload --port $BackendPort --host 0.0.0.0"
}
Start-Process -FilePath "powershell" -ArgumentList "-NoExit","-Command",$uvicorn -WindowStyle Minimized

# Espera o /api/health responder em vez de assumir 2s. O startup cria ~16 colecoes
# de indices no Mongo e estoura esse prazo com folga; o sleep fixo anunciava
# "Backend started" com a porta 8000 ainda fechada.
$healthUrl = "http://127.0.0.1:$BackendPort/api/health"
$deadline = (Get-Date).AddSeconds($BackendWaitSeconds)
$backendReady = $false
Write-Host "   Aguardando $healthUrl ..." -ForegroundColor DarkGray
while (-not $backendReady -and (Get-Date) -lt $deadline) {
    try {
        $health = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        if ($health.StatusCode -eq 200) { $backendReady = $true; break }
    } catch {
        Start-Sleep -Milliseconds 700
    }
}
if ($backendReady) {
    Write-Host "   Backend started: http://localhost:$BackendPort (health 200)" -ForegroundColor Green
} else {
    Write-Host "   ATENCAO: backend nao respondeu /api/health em ${BackendWaitSeconds}s." -ForegroundColor Red
    Write-Host "   Veja o erro na janela minimizada do uvicorn (normalmente Mongo indisponivel)." -ForegroundColor Red
}

# ─── 4. Frontend (Vite) ───────────────────────────────────────────────────────
Write-Host "[4/4] Starting frontend (Vite on :$FrontendPort)..." -ForegroundColor Yellow
Set-Location $Frontend
if (Test-Path "package.json") {
    Start-Process -FilePath "$NodePath\npm.cmd" -ArgumentList "run","dev","--","--port","$FrontendPort","--host","0.0.0.0" -WindowStyle Minimized
    Start-Sleep -Seconds 2
    Write-Host "   Frontend started: http://localhost:$FrontendPort" -ForegroundColor Green
} else {
    Write-Host "   ERROR: package.json not found in student-portal" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Application Ready ===" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:$FrontendPort"
Write-Host "  Backend:  http://localhost:$BackendPort"
Write-Host "  API Docs: http://localhost:$BackendPort/docs"
Write-Host "  Debug:    VS Code launch configuration (browser port managed automatically)"
Write-Host ""
Write-Host "Pressione Ctrl+C ou feche as janelas dos processos filhos para encerrar." -ForegroundColor Yellow
Read-Host "Enter para fechar"