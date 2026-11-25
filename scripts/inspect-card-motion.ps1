param(
  [string]$Installation = 'C:\Program Files (x86)\Hearthstone',
  [string]$Output = (Join-Path $PSScriptRoot '..\.tmp\card-motion-source')
)
# Reflection-only: no game methods are executed and the installation is never written.
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$reader = Get-Content -Raw -LiteralPath (Join-Path $Installation 'Assets_Extracted\tools\inspect_hand_il.ps1')
$prefix = $reader.Substring(0, $reader.IndexOf('foreach ($typeName'))
Push-Location -LiteralPath $Installation
try {
  Invoke-Expression $prefix
  $result = [ordered]@{}
  foreach ($name in @('Card', 'MulliganManager', 'ZoneDeck', 'ZoneHand', 'TurnStartManager')) {
    $type = $hsAssembly.GetType($name)
    $methods = @($type.GetMethods($flags) | Where-Object { $_.Name -match 'Draw|Deck|Mulligan|Starting|Deal|RemoveOld|Transition|Transform|Layout|Shuffle|Fatigue|Flip|Reveal|Joust|RotateInto' })
    $methods += @($type.GetConstructors($flags) | Where-Object IsStatic)
    foreach ($method in $methods) { $result[$name + '::' + $method.ToString()] = @(Dump $method) }
    foreach ($nested in $type.GetNestedTypes($flags) | Where-Object { $_.Name -match 'Draw|Reveal|Deck|Starting|OldCards|Mulligan|Coin|SampleAnim|Flip|Fatigue|Joust' }) {
      $method = $nested.GetMethod('MoveNext', $flags)
      if ($method) { $result[$nested.FullName] = @(Dump $method) }
    }
  }
  $tw = [Reflection.Assembly]::ReflectionOnlyLoadFrom((Join-Path $Installation 'Hearthstone_Data\Managed\Blizzard.T5.iTween.dll'))
  foreach ($method in $tw.GetType('iTween').GetMethods($flags) | Where-Object { $_.Name -match 'easeInOut|easeInSineOutExpo|easeInQuad|easeOutQuad|easeOutBack|easeOutExpo|clerp|GenerateMoveTo|GenerateRotateTo|ApplyMoveTo|ApplyRotateTo|PathControl|Interp' }) {
    $result['iTween::' + $method.ToString()] = @(Dump $method)
  }
  foreach ($method in $tw.GetType('iTween+Defaults').GetConstructors($flags)) { $result['iTween.Defaults'] = @(Dump $method) }
  $result['iTween.EaseType'] = @($tw.GetType('iTween+EaseType').GetFields($flags) | Where-Object IsLiteral | ForEach-Object { $_.Name + '=' + $_.GetRawConstantValue() })
  try { $types = $hsAssembly.GetTypes() } catch [Reflection.ReflectionTypeLoadException] { $types = $_.Exception.Types }
  $result['RelatedTypes'] = @($types | Where-Object { $_ -and $_.FullName -match 'Fatigue|Joust|RevealCard' } | ForEach-Object FullName)
  foreach ($type in $types | Where-Object { $_ -and $_.FullName -match 'Fatigue|Joust|RevealCard' }) {
    foreach ($method in $type.GetConstructors($flags)) {
      $result[$type.FullName + '::' + $method.Name] = @(Dump $method)
    }
    foreach ($method in $type.GetMethods($flags) | Where-Object DeclaringType -EQ $type) {
      $result[$type.FullName + '::' + $method.ToString()] = @(Dump $method)
    }
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'methods.json') -Encoding UTF8
  Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Installation 'Hearthstone_Data\Managed\Assembly-CSharp.dll'), (Join-Path $Installation 'Hearthstone_Data\Managed\Blizzard.T5.iTween.dll') | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'assemblies.json') -Encoding UTF8
  Write-Output ('Saved ' + $result.Count + ' method/enum records to ' + $Output)
} finally { Pop-Location }
