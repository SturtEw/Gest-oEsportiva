#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Check', 'Build', 'Deploy', 'Emulators')]
    [string]$Action = 'Check'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'student-portal'
$exitCode = 0
$audit = $env:FIREBASE_AUDIT_LOG
function Write-Audit([string]$stage, [string]$status, [int]$code) {
    # Only metadata crosses this boundary. Never serialize environment or CLI output.
    # `$event` is an automatic variable in PowerShell; use an explicit name.
    $record = @{ timestamp = (Get-Date).ToUniversalTime().ToString('o'); action = $Action; stage = $stage; status = $status; exitCode = $code }
    if ($audit) {
        $line = ConvertTo-Json -InputObject $record -Compress
        [System.IO.File]::AppendAllText($audit, "$line`n", [System.Text.UTF8Encoding]::new($false))
    }
}

function Resolve-RequiredApplication([string]$name) {
    $tool = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $tool) { throw "Pre-requisito ausente no PATH: $name. Instale-o e reabra o terminal." }
    return $tool.Source
}

function Invoke-Checked([string]$stage, [string]$exe, [string[]]$arguments) {
    Write-Audit $stage 'started' 0
    # Native stderr is untrusted: do not replay it to the terminal or persist it.
    # A failing native process does NOT necessarily throw in Windows PowerShell 5.1.
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $exe @arguments 2>&1 | Out-Null
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        Write-Audit $stage 'failed' $code
        throw "Etapa '$stage' falhou (codigo $code). Verifique a configuracao local; nao habilite --debug com credenciais ativas."
    }
    Write-Audit $stage 'ok' 0
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'firebase.json') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $frontend 'package-lock.json') -PathType Leaf)) {
        throw 'Projeto incompleto: student-portal/firebase.json e package-lock.json sao obrigatorios.'
    }
    $node = Resolve-RequiredApplication 'node.exe'
    $npm = Resolve-RequiredApplication 'npm.cmd'
    $firebase = Resolve-RequiredApplication 'firebase.cmd'
    # Compare parsed versions: regex groups made a valid 22.x/25.x look unsupported.
    $nodeVersion = (& $node --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
        throw 'Nao foi possivel determinar a versao do Node.js.'
    }
    $parsed = [version]::new($Matches[1], $Matches[2], $Matches[3])
    if ($parsed -lt [version]::new('20.19.0') -and $parsed -lt [version]::new('22.12.0')) {
        throw "Node.js $($parsed) nao e suportado: use 20.19+ ou 22.12+."
    }
    if ($Action -eq 'Deploy') {
        if ($env:FIREBASE_PROJECT_ID -notmatch '^[a-z][a-z0-9-]{4,29}$') {
            throw 'FIREBASE_PROJECT_ID ausente ou invalido.'
        }
        if ($env:VITE_API_BASE -notmatch '^https://[^\s/]+(?:/[^\s]*)?$') {
            throw 'VITE_API_BASE deve ser a URL HTTPS do backend antes do build de producao.'
        }
        if ([string]::IsNullOrWhiteSpace($env:FIREBASE_TOKEN)) {
            throw 'FIREBASE_TOKEN ausente: injete-o por um processo pai confiavel; nao digite nem passe o token como argumento.'
        }
        if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
            throw 'GOOGLE_APPLICATION_CREDENTIALS aponta para arquivo: este fluxo local proibe credenciais em disco.'
        }
    }
    if ($audit) {
        if (-not [System.IO.Path]::IsPathRooted($audit)) { throw 'FIREBASE_AUDIT_LOG deve ser um caminho absoluto.' }
        $fullAudit = [System.IO.Path]::GetFullPath($audit)
        if ($fullAudit.StartsWith([System.IO.Path]::GetFullPath($root) + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'FIREBASE_AUDIT_LOG deve ficar fora do repositorio.'
        }
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $fullAudit) -PathType Container)) { throw 'Pasta do log de auditoria inexistente.' }
        $audit = $fullAudit
    }
    Write-Audit 'preflight' 'ok' 0
    if ($Action -ne 'Check') {
        Push-Location $frontend
        try {
            if ($Action -in @('Build', 'Deploy')) {
                Invoke-Checked 'install' $npm @('ci', '--no-audit')
                Invoke-Checked 'tests' $npm @('run', 'test:run')
                Invoke-Checked 'build' $npm @('run', 'build')
            }
            if ($Action -eq 'Deploy') {
                if (-not (Test-Path -LiteralPath (Join-Path $frontend 'dist/index.html') -PathType Leaf)) { throw 'Build nao gerou dist/index.html.' }
                Invoke-Checked 'hosting-deploy' $firebase @('deploy', '--only', 'hosting', '--project', $env:FIREBASE_PROJECT_ID, '--non-interactive')
            }
            if ($Action -eq 'Emulators') {
                # Emulator uses local data only; never pass the production token to it.
                Remove-Item Env:FIREBASE_TOKEN -ErrorAction SilentlyContinue
                Invoke-Checked 'hosting-emulator' $firebase @('emulators:start', '--only', 'hosting', '--project', 'demo-sports-local')
            }
        } finally {
            Pop-Location
        }
    }
    Write-Output "Firebase $Action concluido."
} catch {
    $exitCode = 1
    # No exception object or command line is logged: native failures may contain secrets.
    [Console]::Error.WriteLine("Firebase $Action falhou: $($_.Exception.Message)")
} finally {
    # Scope is this process only. The trusted parent remains responsible for its own secret lifecycle.
    Remove-Item Env:FIREBASE_TOKEN -ErrorAction SilentlyContinue
    if ($exitCode -ne 0) {
        try { Write-Audit 'workflow' 'failed' $exitCode } catch { [Console]::Error.WriteLine('Nao foi possivel gravar o log de auditoria.') }
    }
}
exit $exitCode
