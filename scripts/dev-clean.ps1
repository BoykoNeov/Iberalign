# dev-clean.ps1 — clear stale dev state before `tauri dev`.
#
# Why: on Windows, a `tauri dev` that was stopped uncleanly (or a launch that
# orphaned its children) leaves processes that make the NEXT launch fail or
# hang at 0% CPU:
#   * a stale Vite still LISTENING on port 1420  -> "Port 1420 is already in use"
#   * a stale iberalign.exe (app window / WebView2) holding a lock on
#     target\debug\iberalign.exe                 -> linker blocks on the file lock
#   * an orphaned cargo holding the artifact-dir lock
#                                                -> "Blocking waiting for file lock"
#
# This is SURGICAL: it only touches the process that OWNS port 1420 and
# processes named iberalign / cargo. It does NOT kill node broadly (other node
# processes are unrelated). Safe no-op when nothing stale is running.
#
# Run automatically by `npm run tauri:dev` / `npm run tauri:kalign`.

$ErrorActionPreference = 'SilentlyContinue'
$DevPort = 1420

# 1. Free the Vite dev port — kill whatever is LISTENING on it.
$owners = Get-NetTCPConnection -LocalPort $DevPort -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $owners) {
    if ($procId -and $procId -ne 0) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        Write-Host "[dev-clean] freeing port ${DevPort}: killing PID $procId ($($p.ProcessName))"
        Stop-Process -Id $procId -Force
    }
}

# 2. Kill a stale app window holding the target\debug\iberalign.exe lock.
Get-Process iberalign -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[dev-clean] killing stale app iberalign.exe PID $($_.Id)"
    Stop-Process -Id $_.Id -Force
}

# 3. Kill orphaned cargo builds holding the artifact-directory lock.
#    (Only relevant because we are about to start our own build; a live cargo
#     here is, by definition, going to contend for target\ with the launch.)
Get-Process cargo -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[dev-clean] killing orphaned cargo PID $($_.Id)"
    Stop-Process -Id $_.Id -Force
}

Write-Host "[dev-clean] ready."
