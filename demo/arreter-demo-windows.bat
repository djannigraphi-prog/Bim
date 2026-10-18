@echo off
cd /d "%~dp0"
docker compose down
echo Demo arretee (les donnees sont gardees pour la prochaine fois).
pause
