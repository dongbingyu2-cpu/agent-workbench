param(
  [Parameter(Mandatory=$true)][ValidateSet('claude','opencode','pi','codex','antigravity')][string]$Kind,
  [ValidatePattern('^$|^[a-zA-Z0-9_-]{1,128}$')][string]$SessionId = '',
  [Parameter(Mandatory=$true)][string]$Project,
  [Parameter(Mandatory=$true)][string]$Executable,
  [switch]$PickConversation
)

try {
  Set-Location -LiteralPath $Project -ErrorAction Stop
  if (-not $SessionId) {
    & $Executable
  } else {
    switch ($Kind) {
      'claude' { & $Executable --resume $SessionId }
      'codex' { & $Executable resume $SessionId }
      'antigravity' {
        if ($PickConversation) {
          Write-Host 'Enter /resume, press Tab for Other, and find the copied conversation ID.'
          & $Executable
        } else {
          & $Executable --conversation $SessionId
        }
      }
      default { & $Executable --session $SessionId }
    }
  }
  if ($LASTEXITCODE -ne 0) { throw "Agent exited with code $LASTEXITCODE" }
} catch {
  Write-Host "无法续接会话：$_" -ForegroundColor Red
  Read-Host '按 Enter 关闭'
}
