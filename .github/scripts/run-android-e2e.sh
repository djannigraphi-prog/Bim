#!/usr/bin/env bash
# Lance le test de bout en bout sur l'émulateur et garde une copie de la sortie pour le résumé.
# En cas d'échec, garde aussi la fin du journal système Android (plantage, mémoire, arrêt du processus) :
# un test « did not complete » signifie que l'app a disparu, et seul ce journal dit pourquoi.
set -o pipefail
flutter test integration_test/auth_flow_test.dart -d emulator-5554 \
  --dart-define=BIM_API_URL=http://10.0.2.2:3000 \
  --dart-define=BIM_TEST_CODE_URL=http://10.0.2.2:3999 \
  --reporter expanded 2>&1 | tee "$RUNNER_TEMP/e2e.log"
status=$?
if [ "$status" -ne 0 ]; then
  {
    echo "== tampon des plantages"
    adb logcat -d -b crash 2>&1 | tail -n 60
    echo "== processus et mémoire"
    adb logcat -d 2>&1 | grep -E "AndroidRuntime|FATAL|lowmemorykiller|lmkd|Process com\.|has died|Killing|ANR in|OutOfMemory|flutter.*(Error|Exception)|signal [0-9]+|Abort message|VM service" | tail -n 80
  } > "$RUNNER_TEMP/logcat.short" || true
fi
exit "$status"
