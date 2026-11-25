# Android build (Read IT)

## Prerequisites
- **Node.js 24 + pnpm 12** — the exact pnpm release is pinned by `package.json`
  (`corepack enable` makes local pnpm honour it).
- **JDK 21** — system Java is 26 and Gradle 8.14 / AGP 8.13 reject it; use the JDK bundled with
  Android Studio: `C:\Program Files\Android\Android Studio\jbr` (openjdk 21.0.9, verified).
- **Android SDK** — set `ANDROID_HOME` to your local SDK (build-tools 36.0.0,
  platforms android-36). Android Studio itself is not needed to build.
- `minSdk 26` (Android 8.0; WebView 110+), `compileSdk`/`targetSdk 36` → `android/variables.gradle`.
- `pnpm install` once; only `dist/` is packaged, so build the web app first.

## Build → APK
```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
pnpm android:sync                         # checksum-pinned libs + native web bundle -> Android
cd android; .\gradlew.bat assembleDebug   # first run downloads Gradle 8.14.3
adb install -r app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n app.readit.reader/.MainActivity
```
APK: `android\app\build\outputs\apk\debug\app-debug.apk` (~105 MB: sherpa-onnx native libraries for arm64, armeabi-v7a and, in debug only, x86_64).

## JVM unit tests

`pnpm android:sync` fetches the checksum-pinned native libraries, builds the web
bundle, and syncs it into Android before Gradle runs:

```powershell
pnpm android:sync
cd android
.\gradlew.bat testDebugUnitTest --tests app.readit.reader.kokoro.AudioEdgeTrimmerTest --no-daemon --max-workers=2
```

Reports are written under `android\app\build\reports\tests\testDebugUnitTest\`.
The `Android JVM unit tests` workflow runs the same steps with JDK 21 and Android
SDK 36 and uploads the reports.

## Release signing
Release packaging fails closed when `android/keystore.properties` is absent; it never emits an
unsigned or debug-signed release artifact. Debug builds and JVM tests do not need the keystore.

Create a keystore outside the repo and add `android/keystore.properties` (gitignored) with
`storeFile` (forward slashes), `storePassword`, `keyAlias` and `keyPassword`; `assembleRelease`
then signs with it. Keep a copy of the keystore: losing it means no further updates.

Previously distributed review builds were debug-signed. Moving to a release key changes the
signature, and Android then refuses the update: export a backup first (Settings → Backup, with
books), install the release build, and import that backup.

## Debugging the WebView
Debug builds call `WebView.setWebContentsDebuggingEnabled(true)` in `MainActivity`, guarded by
`FLAG_DEBUGGABLE` so release builds leave it off. Enable USB debugging, plug in, open
`chrome://inspect/#devices` in desktop Chrome and *inspect* the Read IT WebView; the JS console
also shows in `adb logcat -s Capacitor/Console`.

## Native notes
- `largeHeap="true"` + `hardwareAccelerated="true"` in the manifest (Kokoro/ONNX peaks near 800 MB).
- INTERNET only; mixed content and cleartext HTTP are off, so an `http://` Kokoro server needs a network-security-config entry.
- Speech speed (threads, execution providers, why GPU and multi-threaded WASM are unavailable) is measured and written up in [PERFORMANCE.md](PERFORMANCE.md); `Kokoro.load` accepts `provider: "cpu" | "xnnpack" | "nnapi"` and reports the one in use.
