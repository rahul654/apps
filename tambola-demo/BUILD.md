# Building the Tambola APK

Android build for this folder. It isn't part of the repo's web build (`scripts/build-site.mjs`).

## One-time setup (already done on this machine)
- JDK 21 in `~/.local/opt/jdk-21/`. The Android build tools don't support Java 25, so the build
  uses JDK 21 through `JAVA_HOME`. The system default stays Java 25.
- Android SDK in `~/Android/Sdk/` (platform 35, build-tools 35, platform-tools).

## Build
```bash
cd ~/rahul/apps/tambola-demo
export JAVA_HOME=~/.local/opt/jdk-21 ANDROID_HOME=~/Android/Sdk
./gradlew testDebugUnitTest assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk .
```
- `testDebugUnitTest` runs the call-order tests (`CallSequenceTest`). Leave it out to skip them.
- Output: `app/build/outputs/apk/debug/app-debug.apk`, copied to `tambola-demo/app-debug.apk`
  (git-ignored).
- First build: about 5 minutes (downloads dependencies). Later builds are faster.

## Tests only
```bash
./gradlew testDebugUnitTest
```
Report: `app/build/reports/tests/testDebugUnitTest/index.html`.

## Install on a phone
- Copy `app-debug.apk` to the phone and open it. Allow "Install unknown apps" for the app you
  open it from (Files, Drive, …).
- Or over USB, with USB debugging on:
  ```bash
  ~/Android/Sdk/platform-tools/adb install -r app-debug.apk
  ```
  `-r` replaces the installed version and keeps its tickets and settings.

## Clean build
```bash
./gradlew clean assembleDebug
```
