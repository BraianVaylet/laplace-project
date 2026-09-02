# PreToolUse gate: blocks writes that look like they carry a real secret.
# Exit 2 = block and return stderr to Claude. Any other failure is non-blocking by design.
$ErrorActionPreference = 'Stop'
try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
  $j = $raw | ConvertFrom-Json

  $path = ''
  if ($j.tool_input.file_path) { $path = [string]$j.tool_input.file_path }

  $chunks = New-Object System.Collections.ArrayList
  foreach ($f in @('content','new_string')) {
    if ($j.tool_input.$f) { [void]$chunks.Add([string]$j.tool_input.$f) }
  }
  if ($j.tool_input.edits) {
    foreach ($e in $j.tool_input.edits) {
      if ($e.new_string) { [void]$chunks.Add([string]$e.new_string) }
    }
  }
  if ($chunks.Count -eq 0) { exit 0 }
  $text = $chunks -join "`n"

  $patterns = @{
    'clave privada'                = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'access token de Mercado Pago' = 'APP_USR-[0-9]{6,}-[0-9]{6}-[0-9a-f]{16,}'
    'secret key de Stripe'         = '\b(sk|rk)_live_[A-Za-z0-9]{16,}'
    'token de OpenAI/Anthropic'    = '\b(sk-ant-|sk-)[A-Za-z0-9_\-]{24,}'
    'access key de AWS'            = '\bAKIA[0-9A-Z]{16}\b'
    'token de GitHub'              = '\bgh[pousr]_[A-Za-z0-9]{30,}'
    'token de Slack'               = '\bxox[baprs]-[A-Za-z0-9-]{10,}'
    'URI de Mongo con password'    = 'mongodb(\+srv)?://[^:\s/]+:[^@\s]+@'
  }
  # Placeholders legitimos de .env.example / docs: no se bloquean.
  $placeholder = '(?i)(YOUR_|CHANGEME|REPLACE_ME|<[a-z_\-]+>|xxxx|placeholder|example\.com|\bfake\b|\bdummy\b)'

  foreach ($name in $patterns.Keys) {
    $m = [regex]::Matches($text, $patterns[$name])
    foreach ($hit in $m) {
      if ($hit.Value -notmatch $placeholder) {
        $where = if ($path) { " en $path" } else { '' }
        [Console]::Error.WriteLine("BLOQUEADO: parece un/a $name$where. Los secretos van al gestor de la plataforma (Railway), nunca al repo. Usa un placeholder en .env.example y documenta la variable.")
        exit 2
      }
    }
  }
  exit 0
}
catch { exit 0 }
