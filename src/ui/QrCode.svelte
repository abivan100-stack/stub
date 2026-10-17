<script lang="ts">
  import { encode } from 'uqr'
  import { toFrames, toQrForm } from '../pairing'
  import { brighten } from './screen'

  // `raw` shows the text exactly as given (e.g. a standard Wi-Fi QR), with no frame header or text fallback.
  let { payload, label, raw = false }: { payload: string; label: string; raw?: boolean } = $props()

  const frames = $derived(raw ? [payload] : toFrames(toQrForm(payload)))
  let i = $state(0)
  let copied = $state(false)
  let full = $state(false)
  let closeButton = $state<HTMLButtonElement>()

  // While a code is on screen: full brightness and no screen timeout (Android app), screen kept awake (web).
  $effect(() => brighten())
  $effect(() => {
    if (full) closeButton?.focus()
  })

  // Long codes cycle through numbered frames; the scanner collects them in any order.
  $effect(() => {
    i = 0
    if (frames.length < 2) return
    const id = setInterval(() => (i = (i + 1) % frames.length), 400)
    return () => clearInterval(id)
  })

  // Border 4 is the quiet zone the QR spec asks for; scanners lock on faster with it.
  const qr = $derived(encode(frames[i] ?? '', { ecc: 'L', border: 4 }))
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

{#snippet code(cls: string)}
  <svg class={cls} viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges">
    <rect width={qr.size} height={qr.size} fill="#f4f2ec" />
    <path d={path} fill="#1b1a17" />
  </svg>
{/snippet}

<figure class="qr">
  <button class="enlarge" onclick={() => (full = true)} aria-label="Show the code full screen">
    {@render code('small')}
  </button>
  <span class="tap quiet">Tap the code to make it bigger</span>
  {#if frames.length > 1}
    <figcaption class="mono">
      Part {i + 1} of {frames.length}. Hold steady until it connects.
    </figcaption>
  {/if}
</figure>

{#if full}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="full"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    tabindex="-1"
    onclick={() => (full = false)}
    onkeydown={(e) => e.key === 'Escape' && (full = false)}
  >
    {@render code('big')}
    {#if frames.length > 1}<p class="mono">Part {i + 1} of {frames.length}</p>{/if}
    <button class="btn" bind:this={closeButton} onclick={() => (full = false)}>Done</button>
  </div>
{/if}

{#if !raw}
<details class="fallback">
  <summary>Can’t scan? Send the code as text</summary>
  <label class="quiet" for="code-out">Copy this, then paste it into the other device.</label>
  <textarea id="code-out" readonly rows="4" data-testid="code-out" onfocus={(e) => e.currentTarget.select()}>{payload}</textarea>
  <button class="btn small" onclick={copy}>{copied ? 'Copied' : 'Copy code'}</button>
</details>
{/if}

<style>
  .qr {
    margin: 0;
    display: grid;
    gap: var(--s3);
  }
  .enlarge {
    appearance: none;
    display: block;
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .tap {
    text-align: center;
    max-width: none; /* the global 60ch cap would push it off centre */
    font-size: var(--t-xs);
  }
  /* Always dark-on-light, whatever the theme: that is what scanners read best. */
  .full {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    align-content: center;
    gap: var(--s4);
    padding: var(--s4);
    background: #f4f2ec;
    color: #1b1a17;
  }
  .full .btn {
    --edge: #1b1a17;
    background: #f4f2ec;
    color: #1b1a17;
    border-color: #1b1a17;
  }
  svg.big {
    width: min(92vw, 80vh);
    max-width: none;
    height: auto;
    border: 0;
    image-rendering: pixelated;
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
    max-width: none; /* the global 60ch cap would push it off centre */
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
