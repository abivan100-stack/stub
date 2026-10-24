# Stub: notes for Claude

Read this first. README.md explains the product and code; this file is the working status.

**Keep it current:** every change you commit must update "Status" and "Recent changes" below in the same commit.

## Working rules

- Commit and push after each step. The owner says "commit push and merge" to mean: branch, PR, merge into `main`.
- No attribution lines in commits or PRs.
- Ask before adding any dependency over ~50 KB.
- Never commit signing keys (`*.jks`, `*.keystore`, `keystore.properties` are ignored).
- Commit only after the checks pass: `npm test`, `npm run check`, `npm run test:e2e`, and `cd android && ./gradlew testDebugUnitTest assembleDebug`.
- Build env on this PC (Windows): JDK 21 and the SDK in `%LOCALAPPDATA%\Android\Sdk`. Set `ANDROID_HOME` to it and `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`.
- After a native or web change, run `npm run build && npx cap sync android`, then `assembleDebug`. Copy the APK to `Stub-debug.apk` in the repo root (git-ignored) and send it to the owner. It installs over the old app because it uses the same debug key from this PC.
- Pushing to `main` deploys the website to https://stub-black.vercel.app (Vercel, git-connected).

## Status (2026-10-17)

Works on real devices (confirmed by the owner):
- QR pairing (Send/Receive, WebRTC) on a shared Wi-Fi.
- Phone app + laptop through **Connect another device** (WebSocket relay via the phone's server): on a shared Wi-Fi and on the phone's own regular hotspot.

Not yet confirmed on hardware:
- Stub's **Make a hotspot**. It now starts a regular local-only hotspot first, because Windows refuses `DIRECT-` Wi-Fi Direct networks. The owner hit that error before the change.
- NFC tap-to-pair, Wi-Fi Direct, background transfers over 1 GB.

Open questions / ideas not started:
- If a laptop can't see the local-only hotspot, the phone may have put it on 6 GHz. Ask for the band shown on the phone.
- APK updates are manual (install over the old one). Options discussed but not chosen: an in-app "update available" check, live web-code updates, or Play internal testing.
- versionCode is still 1 in `android/app/build.gradle`.

## Recent changes (newest first)

- Home ticket: the bottom border of the Send/Receive ticket is thicker (3× the rule width, `.pass` in `Home.svelte`).
- Serif type: Fraunces (variable, self-hosted `fraunces-wght.woff2`, OFL) for headings and body, replacing Archivo. DM Mono stays for codes and numbers. Archivo file removed. Splash wordmark uses Fraunces too.
- Smooth animations:
  - Staggered section entrance (`main > *` in `app.css`), held by the `.splashing` class until the loading ticket tears.
  - Tickets print in (`issue`), and the VOID stamp lands.
  - Expandable sections (`<details>`) ease open (`interpolate-size`).
  - Buttons lift on hover.
- Theme switch on Home: Auto / Light / Dark.
  - The choice is saved in `localStorage` as `stub-theme` and applied before first paint by the inline script in `index.html`.
  - It switches with a circular View Transition reveal (`src/ui/theme.ts`).
  - CSS: dark tokens under `:root:not([data-theme='light'])` (media query) and `:root[data-theme='dark']`.
  - Also fixed a 3 px page overflow at 360 px (the Home grids now use `minmax(0, 1fr)`).
- Loading screen: a ticket prints (wordmark + 10-step gauge), then tears away. It's about 2 s, inline in `index.html` (`#splash`), and `main.ts` tears it at 1.6 s.
- Front-end polish:
  - The file queue no longer widens the page on phones (the stamp sits inside the ticket's top section).
  - The repeated "Verified" line is hidden (it stays for screen readers).
  - The header shows a live dot and a labelled code.
  - Each screen slides in.
  - Centred hint text stays centred.
  - Troubleshooting IPs no longer split mid-number.
- `README` + this file: documented the relay fixes, the hotspot order and how APK updates work.
- `34f0079` Make a hotspot: local-only hotspot first, Wi-Fi Direct as fallback; switch buttons both ways (`hotspot.ts` `switchHotspot`, `HostFlow.svelte`).
- `6316d75` Phone shows the 6-digit code only after the guest's WebSocket opens (`StubHostServer.relay` calls `pairing.guest`, not `pair`).
- `085a2c3` Phone codes list only Wi-Fi/hotspot/USB interfaces (an allowlist in `StubHostPlugin.addresses`). The guest retries the relay socket 3 times with a distinct error.
- `c66b0fa` WebSocket relay through the phone, because WebView WebRTC can't use networks the phone broadcasts.
