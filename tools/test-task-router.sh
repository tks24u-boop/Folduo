#!/usr/bin/env bash
# Runs reflection/router regressions with fake task-manager responses on Android.
# This deliberately does not run the opt-in Samsung hardware tests.
set -euo pipefail
router_reports=app/build/reports/router-emulator
mkdir -p "$router_reports"
router_image='system-images;android-36;google_apis;x86_64'
sdkmanager 'emulator' "$router_image"
avdmanager create avd --force --name folduo-ci --package "$router_image" <<< 'no'
if [[ -e /dev/kvm ]]; then sudo chmod 666 /dev/kvm; fi
"$ANDROID_HOME/emulator/emulator" -avd folduo-ci -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > "$router_reports/emulator.log" 2>&1 &
router_emulator_pid=$!
trap 'adb emu kill >/dev/null 2>&1 || true; kill "$router_emulator_pid" 2>/dev/null || true' EXIT
timeout 180 adb wait-for-device
router_booted=false
for attempt in $(seq 1 90); do
    if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then router_booted=true; break; fi
    sleep 2
done
if [[ "$router_booted" != true ]]; then tail -80 "$router_reports/emulator.log"; exit 1; fi
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -r -e class jp.bunkaich.sukashimotion.TaskDisplayRouterTest jp.bunkaich.sukashimotion.test/androidx.test.runner.AndroidJUnitRunner | tee "$router_reports/instrumentation.txt"
# am instrument may return zero even when a test fails or the process crashes.
grep -Eq '^OK \([0-9]+ tests?\)' "$router_reports/instrumentation.txt"
