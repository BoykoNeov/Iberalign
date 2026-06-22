:<<"BATCH"
@echo off
rem ===========================================================================
rem  Iberalign launcher  --  ONE file that starts the app on Windows AND Linux.
rem
rem  This is a polyglot script: Windows (cmd) runs the section below; Linux/macOS
rem  (sh) runs the section after the line that says BATCH. Do not "fix" the odd
rem  first line or the line endings -- the file must stay LF-only (see
rem  .gitattributes) or the Linux half breaks.
rem
rem  Windows: double-click this file, or run  start.cmd  in a terminal.
rem ===========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Iberalign needs Node.js, which was not found on this computer.
  echo   Install it from https://nodejs.org  ^(version 20 or newer^), then run this again.
  echo.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Iberalign needs Rust, which was not found on this computer.
  echo   Install it from https://rustup.rs , then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the user-interface packages ^(first run only, needs internet^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo   Could not install the packages. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Starting Iberalign. The very first launch compiles the engine and can take a
echo few minutes; later launches are quick. A window opens when it is ready.
echo.
call npm run tauri dev

echo.
echo Iberalign has closed.
pause
exit /b %errorlevel%
BATCH

# ===========================================================================
#  Iberalign launcher  --  Linux / macOS half of the polyglot above.
#  Run it with:   sh start.cmd     (or  ./start.cmd  after: chmod +x start.cmd)
# ===========================================================================
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Iberalign needs Node.js, which was not found on this computer."
  echo "  Install it from https://nodejs.org (version 20 or newer), then run this again."
  echo
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo
  echo "  Iberalign needs Rust, which was not found on this computer."
  echo "  Install it from https://rustup.rs , then run this again."
  echo
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing the user-interface packages (first run only, needs internet)..."
  npm install || {
    echo
    echo "  Could not install the packages. Check your internet connection and try again."
    exit 1
  }
fi

echo
echo "Starting Iberalign. The very first launch compiles the engine and can take a"
echo "few minutes; later launches are quick. A window opens when it is ready."
echo
exec npm run tauri dev
