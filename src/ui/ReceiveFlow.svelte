<script lang="ts">
  import {
    acceptOffer,
    joinWifi,
    nfcStatus,
    pairThroughPhone,
    parseConnectUrl,
    parseWifiQr,
    readByNfc,
    unlockLocalAddresses,
    stopWifi,
    wifiCapabilities,
    type Answer,
    type Link,
    type WifiCredentials,
  } from '../pairing'
  import { isNative } from '../transfer'
  import { detailOf, failureOf, inlineProblem, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'
  import Scanner from './Scanner.svelte'

  let { onlink, onfail, onback }: { onlink: (l: Link) => void; onfail: (k: ProblemKind, detail?: string) => void; onback: () => void } =
    $props()

  let answer = $state<Answer | null>(null)
  let reading = $state<string | null>(null)
  let problem = $state<string | null>(null)
  let attempt = $state(0)
  // The sender made a hotspot: we joined it (Android app), or the user has to join it by hand (web).
  let joined = $state<string | null>(null)
  let joinByHand = $state<WifiCredentials | null>(null)
  let nfcOn = $state(false)
  let linked = false
  let gone = false

  nfcStatus().then((s) => (nfcOn = s.read && s.enabled))

  // Tap-to-pair: the sender's tag holds the Wi-Fi details (if it made a hotspot), then its code.
  $effect(() => {
    if (!nfcOn || answer) return
    return readByNfc(async (records) => {
      if (reading) return
      for (const r of records) {
        await scanned(r)
        if (answer || problem) break
      }
    })
  })

  $effect(() => () => {
    gone = true
    if (!linked) {
      answer?.cancel()
      stopWifi()
    }
  })

  async function scanned(text: string) {
    problem = null
    const wifi = parseWifiQr(text)
    if (wifi) return useWifi(wifi)
    const phone = parseConnectUrl(text)
    if (phone) return connectToPhone(text, phone)
    reading = 'Reading code'
    try {
      // With camera permission, the reply carries real LAN addresses instead of ".local" names
      // (matters when the code was pasted rather than scanned).
      await unlockLocalAddresses()
      const a = await acceptOffer(text)
      if (gone) return a.cancel()
      answer = a
      a.link.then(
        (l) => {
          linked = true
          onlink(l)
        },
        (e) => !gone && onfail(failureOf(e) as ProblemKind, detailOf(e)),
      )
    } catch (e) {
      const kind = failureOf(e)
      problem = inlineProblem(kind, 'offer')
      if (!problem) return onfail(kind as ProblemKind, detailOf(e))
      attempt++
    } finally {
      reading = null
    }
  }

  /** A phone's connect link: pair through that phone's relay (works on its hotspot, no WebRTC). */
  async function connectToPhone(url: string, phone: { base: string; pin: string }) {
    // The website (https) can't call a phone over http, so open the page the phone serves instead.
    if (location.protocol === 'https:' && !isNative) {
      location.href = url
      return
    }
    reading = 'Connecting to the phone'
    try {
      const l = await pairThroughPhone(phone.pin, phone.base)
      if (gone) return l.close()
      linked = true
      onlink(l)
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e)
      attempt++
    } finally {
      reading = null
    }
  }

  async function useWifi(w: WifiCredentials) {
    if (!(await wifiCapabilities()).join) {
      joinByHand = w
      attempt++
      return
    }
    reading = `Joining ${w.ssid}`
    try {
      await joinWifi(w)
      joined = w.ssid
      joinByHand = null
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e)
      joinByHand = w
    } finally {
      reading = null
      attempt++
    }
  }
</script>

<Bar {onback} step={[answer ? 2 : 1, 2]} />

<main class="pair">
  {#if !answer}
    <div class="copy">
      <h1>Scan their code</h1>
      <p class="quiet">
        {joined ? `Joined ${joined}. Now scan their Stub code.` : 'Point at the screen that tapped Send.'}
        {#if nfcOn}Or hold the phones back to back.{/if}
      </p>
    </div>
    {#if joinByHand}
      <div class="slip byhand" role="status">
        <p>Join this Wi-Fi in this device’s Wi-Fi settings, then scan their Stub code. If it isn’t listed, ask them to tap “Switch to 2.4 GHz” on their phone.</p>
        <dl class="creds mono">
          <dt>Network</dt>
          <dd>{joinByHand.ssid}</dd>
          <dt>Password</dt>
          <dd>{joinByHand.password || 'none'}</dd>
        </dl>
      </div>
    {/if}
    <div class="slip panel">
      {#if reading}
        <p class="wait mono" role="status">{reading}</p>
      {:else}
        {#key attempt}<Scanner onresult={scanned} label="Camera view for scanning their code" />{/key}
      {/if}
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </div>
  {:else}
    <div class="copy">
      <h1>Let them scan this</h1>
      <p class="quiet" role="status">Waiting for them to scan</p>
    </div>
    <div class="slip panel">
      <QrCode payload={answer.payload} label="Reply code for the other device to scan" />
    </div>
  {/if}
</main>

<style>
  .byhand {
    display: grid;
    gap: var(--s3);
    padding: var(--s4);
    border-left: 4px solid var(--signal);
    font-size: var(--t-sm);
  }
  .creds {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s1) var(--s4);
    margin: 0;
  }
  .creds dt {
    color: var(--ink-2);
  }
  .creds dd {
    margin: 0;
    word-break: break-all;
  }
  .pair {
    display: grid;
    gap: var(--s5);
    width: 100%;
    max-width: 30rem;
    margin: 0 auto;
    padding: var(--s6) var(--s4) var(--s7);
  }
  h1 {
    font-size: var(--t-2xl);
  }
  .copy {
    display: grid;
    gap: var(--s3);
  }
  .panel {
    padding: var(--s4);
  }
  .wait {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    max-width: 340px;
    margin: 0 auto;
    font-size: var(--t-sm);
  }
  .problem {
    margin-top: var(--s4);
    padding: var(--s3);
    border-left: 4px solid var(--danger);
    font-size: var(--t-sm);
  }
</style>
