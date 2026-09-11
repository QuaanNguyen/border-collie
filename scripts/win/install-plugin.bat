@echo off
cd /d "%~dp0..\.."
echo Installing Border Collie (plugin + guard + pet dependencies)…
node scripts\install-plugin.js
if errorlevel 1 (
  echo Install failed.
  exit /b 1
)
echo.
echo Done. Open a project with: opencode ^<path^>
exit /b 0
