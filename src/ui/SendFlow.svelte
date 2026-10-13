<script lang="ts">
  import {
    createOffer,
    startHotspot,
    stopWifi,
    toWifiQr,
    unlockLocalAddresses,
    wifiCapabilities,
    type Link,
    type Offer,
    type WifiCredentials,
  } from '../pairing'
  import { failureOf, inlineProblem, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'
  import Scanner from './Scanner.svelte'

  let { onlink, onfail, onback }: { onlink: (l: Link) => void; onfail: (k: ProblemKind) => void; onback: () => void } =
    $props()

  // Normal: show code, scan reply. With a hotspot (Android app): show Wi-Fi code first.
  let stage = $state<'wifi' | 'offer' | 'scan'>('offer')
  let hotspot = $state<WifiCredentials | null>(null)
  let canHotspot = $state(false)
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
      .catch((e) => onfail(failureOf(e) as ProblemKind))
  }

  $effect(() => {
    wifiCapabilities().then((c) => (canHotspot = c.hotspot))
    unlockLocalAddresses().then(() => live && makeOffer())
    return () => {
      live = false
      if (!linked) {
        offer?.cancel()
        stopWifi()
      }
    }
  })

  async function makeHotspot() {
    startingHotspot = true
    hotspotProblem = null
    try {
      hotspot = await startHotspot()
      offer?.cancel() // made before the hotspot existed, so it lacks the hotspot's address
      offer = null
      stage = 'wifi'
    } catch (e) {
      hotspotProblem = e instanceof Error ? e.message : String(e)
    } finally {
      startingHotspot = false
    }
  }

  function joined() {
    makeOffer()
    stage = 'offer'
  }

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
      if (!problem) return onfail(kind as ProblemKind)
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
      </dl>
    </div>
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
  .alt .problem {
    margin-top: var(--s2);
  }
  .next {
    position: sticky;
    bottom: var(--s4);
  }
</style>
