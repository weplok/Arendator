[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repositoryRoot "venv\Scripts\python.exe"
$backend = Join-Path $repositoryRoot "backend"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python virtual environment was not found: $python"
}

$blackArguments = @("-m", "black", $backend)
if ($Check) {
    $blackArguments += "--check"
}

& $python @blackArguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
