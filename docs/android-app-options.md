# Turning Stub into an Android app (APK)

Status: options only, nothing implemented. Written 13 October 2026.

## What the app needs

The web version of Stub already pairs two devices by QR code and sends files over WebRTC. A real Android app should add things a web page can't do:

| Need | Android API it maps to |
| --- | --- |
| Create a local-only hotspot (no internet, no mobile data) | `WifiManager.startLocalOnlyHotspot` (Android 8+) |
| Auto-join that Wi-Fi from a QR scan | `WifiNetworkSpecifier` + `ConnectivityManager.requestNetwork` (Android 10+) |
| Wi-Fi Direct | `WifiP2pManager` |
| NFC (tap to pair) | `NfcAdapter`, NDEF, or host card emulation |
| Keep transferring in the background | Foreground service (`dataSync` type) or a user-initiated data transfer job (Android 14+) |
| Fast storage for large files | Stream straight to `MediaStore` / Storage Access Framework, no in-memory copy |
| Appear in Android's share sheet | `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filter |

Two Android rules shape the background-transfer part:
- Apps targeting Android 15+ get **6 hours of `dataSync` foreground service per 24 hours**. When that runs out, `onTimeout()` is called and the service must stop.
- For transfers the user starts, Google recommends **user-initiated data transfer (UIDT) jobs** (Android 14+: `JobInfo.Builder.setUserInitiated(true)` plus the `RUN_USER_INITIATED_JOBS` permission). Google Maps moved its downloads to them.

Every option below that reaches native code can use either one.

Today's web app has three limits on Android. Chrome on Android has no folder picker, so received files are held in memory. Transfers pause when the browser goes to the background. And the page can't create or join Wi-Fi networks.

---

## Option 1: Capacitor

**How it works.** Capacitor puts the existing `dist/` build inside an Android app, where it runs in the system WebView. JavaScript calls native code through plugins, and you can write your own plugins in Kotlin. Current version: 8.5.3 (October 2026).

**Code reused.** On day one the app runs unchanged, so effectively all of it: the Svelte UI, `pairing/` and `transfer/`. Android System WebView is Chromium and supports WebRTC data channels and `getUserMedia`. Later, the big-file path should move into Kotlin, because Capacitor's stock Filesystem plugin sends data across the bridge as base64, which is slow for gigabytes. The UI and pairing code stay as they are.

**Native capabilities.** All of them, through Kotlin plugins you write or adopt:

| Need | How |
| --- | --- |
| Local-only hotspot | Kotlin plugin |
| Join the Wi-Fi from a QR scan | Kotlin plugin |
| Wi-Fi Direct | Kotlin plugin |
| NFC | Community plugins exist; host card emulation needs your own |
| Background transfers | A foreground service or UIDT job declared in the manifest |
| Fast storage | A Kotlin plugin that streams to `MediaStore` |
| Share sheet | An intent filter plus a small plugin to hand the file URIs to JavaScript |

**Effort.** Low to start: a debug APK takes about an hour. Each native feature is a small Kotlin plugin, usually 100 to 300 lines. You maintain one web codebase plus a thin Android shell, and Capacitor majors arrive about once a year.

**Size and performance.** The release APK is typically a few MB, because the WebView is shared with the system. UI performance is as good as the web app. Data-channel throughput is WebRTC's, which is plenty for phones. Moving to a native TCP socket later would only matter for very large files.

**iPhone later.** Yes, `npx cap add ios`. The Kotlin plugins would need Swift equivalents, and iOS has different rules: no local-only hotspot API, `NEHotspotConfiguration` to join Wi-Fi, and Multipeer Connectivity instead of Wi-Fi Direct.

**Build commands.**

Debug APK:

```
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

Signed release APK, after adding a `signingConfig` in `android/app/build.gradle` as described in [the signing section](#signing-keys):

```
./gradlew assembleRelease
```

AAB for the Play Store:

```
./gradlew bundleRelease
```

Android Studio can also do both: Build › Generate Signed App Bundle / APK.

---

## Option 2: Trusted Web Activity (Bubblewrap or PWABuilder)

**How it works.** A tiny Android app that opens the deployed site (`https://stub-black.vercel.app`) full screen in Chrome, with no address bar. It's the PWA with an APK wrapper. The site proves it owns the app with a `/.well-known/assetlinks.json` file. Bubblewrap is the CLI (v1.27.0); PWABuilder is a website that uses Bubblewrap.

**Code reused.** 100%. Nothing changes except adding `assetlinks.json`.

**Native capabilities.** It's still Chrome, so almost none:

| Need | TWA |
| --- | --- |
| Local-only hotspot | No |
| Join the Wi-Fi from a QR scan | No |
| Wi-Fi Direct | No |
| NFC | Partly. Chrome's Web NFC reads and writes NDEF tags, but there's no phone-to-phone NFC |
| Background transfers | No. Transfers pause when Chrome is in the background |
| Fast storage | No. Same limits as the website, so files are held in memory |
| Share sheet | Yes, through the Web Share Target manifest field. Bubblewrap supports this, but check file sharing on your Chrome version |

It also needs Chrome, or another browser that supports TWAs, installed on the phone.

**Effort.** Lowest of all, under an hour. The app updates whenever the website does.

**Size and performance.** The APK is about 1 MB. Performance is the same as the website in Chrome.

**iPhone later.** No. iOS has no TWA equivalent; iPhone users would add the PWA to their home screen.

**Build commands.**

```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://stub-black.vercel.app/manifest.webmanifest
bubblewrap build
```

`bubblewrap build` creates a signing key on first run and outputs both `app-release-signed.apk` and `app-release-bundle.aab`. There's no separate debug build; you install the signed APK.

**Watch out.** Google Play requires target API 36 for new apps and updates from 31 August 2026, with extensions to 1 November 2026. A PWABuilder issue reported that the Bubblewrap template targeted API 35. Check `targetSdkVersion` in the generated project before uploading.

---

## Option 3: Tauri 2 (mobile)

**How it works.** It's like Capacitor (a web UI in the system WebView), but the app's core is written in Rust. Native Android features come from Rust or from Kotlin plugins. Current CLI: 2.12.2. Mobile support became stable with Tauri 2.0 in October 2024. The team said then that not every desktop feature had reached mobile yet, so check the plugin list before relying on one.

**Code reused.** The UI is reused fully. The TypeScript `pairing/` and `transfer/` code can stay as is, or move to Rust later so the same core also runs in a desktop app.

**Native capabilities.** All of them, through Kotlin plugins called from Rust. An official NFC plugin and a barcode-scanner plugin exist. Hotspot, Wi-Fi joining, Wi-Fi Direct, the background service and the share sheet are custom Kotlin, as with Capacitor. Fast storage can be done in Rust for app-private files; the shared Downloads folder still needs Kotlin.

**Effort.** Medium to high. You need Rust and the Android NDK toolchain, slower builds, a smaller mobile ecosystem than Capacitor, and three languages: TypeScript, Rust and Kotlin.

**Size and performance.** The APK is larger than Capacitor's, because a compiled Rust library ships for each CPU type. It's typically several MB per ABI; build per-ABI or as an AAB. Performance is excellent if the transfer moves to Rust.

**iPhone later.** Yes (`tauri ios`), with Swift plugins. Bonus: the same Rust core gives you Windows, macOS and Linux apps.

**Build commands.**

```
npx tauri android init
npx tauri android build --apk --debug
```

For a signed release, configure signing in Gradle, then run `npx tauri android build --apk` for the APK and `npx tauri android build --aab` for the AAB.

---

## Option 4: Rewrite in Flutter or React Native

**How it works.** A new app with native UI. Flutter draws its own UI in Dart. React Native renders real Android views from TypeScript; Expo is the usual way to run it.

**Code reused.**
- **Flutter:** none of the code. The design (colours, type, the ticket idea) and the protocol (message types, chunk format) carry over as a spec.
- **React Native:** some of the TypeScript logic in `pairing/` and `transfer/`, roughly a third of the code. It would need `react-native-webrtc` and polyfills for `crypto.subtle`. All UI is rewritten.

**Native capabilities.** All of them. Both have mature ways to write Kotlin native code (Flutter platform channels, Expo modules). Community packages exist for Wi-Fi, NFC and background work, but expect to write your own Kotlin for the local-only hotspot and for user-initiated data transfer jobs.

**Effort.** High. It's a rebuild of every screen, and two codebases if the website stays. Current versions: React Native 0.87, Expo 57.

**Size and performance.** Larger APKs than Capacitor (the Flutter engine or the React Native/Hermes runtime), typically around 8 to 15 MB. Native-feeling scrolling and animation.

**iPhone later.** Yes, both.

**Build commands.**

Flutter:
- Debug APK: `flutter build apk --debug`
- Signed release APK: `flutter build apk --release`
- AAB: `flutter build appbundle`

React Native:
- Debug APK: `cd android && ./gradlew assembleDebug`
- Signed release APK: `./gradlew assembleRelease`
- AAB: `./gradlew bundleRelease`
- With Expo, `eas build -p android` does the same; an APK profile gives an APK and production gives an AAB.

---

## Option 5: other options worth knowing

**5a. Install the PWA from Chrome (WebAPK).** This works today with zero work. When a user taps "Install app" in Chrome, Chrome builds a signed WebAPK for them, so Stub appears in the launcher and can appear in the share sheet through Web Share Target. There's no APK file you can hand out, and it has the same limits as a TWA. It's useful as a stopgap.

**5b. Native Kotlin (Jetpack Compose).** Write the Android app directly. It has the best access to every API, the smallest native APK and the best background behaviour. It reuses nothing but the design and the protocol, and there's no iPhone app. **Kotlin Multiplatform** shares the logic with iOS, but the iOS UI is still separate (or Compose Multiplatform).

**5c. Google Nearby Connections as the transport.** This applies to any option with native code. It's a Google Play services API that finds nearby phones and moves data over Bluetooth and Wi-Fi offline, choosing the radio itself. It could replace QR pairing and the hotspot logic on Android. It needs Google Play services on both phones, so it won't work on phones without Google, and it ties you to Google's SDK. It's a good add-on to Option 1 later, not a starting point.

---

## Comparison

| | Capacitor | TWA | Tauri 2 | Flutter / RN | Native Kotlin |
| --- | --- | --- | --- | --- | --- |
| Current code reused | ~100% to start | 100% | UI 100%, core optional | Flutter 0%, RN ~⅓ logic | 0% |
| Local-only hotspot | Plugin | No | Plugin | Native code | Yes |
| Join Wi-Fi from QR | Plugin | No | Plugin | Native code | Yes |
| Wi-Fi Direct | Plugin | No | Plugin | Native code | Yes |
| NFC | Plugin | Tags only (Web NFC) | Official plugin | Package or native | Yes |
| Background transfer | Yes | No | Yes | Yes | Yes |
| Fast large-file storage | Native plugin | No (memory) | Rust or Kotlin | Yes | Yes |
| Share sheet | Yes | Yes (Web Share Target) | Yes | Yes | Yes |
| First debug APK | ~1 hour | ~30 min | Half a day | Weeks (rewrite) | Weeks (rewrite) |
| Ongoing maintenance | Low | Very low | Medium | High (two codebases) | High (two codebases) |
| APK size | A few MB | ~1 MB | Several MB per ABI | ~8–15 MB | Smallest native |
| iPhone app later | Yes | No | Yes (+ desktop) | Yes | No (KMP: partly) |

Sizes are typical ranges for these frameworks, not measured builds of Stub.

---

## Recommendation: Capacitor

1. **It's the only option that keeps all of today's code and still unlocks every native feature.** The UI, pairing and transfer modules run unchanged in the WebView on day one, and each native feature is a small Kotlin plugin added one at a time.
2. **The architecture was built for it.** `pairing/` returns a `Link { channel, code, close }` and `transfer/` only needs a data channel, so native transports (hotspot, Wi-Fi Direct, Nearby later) can be added as more `Link` providers without touching the UI.
3. **It's the lowest-risk path to an iPhone app.** One web codebase plus thin native shells.
4. **TWA is too limited for this app.** Hotspot creation, Wi-Fi auto-join and background transfer are the whole reason for going native, and a TWA can do none of them.
5. **Tauri is the runner-up.** Pick it if you also want desktop apps and are happy to work in Rust. It costs more build tooling and has a smaller mobile ecosystem for the same Android features.
6. **A rewrite isn't worth it yet.** Flutter or React Native would rebuild what already works. Revisit only if the WebView ever becomes the bottleneck.

Suggested order once you say go:
1. **Wrap.** Get a debug APK of today's app.
2. **Save files natively.** Blob downloads don't work in Android WebView, so this comes first.
3. **Background transfers.** A foreground service or UIDT job.
4. **Share sheet.**
5. **Local-only hotspot and Wi-Fi join from QR.**
6. **Wi-Fi Direct and NFC.**

---

## First debug APK with Capacitor, step by step

Prerequisites, installed once:
1. Node 22 or newer (this machine has Node 24).
2. [Android Studio](https://developer.android.com/studio). It includes the JDK and the Android SDK.
3. Set `ANDROID_HOME` to the SDK path, usually `%LOCALAPPDATA%\Android\Sdk`. Add `platform-tools` to `PATH` for `adb`.

Then, from the `stub` folder:

```bash
npm install @capacitor/core @capacitor/android
```

```bash
npm install -D @capacitor/cli
```

```bash
npx cap init Stub com.abivan.stub --web-dir dist
```

```bash
npm run build
```

```bash
npx cap add android
```

Allow the camera. Add this line to `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

```bash
npx cap sync android
```

```bash
cd android && .\gradlew.bat assembleDebug
```

The APK is now at `android\app\build\outputs\apk\debug\app-debug.apk`. To install it on a phone with USB debugging on:

```bash
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Or copy the APK to the phone and open it. The phone will ask to allow installs from that source.

Known gaps in this first APK, until the plugins exist:
- **Save and Open don't work.** Android WebView ignores `<a download>` for blob URLs.
- **The PWA service worker is useless inside the app.** It's harmless, because the files are already local.
- **Transfers stop when the app is backgrounded.**

After any web change, run `npm run build`, then `npx cap sync android`, then rebuild.

---

## Signing keys

Every APK and AAB must be signed. Android only accepts an update if it's signed with the **same key** as the installed app. **If you lose the key, you can't update the app**; users would have to uninstall and reinstall.

1. **Create one** (it asks for a password; store it in a password manager):

   ```
   keytool -genkeypair -v -keystore stub-release.jks -alias stub -keyalg RSA -keysize 4096 -validity 10000
   ```

   `keytool` comes with Android Studio's JDK.
2. **Back it up.** Keep the `.jks` file and its passwords in at least two safe places, such as a password manager plus an offline drive.
3. **Never commit it to git.** Add `*.jks`, `*.keystore` and `keystore.properties` to `.gitignore`. Point Gradle at them through `keystore.properties` or environment variables, not hard-coded passwords. On CI, use encrypted secrets.
4. **For Google Play,** enrol in **Play App Signing**. Google keeps the real app-signing key, and your key becomes an *upload key*. If the upload key is lost, Google can reset it, which makes the Play route much safer. Sideloaded APKs still depend entirely on your own key.

## Google's Android developer verification (sideloaded apps)

Google now requires apps on certified Android devices to come from a verified developer. That includes apps installed outside Google Play.

- **August 2026:** developer APIs, *limited distribution accounts*, and an "advanced flow" for power users who want to install unverified apps were launched.
- **30 September 2026:** enforcement began for installs from participating stores on certified devices running Android 7+ in **Brazil, Indonesia, Singapore and Thailand**.
- **2027:** verification expands globally for all apps on certified Android devices.
- **How to register:**
  - **Only outside Play:** register through the **Android Developer Console**.
  - **On Play:** register through **Play Console**, where most Play apps are registered automatically.
  - You verify your identity and register the app's package name (`com.abivan.stub`). Choose that name carefully; it's permanent.
- **Limited distribution accounts:** students, teachers and hobbyists can share an app with **up to 20 devices without a government ID or registration fee**. That fits testing Stub with friends.
- **Not confirmed:** Google's page doesn't say whether `adb install` of debug builds is exempt. Check the developer verification FAQ before sharing APKs widely.

What this means for Stub:
- Debug APKs on your own phones are fine.
- Before handing the APK to other people, especially in 2027 or in the four launch countries, register as a developer and register `com.abivan.stub`.

## Sources

- [Android developer verification](https://developer.android.com/developer-verification)
- [Help Net Security: verification rollout markets](https://www.helpnetsecurity.com/2026/06/19/android-developer-verification-rollout-markets/)
- [Android Authority: sideloading timeline](https://www.androidauthority.com/android-sideloading-changes-timeline-3679204/)
- [Local-only hotspot](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot)
- [Wi-Fi Network Request API (peer-to-peer)](https://developer.android.com/develop/connectivity/wifi/wifi-bootstrap)
- [Foreground service timeouts (Android 15)](https://developer.android.com/develop/background-work/services/fg-service-timeout)
- [Android 15 behaviour changes](https://developer.android.com/about/versions/15/behavior-changes-15)
- [User-initiated data transfer](https://developer.android.com/develop/background-work/background-tasks/uidt)
- [Google Maps moved downloads to UIDT](https://android-developers.googleblog.com/2024/09/google-maps-improved-download-reliability-user-initiated-data-transfer-api.html)
- [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
- [PWABuilder Android platform](https://blog.pwabuilder.com/docs/android-platform/)
- [Tauri 2.0 release candidate notes](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/)
- [Tauri 2.0.0-alpha.4: Kotlin plugins](https://v2.tauri.app/blog/tauri-2-0-0-alpha-4/)
- Versions from npm on 13 October 2026: `@capacitor/core` 8.5.3, `@tauri-apps/cli` 2.12.2, `@bubblewrap/cli` 1.27.0, `react-native` 0.87.1, `expo` 57.0.28.
