#!/usr/bin/env bash
# Runs reflection/router regressions with fake task-manager responses on Android.
# This deliberately does not run the opt-in Samsung hardware tests.
set -euo pipefail
router_reports=app/build/reports/router-emulator
mkdir -p "$router_reports"
router_image='system-images;android-36;google_apis;x86_64'
# New command-line tools and the emulator can choose different default AVD roots.
# Give both tools the same explicit location without changing the user's HOME.
export ANDROID_AVD_HOME="${RUNNER_TEMP:-/tmp}/folduo-ci-avd"
mkdir -p "$ANDROID_AVD_HOME"
sdkmanager 'emulator' "$router_image"
avdmanager create avd --force --name folduo-ci --package "$router_image" --path "$ANDROID_AVD_HOME/folduo-ci.avd" <<< 'no'
test -f "$ANDROID_AVD_HOME/folduo-ci.ini"
if [[ -e /dev/kvm ]]; then sudo chmod 666 /dev/kvm; fi
"$ANDROID_HOME/emulator/emulator" -avd folduo-ci -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > "$router_reports/emulator.log" 2>&1 &
router_emulator_pid=$!
router_cleanup() {
    router_result=$?
    if [[ "$router_result" != 0 ]]; then tail -100 "$router_reports/emulator.log"; fi
    adb emu kill >/dev/null 2>&1 || true
    kill "$router_emulator_pid" 2>/dev/null || true
}
trap router_cleanup EXIT
router_booted=false
for attempt in $(seq 1 90); do
    # Surface an emulator crash immediately instead of spending three minutes
    # waiting for an ADB device that can never appear.
    kill -0 "$router_emulator_pid"
    if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then router_booted=true; break; fi
    sleep 2
done
if [[ "$router_booted" != true ]]; then tail -80 "$router_reports/emulator.log"; exit 1; fi
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell appops set jp.bunkaich.sukashimotion SYSTEM_ALERT_WINDOW allow
adb shell wm dismiss-keyguard
adb shell am instrument -w -r -e class jp.bunkaich.sukashimotion.TaskDisplayRouterTest,jp.bunkaich.sukashimotion.HomeInteractionTest,jp.bunkaich.sukashimotion.InnerNavigationTest,jp.bunkaich.sukashimotion.UiOptimizationTest,jp.bunkaich.sukashimotion.NavigationResponseTest,jp.bunkaich.sukashimotion.LanguageTest#pickerSwitchesBothWaysAndFollowsSystemAgain jp.bunkaich.sukashimotion.test/androidx.test.runner.AndroidJUnitRunner | tee "$router_reports/instrumentation.txt"
# am instrument may return zero even when a test fails or the process crashes.


# Synthetic emulator screenshots, not user/device data. Keep images in reports and
# emit compact JPEGs so the review can inspect the exact CI build from job logs.
for panel in cover inner; do
    if ! adb pull "/sdcard/Android/data/jp.bunkaich.sukashimotion/files/dashboard-$panel.jpg" "$router_reports/dashboard-$panel.jpg"; then continue; fi
    printf 'FOLDUO_UI_%s=' "$panel"
    base64 -w0 "$router_reports/dashboard-$panel.jpg"
    printf '\n'
done
grep -Eq '^OK \([0-9]+ tests?\)' "$router_reports/instrumentation.txt"
