# Stub

Send files between two devices on the same Wi-Fi or hotspot. They pair by scanning QR codes and talk directly over WebRTC. No server, no internet, nothing uploaded.

After the first visit the app is fully cached by a service worker (fonts and the QR scanner worker included), so it works on a router with no uplink, or on a phone hotspot with mobile data turned off.

## How it works

1. **Send** creates an `RTCPeerConnection` with `iceServers: []`, opens a data channel, and waits for ICE gathering to finish, so one code carries everything.
2. The offer is packed into a QR code. Only the per-session values are kept (ICE ufrag/pwd, DTLS fingerprint, setup role, mid, host candidates); the rest of the SDP is rebuilt from a fixed template on the other side. The packed text is deflated with `CompressionStream('deflate-raw')` and base64url-encoded. A typical offer is under 320 characters, which fits one QR code.
3. If the payload is longer than 320 characters, the QR cycles through numbered frames (`2/3:...`). The scanner collects them in any order.
4. **Receive** scans the offer, makes an answer, and shows it as a QR code. Send scans that, and the channel opens.
5. Both screens show a 6-digit code derived from both DTLS fingerprints. If they differ, someone else is in the middle, and the user taps "Doesn't match".

Every QR has a text fallback (copy, then paste) for when a camera isn't available.

### File transfer

- Batches go out as an offer (names, sizes, types). The receiver accepts or declines.
- Files go one at a time per direction, in 64 KB chunks over an ordered data channel. Sending pauses above 4 MB `bufferedAmount` and resumes at `bufferedamountlow` (1 MB).
- Each chunk frame is `[u32 index][SHA-256][data]`. The receiver checks every chunk, then checks a final manifest hash over all chunk hashes. Only then does the ticket get stamped "Verified".
- On Chromium, a batch over 100 MB asks for a folder (`showDirectoryPicker`), and files are streamed straight to disk. Elsewhere, files are held in memory as Blobs, with a warning when a file is over 500 MB.
- Each file has progress, live speed, ETA, cancel and retry, in either direction.

## Code layout

```
src/
  pairing/     offline WebRTC signalling over QR. No UI imports.
    session.ts   createOffer / acceptOffer → Link { channel, code, close }
    sdp.ts       SDP pack + deflate + base64url
    frames.ts    multi-frame QR split/collect
    code.ts      verification code from DTLS fingerprints
  transfer/    file protocol over any RTCDataChannel. No UI imports.
    peer.ts      Peer: offers, queue, chunks, verification, cancel/retry
    chunk.ts     chunk framing and hashing
    sink.ts      where received bytes go (memory or a folder on disk)
  ui/          Svelte screens and components
  App.svelte   screen state: home → pair → verify → transfer
```

`pairing/` hands back a `Link` with a data channel. A native transport (Capacitor or Tauri) can return the same shape and `transfer/` will not notice.

## Design

The direction is a printed ticket: card stock, black ink, one safety-orange signal.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#e6e3da` | `#191a18` | background |
| `--slip` | `#f4f2ec` | `#232421` | ticket surfaces |
| `--ink` | `#1b1a17` | `#e9e5db` | text and rules |
| `--ink-2` | `#57544c` | `#a8a499` | secondary text (AA on page) |
| `--signal` | `#ff5b14` | `#ff6a2b` | primary action, live progress (ink text on it) |
| `--stamp` | `#b83a08` | `#ff8a50` | the "Verified" stamp |

- Type: Archivo (variable width) for headings, set narrow at 62 to 70% width, and DM Mono for sizes, speeds, codes and ticket numbers. Both are self-hosted in `src/assets/fonts` (SIL OFL).
- Shape: 3 px corners, 1.5 px rules, perforated tear lines with punched notches. No shadows, except the hard offset edge under buttons that they press into.
- Motion: the progress gauge moves in small steps, the verification digits print in one at a time, and the stamp lands when a file is verified. All of it is off under `prefers-reduced-motion`.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` serves HTTPS with a self-signed certificate on all interfaces, because the camera needs a secure context. Vite prints a `Network:` URL like `https://192.168.1.20:5173`. Open that on each phone and accept the certificate warning.

`npm run dev:http` serves plain HTTP on `localhost:5174`. localhost counts as a secure context, so this is fine on one machine and is what the e2e test uses.

```bash
npm test           # Vitest: SDP packing, frames, verification code, chunking, hashing, Peer protocol
npm run check      # svelte-check + TypeScript strict
npm run test:e2e   # Playwright: two browser contexts pair and transfer a file end to end
```

Before the first e2e run, install the browser with `npx playwright install chromium`.

## Testing on two phones

1. Turn on a hotspot on phone A, turn its mobile data **off**, and join it from phone B (or a laptop).
2. Load the dev URL (or the deployed site) on both while you still have a network, so the service worker caches the app. The home screen shows "Works offline" once it has.
3. On A tap Send, on B tap Receive, and scan each other's codes. Check that both show the same six digits.
4. Send something large (over 1 GB) and something small, cancel one mid-way, retry it, and send a file back from B to A.

## Deploy

`npm run build` writes a static site to `dist/`. Any static host works.

- **Cloudflare Pages:** build command `npm run build`, output directory `dist`.
- **Netlify:** the same settings, or `npx netlify deploy --dir=dist --prod`.

The site must be served over HTTPS for the camera and the service worker. Users need to open it once online. After that, it runs without a network.

## Known limits

- **iOS Safari:** there's no File System Access API, so received files are held in memory. Above a few hundred MB the tab can be killed. Received files are saved through the share/download sheet. Install to the home screen for the most reliable offline start.
- **Firefox and Safari** keep received files in memory for the same reason. Chromium-based browsers stream large batches to a folder.
- **Local addresses:** browsers hide LAN IPs behind `.local` mDNS names until the page has camera permission, and some hotspots drop mDNS. Stub asks for the camera before making the offer for this reason. If the camera is denied and pairing times out, allow camera access and try again.
- **Client isolation:** guest and public Wi-Fi often stop devices from seeing each other. A phone hotspot or a home router works.
- **One file at a time per direction.** Both directions can run at once.
