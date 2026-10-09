# Start Cadence at logon (Task Scheduler). Same as: cadence service install
param([string]$Action = 'install')
$root = Split-Path -Parent $PSScriptRoot
node --no-warnings "$root\server\bin\cadence.mjs" service $Action
