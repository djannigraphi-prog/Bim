@echo off
REM Demarre la demonstration BIM (Docker Desktop doit etre ouvert). Guide : docs\DEMO_TELEPHONE.md
cd /d "%~dp0"
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"`) do set IP=%%i
set DEMO_PUBLIC_URL=http://%IP%:3000
echo Adresse a saisir dans l'app : %DEMO_PUBLIC_URL%
docker compose up -d --build
echo Ouverture de la page de demo dans 30 secondes...
timeout /t 30 >nul
start http://localhost:3000/demo
pause
