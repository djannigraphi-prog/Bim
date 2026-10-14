#!/usr/bin/env bash
# Lance le test de bout en bout sur l'émulateur et garde une copie de la sortie pour le résumé.
set -o pipefail
flutter test integration_test/auth_flow_test.dart -d emulator-5554 \
  --dart-define=BIM_API_URL=http://10.0.2.2:3000 \
  --dart-define=BIM_TEST_CODE_URL=http://10.0.2.2:3999 \
  --reporter expanded 2>&1 | tee "$RUNNER_TEMP/e2e.log"
