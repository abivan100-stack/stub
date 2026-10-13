<script lang="ts">
  import {
    createOffer,
    nfcStatus,
    shareByNfc,
    startHotspot,
    startHotspot24,
    stopWifi,
    toWifiQr,
    unlockLocalAddresses,
    wifiCapabilities,
    type Link,
    type Offer,
    type WifiCredentials,
  } from '../pairing'
  import { detailOf, failureOf, inlineProblem, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'
  import Scanner from './Scanner.svelte'

  let { onlink, onfail, onback }: { onlink: (l: Link) => void; onfail: (k: ProblemKind, detail?: string) => void; onback: () => void } =
    $props()

  // Normal: show code, scan reply. With a hotspot (Android app): show Wi-Fi code first.
  let stage = $state<'wifi' | 'offer' | 'scan'>('offer')
  let hotspot = $state<WifiCredentials | null>(null)
  let canHotspot = $state(false)
  let nfcOn = $state(false)
  let startingHotspot = $state(false)
  let hotspotProblem = $state<string | null>(null)
  let offer = $state<Offer | null>(null)
  let connecting = $state(false)
  let problem = $state<string | null>(null)
  let attempt = $state(0)
  let linked = false
  let live = true

  const steps = $derived<[number, number]>(
    hotspot ? [stage === 'wifi' ? 1 : stage === 'offer' ? 2 : 3, 3] : [stage === 'offer' ? 1 : 2, 2],
  )

  function makeOffer() {
    offer?.cancel()
    offer = null
    createOffer()
      .then((o) => (live ? (offer = o) : o.cancel()))
      .catch((e) => onfail(failureOf(e) as ProblemKind, detailOf(e)))
  }

  $effect(() => {
    wifiCapabilities().then((c) => (canHotspot = c.hotspot))
    nfcStatus().then((s) => (nfcOn = s.share && s.enabled))
    unlockLocalAddresses().then(() => live && makeOffer())
    return () => {
      live = false
      if (!linked) {
        offer?.cancel()
        stopWifi()
      }
    }
  })

  /** Some laptops and older phones can't see 5/6 GHz: swap to a 2.4 GHz Wi-Fi Direct network. */
  async function switch24() {
    startingHotspot = true
    hotspotProblem = null
    try {
      hotspot = await startHotspot24()
      makeOffer() // new address: the old code would point at the wrong network
    } catch (e) {
      hotspotProblem = e instanceof Error ? e.message : String(e)
    } finally {
      startingHotspot = false
    }
  }

  async function makeHotspot() {
    startingHotspot = true
    hotspotProblem = null
    try {
      hotspot = await startHotspot()
      makeOffer() // the old one was made before the hotspot existed, so it lacks the hotspot's address
      stage = 'wifi'
    } catch (e) {
      hotspotProblem = e instanceof Error ? e.message : String(e)
    } finally {
      startingHotspot = false
    }
  }

  function joined() {
    stage = 'offer'
  }

  // Tap-to-pair: while a code is on screen, a phone that taps this one gets it (with the Wi-Fi details first).
  $effect(() => {
    if (!nfcOn || stage === 'scan' || !offer) return
    shareByNfc(hotspot ? [toWifiQr(hotspot), offer.payload] : [offer.payload])
    return () => shareByNfc([])
  })

  function back() {
    if (connecting) return onback()
    if (stage === 'scan') stage = 'offer'
    else if (stage === 'offer' && hotspot) stage = 'wifi'
    else onback()
  }

  async function answered(text: string) {
    connecting = true
    problem = null
    try {
      const link = await offer!.complete(text)
      linked = true
      onlink(link)
    } catch (e) {
      const kind = failureOf(e)
      problem = inlineProblem(kind, 'answer')
      if (!problem) return onfail(kind as ProblemKind, detailOf(e))
      connecting = false
      attempt++
    }
  }
</script>

<Bar onback={back} step={steps} />

<main class="pair">
  {#if stage === 'wifi' && hotspot}
    <div class="copy">
      <h1>Let them join your Wi-Fi</h1>
      <p class="quiet">On the other phone, tap Receive in Stub and scan this, or scan it with the camera app. No internet needed.</p>
    </div>
    <div class="slip panel">
      <QrCode raw payload={toWifiQr(hotspot)} label="Wi-Fi code for the other phone to join your hotspot" />
      <dl class="creds mono">
        <dt>Network</dt>
        <dd>{hotspot.ssid}</dd>
        <dt>Password</dt>
        <dd>{hotspot.password || 'none'}</dd>
        {#if hotspot.band}
        <dt>Band</dt>
        <dd>{hotspot.band}</dd>
        {/if}
      </dl>
      {#if !hotspot.ssid.startsWith('DIRECT-')}
        <button class="link" disabled={startingHotspot} onclick={switch24}>
          {startingHotspot ? 'Switching' : 'Can’t see this Wi-Fi on the other device? Switch to 2.4 GHz'}
        </button>
      {/if}
      {#if hotspotProblem}<p class="problem" role="alert">{hotspotProblem}</p>{/if}
    </div>
    {#if nfcOn}
      <p class="nfc quiet">Or hold the phones back to back to send the Wi-Fi and the code in one tap.</p>
      <button class="link" disabled={!offer} onclick={() => (stage = 'scan')}>Tapped phones? Scan their reply</button>
    {/if}
    <button class="btn go wide next" onclick={joined}>They joined. Next</button>
  {:else if stage === 'offer'}
    <div class="copy">
      <h1>Let them scan this</h1>
      <p class="quiet">On the other device, open Stub and tap Receive.</p>
    </div>
    <div class="slip panel">
      {#if offer}
        <QrCode payload={offer.payload} label="Pairing code for the other device to scan" />
      {:else}
        <p class="wait mono" role="status">Making your code</p>
      {/if}
    </div>
    {#if nfcOn}<p class="nfc quiet">Or hold the phones back to back.</p>{/if}
    {#if canHotspot && !hotspot}
      <div class="alt">
        <button class="link" disabled={startingHotspot} onclick={makeHotspot}>
          {startingHotspot ? 'Starting hotspot' : 'Not on the same Wi-Fi? Make a hotspot'}
        </button>
        {#if hotspotProblem}<p class="problem" role="alert">{hotspotProblem}</p>{/if}
      </div>
    {/if}
    <button class="btn go wide next" disabled={!offer} onclick={() => (stage = 'scan')}>They scanned it. Next</button>
  {:else}
    <div class="copy">
      <h1>Now scan their reply</h1>
      <p class="quiet">Point at the other screen.</p>
    </div>
    <div class="slip panel">
      {#if connecting}
        <p class="wait mono" role="status">Connecting</p>
      {:else}
        {#key attempt}<Scanner onresult={answered} label="Camera view for scanning their reply" />{/key}
      {/if}
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </div>
  {/if}
</main>

<style>
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
  .wait::after {
    content: '';
    width: 120px;
    height: 6px;
    margin-top: calc(var(--s7) * -1);
    border: var(--line) solid var(--rule);
    background: linear-gradient(var(--signal), var(--signal)) 0 0 / 30% 100% no-repeat;
    animation: shuttle 1.2s steps(8) infinite alternate;
  }
  @keyframes shuttle {
    to {
      background-position: 100% 0;
    }
  }
  .problem {
    margin-top: var(--s4);
    padding: var(--s3);
    border-left: 4px solid var(--danger);
    font-size: var(--t-sm);
  }
  .creds {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s1) var(--s4);
    margin: var(--s4) 0 0;
    font-size: var(--t-sm);
  }
  .creds dt {
    color: var(--ink-2);
  }
  .creds dd {
    margin: 0;
    word-break: break-all;
  }
  .nfc {
    font-size: var(--t-sm);
    text-align: center;
  }
  .alt .problem {
    margin-top: var(--s2);
  }
  .next {
    position: sticky;
    bottom: var(--s4);
  }
</style>
