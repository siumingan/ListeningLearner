# ListeningLearner - tiny local web server (no install needed, uses Windows PowerShell)
# Serves this folder at http://localhost:8765/ and opens the browser.
# YouTube's player needs the page to have a real web address, so use this instead of double-clicking index.html.

param([int]$Port = 8765)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.png'  = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
  '.vtt'  = 'text/vtt; charset=utf-8'; '.srt' = 'text/plain; charset=utf-8'
  '.mp4'  = 'video/mp4'; '.webm' = 'video/webm'; '.md' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Could not start on port $Port. Is ListeningLearner already running? Try: start.bat 8766" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "  ListeningLearner is running at $prefix" -ForegroundColor Green
Write-Host "  Keep this window open while you use the app. Close it (or press Ctrl+C) to stop."
Write-Host ""
Start-Process $prefix

$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))
      if ($rel -eq 'api/python') {
        # Check Python button: report the installed Python version, or not found
        $ver = $null; $cmdUsed = $null
        foreach ($cmd in @(@('py', '-3', '--version'), @('python', '--version'))) {
          try {
            $out = (& $cmd[0] $cmd[1..($cmd.Length - 1)] 2>&1 | Out-String)
            if ($out -match 'Python (\d+\.\d+\.\d+)') { $ver = $Matches[1]; $cmdUsed = $cmd[0]; break }
          } catch { }
        }
        $obj = @{ found = [bool]$ver; version = $ver; command = $cmdUsed; mode = 'basic' }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
        $res.ContentType = 'application/json; charset=utf-8'
        $res.Headers.Add('Cache-Control', 'no-store')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } elseif (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      } elseif (Test-Path -LiteralPath $full -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.ContentType = $type
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
