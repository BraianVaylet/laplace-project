# PostToolUse: formatea el archivo recien editado con Prettier, si esta instalado.
# Nunca bloquea: cualquier fallo sale con 0 y en silencio.
$ErrorActionPreference = 'SilentlyContinue'
try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
  $j = $raw | ConvertFrom-Json
  $path = [string]$j.tool_input.file_path
  if (-not $path) { exit 0 }
  if ($path -notmatch '\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|yml|yaml)$') { exit 0 }
  if (-not (Test-Path $path)) { exit 0 }
  if (-not (Test-Path (Join-Path $PSScriptRoot '..\..\node_modules'))) { exit 0 }
  & pnpm exec prettier --write --log-level warn $path *> $null
  exit 0
}
catch { exit 0 }
