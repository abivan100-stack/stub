<script lang="ts">
  import {
    encodeDirect,
    formatDirect,
    hostAddresses,
    nfcStatus,
    shareByNfc,
    startHosting,
    startHotspot,
    switchHotspot,
    stopWifi,
    toWifiQr,
    wifiCapabilities,
    type HostInfo,
    type Link,
    type WifiCredentials,
  } from '../pairing'
  import type { ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'

  let {
    onlink,
    onfail,
    onback,
    autoHotspot = false,
  }: {
    onlink: (l: Link) => void
    onfail: (k: ProblemKind, detail?: string) => void
    onback: () => void
    /** Came from "Make a hotspot" on the Send screen: start one straight away. */
    autoHotspot?: boolean
  } = $props()

  let info = $state<HostInfo | null>(null)
  let addresses = $state<string[]>([])
  let startError = $state<string | null>(null)
  let canHotspot = $state(false)
  let hotspot = $state<WifiCredentials | null>(null)
  let startingHotspot = $state(false)
  let hotspotProblem = $state<string | null>(null)
  let nfcOn = $state(false)
  let stopHosting: (() => void) | null = null
  let linked = false
  let live = true

  // The link another device opens: the page this phone serves, with the PIN in the #fragment.
  const ip = $derived(addresses[0])
  const connectUrl = $derived(info && ip ? `http://${ip}:${info.port}/#pin=${info.pin}` : '')

  $effect(() => {
    wifiCapabilities().then((c) => (canHotspot = c.hotspot))
    nfcStatus().then((s) => (nfcOn = s.share && s.enabled))
    startHosting(
      (l) => {
        if (!live) return l.close()
        linked = true
        stopHosting?.() // paired: nobody else should load or pair through the phone
        onlink(l)
      },
      (e) => live && onfail('network', e instanceof Error ? e.message : String(e)),
    )
      .then((h) => {
        if (!live) return h.stop()
        stopHosting = h.stop
        info = h.info
        addresses = h.info.addresses
        if (autoHotspot) makeHotspot()
      })
      .catch((e: unknown) => (startError = e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
      stopHosting?.()
      if (!linked) stopWifi()
    }
  })

  // Tap-to-pair: a phone that taps this one gets the Wi-Fi (if any), then the connect link.
  $effect(() => {
    if (!nfcOn || !connectUrl) return
    shareByNfc(hotspot ? [toWifiQr(hotspot), connectUrl] : [connectUrl])
    return () => shareByNfc([])
  })

  async function makeHotspot(start = startHotspot) {
    startingHotspot = true
    hotspotProblem = null
    try {
      hotspot = await start()
      addresses = await hostAddresses()
    } catch (e) {
      hotspotProblem = e instanceof Error ? e.message : String(e)
    } finally {
      startingHotspot = false
    }
  }
</script>

<Bar {onback} step={hotspot ? [1, 1] : undefined} />

<main class="host">
  <div class="copy">
    <h1>Connect another device</h1>
    <p class="quiet">
      {hotspot ? 'First let it join this phone’s Wi-Fi, then connect.' : 'The other device must be on the same Wi-Fi as this phone.'}
    </p>
  </div>

  {#if startError}
    <p class="problem" role="alert">{startError}</p>
  {:else if info}
    {#if hotspot}
      <section class="slip step">
        <p class="label">1. Join this Wi-Fi</p>
        <QrCode raw payload={toWifiQr(hotspot)} label="Wi-Fi code for the other device to join this phone’s network" />
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
        {#if hotspot.ssid.startsWith('DIRECT-')}
          <button class="link" disabled={startingHotspot} onclick={() => makeHotspot(() => switchHotspot(false))}>
            {startingHotspot ? 'Switching' : 'Laptop says it can’t connect? Switch to a regular hotspot'}
          </button>
        {:else}
          <button class="link" disabled={startingHotspot} onclick={() => makeHotspot(() => switchHotspot(true))}>
            {startingHotspot ? 'Switching' : 'Can’t see this Wi-Fi on the other device? Switch to 2.4 GHz'}
          </button>
        {/if}
        {#if hotspotProblem}<p class="problem" role="alert">{hotspotProblem}</p>{/if}
      </section>
    {/if}

    {#if connectUrl}
      <section class="slip step">
        <p class="label">{hotspot ? '2. Then connect' : 'Connect'}</p>
        <p class="quiet small">
          Scan this with the other device’s camera (or Stub’s Receive). On a laptop, type the code on
          stub-black.vercel.app instead.
        </p>
        <QrCode raw payload={connectUrl} label="Link for the other device to connect to this phone" />
        {#each addresses as a}
          <p class="code mono" data-testid="host-code">{formatDirect(encodeDirect({ ip: a, port: info.port, pin: info.pin }))}</p>
        {/each}
        {#if addresses.length > 1}<p class="quiet small">Two networks: try the first code, then the second.</p>{/if}
        {#if nfcOn}<p class="quiet small">Or hold two phones back to back.</p>{/if}
      </section>

      <details class="slip step manual">
        <summary>Laptop never opened the Stub site? Type an address instead</summary>
        <p class="quiet small">Type this into the browser’s address bar (no need for http://), then enter the PIN.</p>
        {#each addresses as a}
          <p class="address mono" data-testid="host-address">{a}:{info.port}</p>
        {/each}
        <p class="pin-line">PIN <span class="mono" data-testid="host-pin">{info.pin}</span></p>
      </details>
    {:else if !startingHotspot}
      <p class="slip step quiet">This phone isn’t on a Wi-Fi network. Join one, or make a hotspot below.</p>
    {/if}

    <p class="status mono" role="status">{startingHotspot ? 'Starting this phone’s Wi-Fi' : 'Waiting for the other device'}</p>

    {#if canHotspot && !hotspot && !startingHotspot}
      <div class="alt">
        <button class="link" onclick={() => makeHotspot()}>Not on the same Wi-Fi? Make a hotspot</button>
        {#if hotspotProblem}<p class="problem" role="alert">{hotspotProblem}</p>{/if}
      </div>
    {/if}
  {:else}
    <p class="status mono" role="status">Starting</p>
  {/if}
</main>

<style>
  .host {
    display: grid;
    gap: var(--s4);
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
    margin-bottom: var(--s2);
  }
  .step {
    display: grid;
    gap: var(--s2);
    padding: var(--s4);
  }
  .label {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .address {
    font-size: clamp(1.25rem, 6vw, 1.75rem);
    font-weight: 500;
    word-break: break-all;
  }
  .code {
    font-size: clamp(2.5rem, 13vw, 3.5rem);
    font-weight: 500;
    letter-spacing: 0.08em;
    line-height: 1;
  }
  .manual summary {
    cursor: pointer;
    font-size: var(--t-sm);
  }
  .pin-line {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .pin-line span {
    margin-left: var(--s2);
    font-size: var(--t-lg);
    color: var(--ink);
    letter-spacing: 0.15em;
  }
  .small {
    font-size: var(--t-xs);
  }
  .status {
    font-size: var(--t-sm);
    text-align: center;
  }
  .creds {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--s1) var(--s4);
    margin: 0;
    font-size: var(--t-sm);
  }
  .creds dt {
    color: var(--ink-2);
  }
  .creds dd {
    margin: 0;
    word-break: break-all;
  }
  .problem {
    padding: var(--s3);
    border-left: 4px solid var(--danger);
    font-size: var(--t-sm);
  }
  .alt {
    text-align: center;
  }
</style>
