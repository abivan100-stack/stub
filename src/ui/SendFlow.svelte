<script lang="ts">
  import {
    createOffer,
    nfcStatus,
    shareByNfc,
    unlockLocalAddresses,
    wifiCapabilities,
    type Link,
    type Offer,
  } from '../pairing'
  import { detailOf, failureOf, inlineProblem, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'
  import Scanner from './Scanner.svelte'

  let {
    onlink,
    onfail,
    onback,
    onhotspot,
  }: {
    onlink: (l: Link) => void
    onfail: (k: ProblemKind, detail?: string) => void
    onback: () => void
    /** Android app: pair through this phone's own network instead (see HostFlow). */
    onhotspot?: () => void
  } = $props()

  let stage = $state<'offer' | 'scan'>('offer')
  let canHotspot = $state(false)
  let nfcOn = $state(false)
  let offer = $state<Offer | null>(null)
  let connecting = $state(false)
  let problem = $state<string | null>(null)
  let attempt = $state(0)
  let linked = false
  let live = true

  $effect(() => {
    wifiCapabilities().then((c) => (canHotspot = c.hotspot))
    nfcStatus().then((s) => (nfcOn = s.share && s.enabled))
    unlockLocalAddresses()
      .then(createOffer)
      .then((o) => (live ? (offer = o) : o.cancel()))
      .catch((e) => onfail(failureOf(e) as ProblemKind, detailOf(e)))
    return () => {
      live = false
      if (!linked) offer?.cancel()
    }
  })

  // Tap-to-pair: while the code is on screen, a phone that taps this one gets it.
  $effect(() => {
    if (!nfcOn || stage === 'scan' || !offer) return
    shareByNfc([offer.payload])
    return () => shareByNfc([])
  })

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

<Bar onback={stage === 'scan' && !connecting ? () => (stage = 'offer') : onback} step={[stage === 'offer' ? 1 : 2, 2]} />

<main class="pair">
  {#if stage === 'offer'}
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
    {#if canHotspot && onhotspot}
      <div class="alt">
        <button class="link" onclick={onhotspot}>Not on the same Wi-Fi, or using a hotspot? Connect through this phone</button>
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
  .nfc {
    font-size: var(--t-sm);
    text-align: center;
  }
  .next {
    position: sticky;
    bottom: var(--s4);
  }
</style>
