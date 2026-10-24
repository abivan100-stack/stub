# Stub

Pass files straight between two devices on the same Wi-Fi or hotspot. No internet, no account, no server, nothing uploaded.

- **Website:** https://stub-black.vercel.app. Open it once while online; after that it works offline.
- **Android app:** build it from `android/` (see [Android app](#android-app)). It adds a hotspot of its own, background transfers, the share sheet, NFC tap-to-pair and "Connect a laptop".

The website and the app work together: any pair of them can connect, in either direction.

## Ways to pair

| Situation | What to do |
| --- | --- |
| Both on the same Wi-Fi | One taps **Send**, the other **Receive**, and they scan each other's QR code. |
| No shared Wi-Fi, or a phone is the hotspot (Android app) | On the phone tap **Connect another device**, then **Make a hotspot** (or, on the Send screen, **Connect through this phone**). The other device scans the Wi-Fi QR code to join, then the connect QR code, with Stub's Receive or any camera app. |
| Phone (app) + laptop | On the phone tap **Connect another device**. It shows a 7-character code like `7KQ-2MX4`. On the laptop, open the Stub website and type it into **Got a code from a phone?**. |
| Laptop has never opened the Stub site | On the phone's Connect screen, open **Type an address instead**. Type the address (like `192.168.0.177:8080`) into the laptop's address bar, then the PIN. The phone serves Stub itself. |
| Two Android phones with NFC | Hold them back to back instead of scanning the first code. |
| A camera won't scan | Tap the QR code to show it full screen, or use **Can't scan? Send the code as text** (about 100 characters to copy and paste). |

After any of these, both screens show the same 6 digits. Tap **Match** on both: if they differ, another device got in the middle, so tap **Doesn't match**.

## How it works

### Pairing

1. **Send** creates an `RTCPeerConnection` with `iceServers: []` (no STUN or TURN; only the local link), opens a data channel, and waits for ICE gathering to finish, so one code carries everything.
2. Only the values that change per session are kept: ICE ufrag and password, the DTLS fingerprint, setup role, mid and host candidates. They're packed as bytes (fingerprint 32 bytes, each address 4 or 16 bytes plus a 2-byte port) and the rest of the SDP is rebuilt from a fixed template on the other side ([`sdp.ts`](src/pairing/sdp.ts)).
   - **QR form:** base32 behind an uppercase type letter. Every character is in QR's alphanumeric set, so the code has fewer, larger squares.
   - **Text form:** base64url, about 100 characters.
3. A code too long for one QR cycles through numbered frames (`2/3:…`), and the scanner collects them in any order. A code that fits is shown as is.
4. **Receive** scans the offer, makes an answer and shows it as a QR code. Send scans that, and the channel opens.
5. Both screens show a 6-digit code derived from both DTLS fingerprints ([`code.ts`](src/pairing/code.ts)).

**When a phone is the hotspot**, WebRTC can't be used: Android's WebView only uses networks that Android's ConnectivityManager knows about, and a network the phone broadcasts (its regular hotspot, Stub's local-only hotspot, or a Wi-Fi Direct group) isn't one. So everything paired through **Connect another device** goes through the phone instead. Its server ([`StubHostServer.java`](android/app/src/main/java/com/abivan/stub/StubHostServer.java)) issues a session token for the right PIN, and both devices open a WebSocket to `/__stub/ws`, which passes frames between them. [`relay.ts`](src/pairing/relay.ts) makes that WebSocket look like a data channel, so the transfer protocol is unchanged. The 6-digit check comes from the session token. The traffic is protected by the hotspot's WPA2 rather than WebRTC's DTLS.

Before making a code, Stub asks for the camera. Without camera permission, browsers hide local IP addresses behind `.local` names that hotspots often can't resolve. If pairing fails, the error screen's **Details for troubleshooting** lists the addresses each side tried.

### File transfer

- Batches go out as an offer (names, sizes, types), which the receiver accepts or declines.
- Files go one at a time per direction (both directions can run at once), in 64 KB chunks over an ordered data channel. Sending pauses above 4 MB `bufferedAmount` and resumes at `bufferedamountlow` (1 MB).
- Each chunk frame is `[u32 index][SHA-256][data]`. The receiver checks every chunk, then a final hash over all chunk hashes. Only then is the ticket stamped **Verified**.
- Where received files go:
  - **Android app:** `Download/Stub`.
  - **Chromium:** a batch over 100 MB is streamed to a folder you pick.
  - **Elsewhere:** held in memory, with a warning above 500 MB.
- Each file has progress, live speed, ETA, cancel and retry.
- Pages served over plain `http` (the laptop path) have no WebCrypto, so Stub falls back to a built-in SHA-256 ([`sha256.ts`](src/sha256.ts)).

## Android app

[Capacitor](https://capacitorjs.com) wraps the same web build in a native app, `com.abivan.stub`. Every file ships in the APK, so it's offline from the first launch. [docs/android-app-options.md](docs/android-app-options.md) explains why Capacitor over a TWA, Tauri, Flutter or React Native.

| Feature | How | Code |
| --- | --- | --- |
| Save received files | Streamed into `Download/Stub` through MediaStore (Android 10+, no storage permission). Android 7 to 9 use Stub's own folder. **Open** hands a file to another app. | [`StubFilesPlugin.java`](android/app/src/main/java/com/abivan/stub/StubFilesPlugin.java) |
| Background transfers | A foreground service with a progress notification holds a CPU wake lock and a Wi-Fi lock, so transfers keep going with the screen off. Android 15+ allows 6 hours a day of this. | [`TransferService.java`](android/app/src/main/java/com/abivan/stub/TransferService.java) |
| Share sheet | **Share → Stub** from any app. Files wait on the home screen, then go into the Send prompt once paired. | [`StubSharePlugin.java`](android/app/src/main/java/com/abivan/stub/StubSharePlugin.java) |
| Make a hotspot | A local-only hotspot, with a Wi-Fi Direct network as the fallback. Windows won't join Wi-Fi Direct networks (Android names them `DIRECT-...`), so the hotspot comes first. **Can't see this Wi-Fi? Switch to 2.4 GHz** swaps in Wi-Fi Direct pinned to 2.4 GHz, for phones that can't see a 5 or 6 GHz hotspot. **Laptop says it can't connect? Switch to a regular hotspot** swaps back. The service keeps the network up while you're in Settings. | [`StubWifiPlugin.java`](android/app/src/main/java/com/abivan/stub/StubWifiPlugin.java) |
| Join from a Wi-Fi QR | Android 10+ joins automatically after one system prompt. Older versions, and the website, show the name and password. | same |
| NFC tap-to-pair | The sending phone poses as an NFC tag holding its code (plus Wi-Fi details); the receiver reads it. The reply goes back by QR. | [`StubTagService.java`](android/app/src/main/java/com/abivan/stub/StubTagService.java), [`StubNfcPlugin.java`](android/app/src/main/java/com/abivan/stub/StubNfcPlugin.java) |
| Connect another device | A small server on port 8080 serves Stub, checks a 4-digit PIN, and relays the transfer over WebSocket, so it works on any network the phone is on, including its own hotspot. Five wrong PINs lock it, one device only, and it stops taking new devices once paired. The phone moves to the 6-digit check only once the other device's WebSocket is open, so a half-made connection never shows a code on one side only. The address in the codes is only ever the phone's Wi-Fi, hotspot or USB address (an allowlist of interface names), never mobile data. The connect QR and the 7-character code both carry address, port and PIN; the PIN travels in the URL `#fragment`, which never leaves the browser. | [`StubHostServer.java`](android/app/src/main/java/com/abivan/stub/StubHostServer.java), [`relay.ts`](src/pairing/relay.ts), [`directcode.ts`](src/pairing/directcode.ts) |
| Readable QR | Full brightness and no screen timeout while a code is showing. | [`StubScreenPlugin.java`](android/app/src/main/java/com/abivan/stub/StubScreenPlugin.java) |

Permissions are asked when first needed:
- **Camera:** for scanning.
- **Notifications:** for transfer progress.
- **Nearby devices** (Android 13+), or **Location** (Android 8 to 12): for the hotspot and Wi-Fi Direct.

### Build the APK

You need JDK 21 and the Android SDK (platform 36, build-tools, platform-tools); Android Studio includes both. Set `ANDROID_HOME` to the SDK folder and `JAVA_HOME` to JDK 21.

```bash
npm run build
```

```bash
npx cap sync android
```

```bash
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone and open it, or run `adb install -r <apk>`.

A newer APK installs over the old one as an update (app and permissions kept) as long as it's signed with the same key. Debug builds use the debug key of the PC that built them, so build updates on the same PC, or switch to a release key.

For a release build, create a signing key and keep it out of git. `*.jks`, `*.keystore` and `keystore.properties` are already ignored. [docs/android-app-options.md](docs/android-app-options.md#signing-keys) covers keys, Play App Signing and Google's developer verification.

If Gradle or `sdkmanager` fails with an SSL error behind antivirus HTTPS scanning, set `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` so Java uses the Windows certificate store.

## Code layout

```
src/
  pairing/        how two devices find each other. No UI imports.
    session.ts      createOffer / acceptOffer → Link { channel, code, close }
    sdp.ts          SDP ↔ ~100-character code (text) or base32 (QR)
    frames.ts       multi-frame QR split and collect
    code.ts         6-digit verification code from DTLS fingerprints
    wifi.ts         standard Wi-Fi QR format
    hotspot.ts      make or join a network (Android app)
    nfc.ts          tap-to-pair (Android app)
    host.ts         Connect another device: phone side and guest side
    relay.ts        WebSocket through the phone, shaped like a data channel
    directcode.ts   address + port + PIN ↔ 7-character code
  transfer/       file protocol over any RTCDataChannel. No UI imports.
    peer.ts         offers, queue, chunks, verification, cancel and retry
    chunk.ts        chunk framing and hashing
    sink.ts         where received bytes go (memory or a folder)
    native.ts       Android: Download/Stub, background service, share sheet
  sha256.ts       WebCrypto, or plain JS where there is none
  ui/             Svelte screens
  App.svelte      home → pair → verify → transfer
android/app/src/main/java/com/abivan/stub/   the native plugins listed above
```

`pairing/` hands back a `Link` with a data channel, and `transfer/` only needs that. A new transport (Wi-Fi Direct sockets, Nearby Connections) can return the same shape without touching the UI.

## Design

A printed ticket: card stock, black ink, one safety-orange signal.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#e6e3da` | `#191a18` | background |
| `--slip` | `#f4f2ec` | `#232421` | ticket surfaces |
| `--ink` | `#1b1a17` | `#e9e5db` | text and rules |
| `--ink-2` | `#57544c` | `#a8a499` | secondary text (AA on page) |
| `--signal` | `#ff5b14` | `#ff6a2b` | primary action, live progress (ink text on it) |
| `--stamp` | `#b83a08` | `#ff8a50` | the "Verified" stamp |

- **Type:** Fraunces (variable serif) for headings and body; DM Mono for sizes, speeds, codes and ticket numbers. Both are self-hosted in `src/assets/fonts` (SIL OFL).
- **Shape:** 3 px corners, 1.5 px rules, perforated tear lines with punched notches. No shadows except the hard edge buttons press into.
- **Motion:**
  - A loading ticket prints its gauge, then tears to reveal the app (about 2 s).
  - Screen sections arrive in a short stagger.
  - New tickets print in from the top.
  - The progress gauge steps, the verification digits print in, and the VERIFIED and VOID stamps land.
  - Expandable sections ease open, and buttons lift under a mouse.
  - All of it is off under `prefers-reduced-motion`.
- **Theme:** Auto, Light or Dark from the switch on Home. The new colours grow as a circle from the switch (View Transitions, where supported).

## Develop and test

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves HTTPS with a self-signed certificate on all interfaces, because the camera needs a secure context. Open the printed `Network:` URL on each phone and accept the warning. `npm run dev:http` serves plain HTTP on `localhost:5174` for one machine and the e2e tests.

| Command | What it checks |
| --- | --- |
| `npm test` | Vitest: SDP packing, base32, frames, verification code, Wi-Fi QR, short codes, SHA-256, chunking, the Peer protocol, the native sink and the hotspot fallback order |
| `npm run check` | svelte-check and strict TypeScript |
| `npm run test:e2e` | Playwright: two browsers pair and send verified files; the Wi-Fi QR path; the error details; a laptop pairing through the phone over plain `http`; the short phone code |
| `cd android && ./gradlew testDebugUnitTest` | JVM tests: the NFC tag protocol, and the phone's server (PIN, lockout, one device, safe paths, WebSocket handshake, relaying 64 KB frames both ways, ping, close, wrong tokens) |

Before the first e2e run, install the browser with `npx playwright install chromium`.

### On real devices

1. Open the website (or install the APK) on both devices while online. The home screen shows **Works offline** once the website is cached.
2. On the hotspot phone, turn mobile data **off**.
3. Pair each way: same Wi-Fi, **Make a hotspot**, **Connect another device** with the short code, and NFC.
4. Send something over 1 GB with the screen off. Cancel one file mid-way, retry it, and send a file back the other way.

## Deploy

`npm run build` writes a static site to `dist/`. The live site is on Vercel, connected to this repo: every push to `main` deploys to https://stub-black.vercel.app. Any static host works (Cloudflare Pages, Netlify: build `npm run build`, output `dist`). It must be served over HTTPS for the camera and the service worker.

The website updates on every push, but an installed APK doesn't. Keep both on the same commit when the pairing format changes.

## Known limits

- **Tested on real devices:** QR pairing on a shared Wi-Fi, and phone + laptop through **Connect another device** on a shared Wi-Fi and on the phone's own regular hotspot. **Not yet:** Stub's **Make a hotspot** (local-only hotspot), NFC tags and Wi-Fi Direct. The laptop end of the relay was also checked against the real server code in desktop Chrome.
- **Windows can't join Wi-Fi Direct networks** (`DIRECT-...`). That's why **Make a hotspot** starts a regular local-only hotspot; use the 2.4 GHz switch only for a phone that can't see it.
- **When a phone is the hotspot, pair with Connect another device.** The QR scan pairing (Send/Receive) uses WebRTC, which doesn't work from the phone that runs the hotspot.
- **Browsers keep received files in memory** except Chromium's folder streaming. iOS Safari can kill the tab above a few hundred MB.
- **Guest and public Wi-Fi** often keep devices apart. Use **Make a hotspot**, or a phone or home hotspot.
- **The Connect-a-laptop short code** needs the laptop to have opened the Stub website before, because a hotspot has no internet. The typed address works without that.
- **Sharing very large files into the app** copies each one into memory before sending.
- **Background time:** Android 15+ allows about 6 hours a day of background transfer; after that, transfers continue only while Stub is open.
