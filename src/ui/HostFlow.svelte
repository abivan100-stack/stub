<script lang="ts">
  import {
    acceptOffer,
    encodeDirect,
    formatDirect,
    hostAddresses,
    startHosting,
    startHotspot,
    startHotspot24,
    stopWifi,
    unlockLocalAddresses,
    wifiCapabilities,
    type HostInfo,
    type Link,
    type WifiCredentials,
  } from '../pairing'
  import { detailOf, failureOf, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'

  let {
    onlink,
    onfail,
    onback,
  }: { onlink: (l: Link) => void; onfail: (k: ProblemKind, detail?: string) => void; onback: () => void } = $props()

  let info = $state<HostInfo | null>(null)
  let addresses = $state<string[]>([])
  let startError = $state<string | null>(null)
  let status = $state<string | null>(null)
  let canHotspot = $state(false)
  let hotspot = $state<WifiCredentials | null>(null)
  let startingHotspot = $state(false)
  let hotspotProblem = $state<string | null>(null)
  let stopHosting: (() => void) | null = null
  let linked = false
  let live = true

  $effect(() => {
    wifiCapabilities().then((c) => (canHotspot = c.hotspot))
    // With camera permission our answer carries real LAN addresses, which the laptop can reach.
    unlockLocalAddresses()
      .then(() => startHosting(answerLaptop))
      .then((h) => {
        if (!live) return h.stop()
        stopHosting = h.stop
        info = h.info
        addresses = h.info.addresses
      })
      .catch((e: unknown) => (startError = e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
      stopHosting?.()
      if (!linked) stopWifi()
    }
  })

  /** The laptop sent its code through the phone's server: answer it, and wait for the link. */
  async function answerLaptop(offer: string): Promise<string> {
    status = 'Laptop found. Connecting'
    let answer
    try {
      answer = await acceptOffer(offer)
    } catch {
      status = null
      throw new Error('The phone couldn’t read the laptop’s code. Reload the page on the laptop and try again.')
    }
    answer.link.then(
      (l) => {
        linked = true
        stopHosting?.() // paired: nobody else should load or pair through the phone
        onlink(l)
      },
      (e) => live && onfail(failureOf(e) as ProblemKind, detailOf(e)),
    )
    return answer.payload
  }

  /** Some laptops and older phones can't see 5/6 GHz: swap to a 2.4 GHz Wi-Fi Direct network. */
  async function switch24() {
    startingHotspot = true
    hotspotProblem = null
    try {
      hotspot = await startHotspot24()
      addresses = await hostAddresses()
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
      addresses = await hostAddresses()
    } catch (e) {
      hotspotProblem = e instanceof Error ? e.message : String(e)
    } finally {
      startingHotspot = false
    }
  }
</script>

<Bar {onback} />

<main class="host">
  <div class="copy">
    <h1>Connect a laptop</h1>
    <p class="quiet">On the laptop, open <strong>stub-black.vercel.app</strong> and type this code. No scanning.</p>
  </div>

  {#if startError}
    <p class="problem" role="alert">{startError}</p>
  {:else if info}
    {#if hotspot}
      <div class="slip step">
        <p class="label">First, join this Wi-Fi on the laptop</p>
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
    {/if}

    {#if addresses.length}
      <div class="slip step">
        <p class="label">{hotspot ? 'Then, on stub-black.vercel.app, enter' : 'Code'}</p>
        {#each addresses as ip}
          <p class="code mono" data-testid="host-code">{formatDirect(encodeDirect({ ip, port: info.port, pin: info.pin }))}</p>
        {/each}
        {#if addresses.length > 1}<p class="quiet small">Two networks: try the first code, then the second.</p>{/if}
      </div>

      <details class="slip step manual">
        <summary>Laptop never opened the Stub site? Type an address instead</summary>
        <p class="quiet small">Type this into the laptop’s address bar (no need for http://), then enter the PIN.</p>
        {#each addresses as ip}
          <p class="address mono" data-testid="host-address">{ip}:{info.port}</p>
        {/each}
        <p class="pin-line">PIN <span class="mono" data-testid="host-pin">{info.pin}</span></p>
      </details>
    {:else}
      <p class="slip step quiet">This phone isn’t on a Wi-Fi network. Join one, or make a hotspot below.</p>
    {/if}

    <p class="status mono" role="status">{status ?? 'Waiting for the laptop'}</p>

    {#if canHotspot && !hotspot}
      <div class="alt">
        <button class="link" disabled={startingHotspot} onclick={makeHotspot}>
          {startingHotspot ? 'Starting hotspot' : 'Not on the same Wi-Fi? Make a hotspot'}
        </button>
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
