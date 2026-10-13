<script lang="ts">
  import QrScanner from 'qr-scanner'
  import { FrameCollector } from '../pairing'

  let { onresult, label }: { onresult: (payload: string) => void; label: string } = $props()

  let video: HTMLVideoElement
  let camera = $state<'starting' | 'live' | 'blocked' | 'missing'>('starting')
  let got = $state(0)
  let total = $state(0)
  let pasted = $state('')
  let pasting = $state(false)
  let done = false
  const collector = new FrameCollector()

  function feed(text: string) {
    if (done) return
    const full = collector.add(text)
    got = collector.received
    total = collector.total
    if (full) {
      done = true
      onresult(full)
    }
  }

  $effect(() => {
    const scanner = new QrScanner(video, (r) => feed(r.data), {
      returnDetailedScanResult: true,
      preferredCamera: 'environment',
      maxScansPerSecond: 15,
    })
    scanner
      .start()
      .then(() => (camera = 'live'))
      .catch((e: unknown) => {
        const name = e instanceof Error ? e.name : String(e)
        camera = /NotAllowed|Permission|denied/i.test(name) ? 'blocked' : 'missing'
        pasting = true
      })
    return () => scanner.destroy()
  })
</script>

<div class="finder" class:dark={camera !== 'live'}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} muted playsinline aria-label={label}></video>
  <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
  {#if camera === 'live'}<span class="sweep" aria-hidden="true"></span>{/if}
  {#if camera === 'starting'}
    <p class="over">Starting camera</p>
  {:else if camera === 'blocked'}
    <p class="over" role="alert">
      Camera is blocked. Allow camera access for this site in your browser settings, then reload. Or paste their code below.
    </p>
  {:else if camera === 'missing'}
    <p class="over" role="alert">No camera found. Paste their code below instead.</p>
  {/if}
</div>

<p class="count mono" aria-live="polite">
  {#if total > 1}Got {got} of {total} parts{/if}
</p>

<details class="fallback" bind:open={pasting}>
  <summary>Can’t scan? Paste their code</summary>
  <label class="quiet" for="code-in">Paste the code copied from the other device.</label>
  <textarea id="code-in" rows="4" bind:value={pasted} data-testid="code-in" spellcheck="false" autocomplete="off"></textarea>
  <button class="btn small" disabled={!pasted.trim()} onclick={() => feed(pasted)}>Use this code</button>
</details>

<style>
  .finder {
    position: relative;
    width: 100%;
    max-width: 340px;
    aspect-ratio: 1;
    margin: 0 auto;
    background: #0e0e0d;
    border-radius: var(--radius);
    overflow: hidden;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .corner {
    position: absolute;
    width: 44px;
    height: 44px;
    border: 4px solid var(--signal);
  }
  .tl {
    top: 14px;
    left: 14px;
    border-right: 0;
    border-bottom: 0;
  }
  .tr {
    top: 14px;
    right: 14px;
    border-left: 0;
    border-bottom: 0;
  }
  .bl {
    bottom: 14px;
    left: 14px;
    border-right: 0;
    border-top: 0;
  }
  .br {
    bottom: 14px;
    right: 14px;
    border-left: 0;
    border-top: 0;
  }
  .sweep {
    position: absolute;
    left: 14px;
    right: 14px;
    top: 14px;
    height: 2px;
    background: var(--signal);
    opacity: 0.8;
    animation: sweep 2.4s steps(24) infinite alternate;
  }
  @keyframes sweep {
    to {
      top: calc(100% - 16px);
    }
  }
  .over {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: var(--s6);
    color: #e9e5db;
    text-align: center;
    font-size: var(--t-sm);
  }
  .count {
    min-height: 1.5em;
    margin: var(--s2) auto 0;
    text-align: center;
    font-size: var(--t-xs);
  }
  .fallback {
    display: grid;
    gap: var(--s3);
  }
  summary {
    cursor: pointer;
    font-size: var(--t-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
    padding: var(--s2) 0;
  }
  .fallback label {
    display: block;
    font-size: var(--t-sm);
    margin: var(--s2) 0;
  }
  .fallback .btn {
    margin-top: var(--s3);
  }
</style>
