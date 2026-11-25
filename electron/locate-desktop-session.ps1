param(
  [Parameter(Mandatory=$true)][ValidateSet('opencode','antigravity')][string]$Kind,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]{1,128}$')][string]$SessionId,
  [Parameter(Mandatory=$true)][string]$Executable
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type -Namespace Workbench -Name DesktopWindow -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr handle);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr handle, int command);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr handle);
'@

function Wait-ForValue([int]$Timeout, [scriptblock]$Read) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  do {
    try {
      $value = & $Read
      if ($value) { return $value }
    } catch [Windows.Automation.ElementNotAvailableException] {}
    Start-Sleep -Milliseconds 180
  } while ($timer.ElapsedMilliseconds -lt $Timeout)
}

function Find-Window {
  $processName = [IO.Path]::GetFileNameWithoutExtension($Executable)
  Get-Process -Name $processName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $Executable -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
    ForEach-Object MainWindowHandle |
    Select-Object -First 1
}

function Find-Controls([Windows.Automation.ControlType]$Type) {
  $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
  $window.FindAll([Windows.Automation.TreeScope]::Descendants, $condition) |
    Where-Object { -not $_.Current.IsOffscreen }
}

function Find-SearchBox {
  Find-Controls ([Windows.Automation.ControlType]::ComboBox) |
    Where-Object { $_.Current.Name -match $inputName } |
    Select-Object -First 1
}

function Read-ControlValue($Control) {
  $pattern = $null
  if ($Control.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $pattern.Current.Value
  }
}

function Find-SearchResult {
  $items = @(Find-Controls ([Windows.Automation.ControlType]::ListItem) | Where-Object {
    if ($Kind -eq 'opencode') {
      [Uri]::UnescapeDataString($_.Current.AutomationId) -cmatch $resultId
    } else {
      $_.Current.Name -match $resultId
    }
  })
  if ($items.Count -eq 1) { $items[0] }
}

function Test-ActiveSession {
  if (Find-SearchBox) { return }
  $documents = @(Find-Controls ([Windows.Automation.ControlType]::Document))
  if ($Kind -eq 'antigravity') {
    foreach ($doc in $documents) {
      if ((Read-ControlValue $doc) -match $resultId) { return $true }
    }
    return
  }
  foreach ($link in Find-Controls ([Windows.Automation.ControlType]::Hyperlink)) {
    $name = $link.Current.Name
    if (-not $name -or (Read-ControlValue $link) -cnotmatch $resultId) { continue }
    foreach ($doc in $documents) {
      $title = $doc.Current.Name -creplace ' \u00b7 OpenCode$', ''
      if ($title -and $name.Contains($title)) { return $true }
    }
  }
}

if ($Kind -eq 'opencode') {
  $buttonName = '^(Search sessions|\u641c\u7d22\u4f1a\u8bdd|\u641c\u5c0b\u5de5\u4f5c\u968e\u6bb5)$'
  $inputName = $buttonName
} else {
  $buttonName = '^Search Conversations$'
  $inputName = '^Search for conversations(?:\.\.\.|\u2026)?$'
}
$resultId = '(?<![A-Za-z0-9_-])' + [regex]::Escape($SessionId) + '(?![A-Za-z0-9_-])'

$handle = Find-Window
if (-not $handle) {
  Start-Process -FilePath $Executable -WorkingDirectory ([IO.Path]::GetDirectoryName($Executable)) -WindowStyle Normal
  $handle = Wait-ForValue 11000 { Find-Window }
}
if (-not $handle) { 'no-window'; return }
if ([Workbench.DesktopWindow]::IsIconic($handle)) {
  [void][Workbench.DesktopWindow]::ShowWindowAsync($handle, 9)
}
[void][Workbench.DesktopWindow]::SetForegroundWindow($handle)

$invoked = $false
try {
  $window = [Windows.Automation.AutomationElement]::FromHandle($handle)
  $search = Wait-ForValue 9500 {
    $box = Find-SearchBox
    if ($box) { return $box }
    $button = Find-Controls ([Windows.Automation.ControlType]::Button) |
      Where-Object { $_.Current.Name -match $buttonName } |
      Select-Object -First 1
    if ($button) {
      $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      return (Wait-ForValue 2200 { Find-SearchBox })
    }
  }
  if (-not $search) { 'not-found'; return }
  $search.SetFocus()
  $search.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($SessionId)
  $result = Wait-ForValue 3300 {
    if ((Read-ControlValue $search) -ceq $SessionId) { Find-SearchResult }
  }
  if (-not $result) { 'not-found'; return }
  $result.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  $invoked = $true
  if (Wait-ForValue 4500 { Test-ActiveSession }) { 'opened'; return }
} catch {
  # The target window can reload or close while UI Automation reads it.
}
if ($invoked) { 'unconfirmed' } else { 'not-found' }
