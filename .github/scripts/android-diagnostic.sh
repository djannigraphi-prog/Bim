#!/usr/bin/env bash
# Diagnostic de l'étape émulateur, exécuté seulement en cas d'échec (lecture seule, ne relance rien).
# Les journaux bruts de GitHub ne sont pas toujours téléchargeables : ce rapport dit jusqu'où l'étape est allée
# (paquets du SDK, appareil virtuel, processus de l'émulateur, plantage) et l'état de la machine (mémoire, disque, KVM,
# processus tués par le système). Il est publié en annotations par l'étape « Résumé ».
out="$RUNNER_TEMP/diag.txt"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
{
  echo "== machine"
  nproc; free -m; df -h / "$HOME" "$RUNNER_TEMP" 2>/dev/null | sort -u
  ls -l /dev/kvm 2>&1
  echo "== noyau (mémoire, processus tués, KVM)"
  sudo dmesg -T 2>/dev/null | grep -iE "out of memory|oom|killed process|kvm|segfault|qemu|emulator" | tail -n 30 || echo "dmesg indisponible"
  echo "== SDK Android ($sdk)"
  ls "$sdk" 2>&1
  ls -d "$sdk"/system-images/*/*/* 2>&1
  grep -h "^Pkg.Revision" "$sdk/emulator/source.properties" 2>&1 | sed 's/^/emulator /'
  "$sdk/emulator/emulator" -version 2>&1 | head -n 1
  echo "== appareils virtuels"
  ls -la "$HOME/.android/avd" 2>&1
  for ini in "$HOME"/.android/avd/*.avd/config.ini; do [ -f "$ini" ] && grep -E "hw.ramSize|disk.dataPartition.size|image.sysdir|hw.cpu.ncore" "$ini"; done
  ls -la "$HOME"/.android/avd/*.avd/ 2>&1 | grep -E "lock|qemu|\.img|\.ini" | head -n 20
  echo "== processus émulateur / adb"
  pgrep -af "qemu|emulator|adb" | cut -c1-250 || echo "aucun"
  timeout 15 adb devices -l 2>&1 || echo "adb : pas de réponse en 15 s"
  echo "== rapports de plantage de l'émulateur"
  find /tmp "$HOME/.android" -maxdepth 3 \( -name "emu-crash*" -o -name "*.dmp" \) 2>/dev/null | head -n 10
  echo "== journal du test (fin)"
  if [ -f "$RUNNER_TEMP/e2e.log" ]; then
    grep -vE "^(I|D|V)/|\] *[0-9]+%" "$RUNNER_TEMP/e2e.log" | tail -n 60
  else
    echo "absent : le script du test n'a pas démarré (échec dans la préparation de l'émulateur)"
  fi
  echo "== journal de l'étape tenu par le runner (fin, si encore présent)"
  pages=$(sudo find / -path "*/_diag/pages/*.log" -newermt "-30 minutes" 2>/dev/null | xargs -r ls -t 2>/dev/null | head -n 3)
  for p in $pages; do
    echo "-- $p"
    sudo tail -n 80 "$p" | grep -vE "^\S+ (I|D|V)/|\] *[0-9]+%|^\S+ *$" | cut -c1-220 | tail -n 60
  done
  [ -z "$pages" ] && echo "aucun"
} > "$out" 2>&1
cut -c1-220 "$out" > "$out.cut"
python3 "$GITHUB_WORKSPACE/.github/scripts/annotate-chunks.py" "diagnostic émulateur" "$out.cut" 6
