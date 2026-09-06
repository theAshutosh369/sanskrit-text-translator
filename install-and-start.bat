@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo Sanskrit Text Translator - First-time setup
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

echo Installing npm packages...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo Installing Chromium for Playwright...
call npx playwright install chromium
if errorlevel 1 (
  echo.
  echo Chromium installation failed.
  pause
  exit /b 1
)

echo.
echo Starting Sanskrit Translator...
echo Open http://localhost:3000 in your browser.
echo Keep this command window open while translating.
echo.
call npm start
pause
