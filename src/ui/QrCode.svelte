<script lang="ts">
  import { encode } from 'uqr'
  import { toFrames } from '../pairing'

  let { payload, label }: { payload: string; label: string } = $props()

  const frames = $derived(toFrames(payload))
  let i = $state(0)
  let copied = $state(false)

  // Long codes cycle through numbered frames; the scanner collects them in any order.
  $effect(() => {
    i = 0
    if (frames.length < 2) return
    const id = setInterval(() => (i = (i + 1) % frames.length), 400)
    return () => clearInterval(id)
  })

  const qr = $derived(encode(frames[i] ?? '', { ecc: 'L', border: 2 }))
  const path = $derived.by(() => {
    let d = ''
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)))
    return d
  })

  async function copy() {
    await navigator.clipboard.writeText(payload)
    copied = true
    setTimeout(() => (copied = false), 2000)
  }
</script>

<figure class="qr">
  <svg viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges">
    <rect width={qr.size} height={qr.size} fill="var(--qr-light)" />
    <path d={path} fill="var(--qr-dark)" />
  </svg>
  {#if frames.length > 1}
    <figcaption class="mono">
      Part {i + 1} of {frames.length}. Hold steady until it connects.
    </figcaption>
  {/if}
</figure>

<details class="fallback">
  <summary>Can’t scan? Send the code as text</summary>
  <label class="quiet" for="code-out">Copy this, then paste it into the other device.</label>
  <textarea id="code-out" readonly rows="4" data-testid="code-out" onfocus={(e) => e.currentTarget.select()}>{payload}</textarea>
  <button class="btn small" onclick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
</details>

<style>
  .qr {
    margin: 0;
    display: grid;
    gap: var(--s3);
  }
  svg {
    display: block;
    width: 100%;
    max-width: 340px;
    aspect-ratio: 1;
    margin: 0 auto;
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    image-rendering: pixelated;
  }
  figcaption {
    text-align: center;
    font-size: var(--t-xs);
  }
  .fallback {
    margin-top: var(--s4);
    display: grid;
    gap: var(--s3);
  }
  .fallback[open] {
    display: grid;
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
