<script lang="ts">
  import {
    FINISHED,
    MEMORY_LIMIT,
    canStreamToDisk,
    folderSink,
    isNative,
    keepAlive,
    memorySink,
    nativeSink,
    openSaved,
    release,
    type IncomingBatch,
    type Peer,
  } from '../transfer'
  import Bar from './Bar.svelte'
  import TicketView from './Ticket.svelte'
  import { bytes, plural, spaced, urlFor } from './format'

  let {
    peer,
    code,
    onleave,
    shared = [],
    ontookshared,
  }: { peer: Peer; code: string; onleave: () => void; shared?: File[]; ontookshared?: () => void } = $props()

  // Peer mutates plain objects; take a snapshot at most every 80 ms.
  // A timer, not requestAnimationFrame, so a backgrounded tab still catches up.
  let tick = $state(0)
  let timer = 0
  $effect(() => {
    peer.onchange = () => {
      if (!timer) timer = window.setTimeout(() => ((timer = 0), tick++), 80)
    }
    return () => {
      peer.onchange = () => {}
      clearTimeout(timer)
    }
  })

  const tickets = $derived.by(() => (void tick, peer.tickets.map((t) => ({ ...t }))))
  const offers = $derived.by(() => (void tick, peer.pending()))
  const connected = $derived.by(() => (void tick, peer.connected))
  const shown = $derived(tickets.filter((t) => t.status !== 'offered'))
  const idle = $derived(shown.length > 0 && shown.every((t) => FINISHED.includes(t.status)))

  let staged = $state<File[]>([])

  // Files shared into the Android app go straight to the "Send?" prompt.
  $effect(() => {
    if (!shared.length) return
    staged = [...staged, ...shared]
    ontookshared?.()
  })
  let picker = $state<HTMLInputElement>()
  let dragging = $state(false)

  // The Done summary appears whenever the queue drains; "Send more" hides it until the next batch finishes.
  let seen = $state(0)
  const showDone = $derived(idle && offers.length === 0 && staged.length === 0 && shown.length > seen)

  function stage(list: FileList | null | undefined) {
    if (list?.length) staged = [...staged, ...list]
  }
  function send() {
    peer.send(staged)
    staged = []
  }

  async function accept(b: IncomingBatch) {
    let sink = isNative ? nativeSink() : memorySink()
    if (!isNative && canStreamToDisk && b.total > 100e6) {
      try {
        sink = folderSink(await window.showDirectoryPicker!({ mode: 'readwrite', id: 'stub' }))
      } catch {
        return // picker closed: leave the offer open
      }
    }
    peer.accept(b.id, sink)
  }

  const find = (id: string, dir: string) => peer.tickets.find((x) => x.id === id && x.dir === dir)!
  const tooBig = (b: IncomingBatch) => !isNative && !canStreamToDisk && b.tickets.some((t) => t.size > MEMORY_LIMIT)
  const stagedSize = $derived(staged.reduce((n, f) => n + f.size, 0))
  const received = $derived(shown.filter((t) => t.dir === 'in' && t.status === 'done'))
  const sent = $derived(shown.filter((t) => t.dir === 'out' && t.status === 'done'))
  const doneBytes = $derived([...received, ...sent].reduce((n, t) => n + t.size, 0))
  const missed = $derived(shown.length - received.length - sent.length)

  // Android app: keep a foreground service (with a progress notification) while anything is moving,
  // so transfers survive the screen turning off or switching apps. No-op on the web.
  const moving = $derived(shown.filter((t) => t.status === 'active' || t.status === 'queued' || t.status === 'checking'))
  $effect(() => {
    if (!moving.length) return release()
    const size = moving.reduce((n, t) => n + t.size, 0)
    const done = moving.reduce((n, t) => n + t.bytes, 0)
    const percent = size ? Math.floor((done / size) * 100) : 0
    const out = moving.some((t) => t.dir === 'out')
    const inn = moving.some((t) => t.dir === 'in')
    keepAlive(out && inn ? 'Sending and receiving' : out ? 'Sending' : 'Receiving', `${plural(moving.length, 'file')}, ${percent}%`, percent)
  })
  $effect(() => release) // leaving the transfer screen
</script>

<svelte:window
  ondragover={(e) => {
    if (!connected) return
    e.preventDefault()
    dragging = true
  }}
  ondragleave={(e) => !e.relatedTarget && (dragging = false)}
  ondrop={(e) => {
    e.preventDefault()
    dragging = false
    if (connected) stage(e.dataTransfer?.files)
  }}
/>

<Bar>
  {#if connected}
    <span class="link-state">Connected <span class="mono code" title="Verification code">{spaced(code)}</span></span>
  {/if}
  <button class="link" onclick={onleave}>{connected ? 'Disconnect' : 'Home'}</button>
</Bar>

<main class="transfer">
  {#if !connected}
    <section class="slip lost" role="alert">
      <h2>Disconnected</h2>
      <p>The other device left or went out of range. Files already verified are still here.</p>
      <button class="btn go" onclick={onleave}>Pair again</button>
    </section>
  {/if}

  {#each offers as b (b.id)}
    <section class="slip offer" aria-labelledby="offer-{b.id}">
      <h2 id="offer-{b.id}">{plural(b.tickets.length, 'file')}, {bytes(b.total)}. Accept?</h2>
      <ul class="mono">
        {#each b.tickets.slice(0, 4) as t}<li><span>{t.name}</span><span>{bytes(t.size)}</span></li>{/each}
        {#if b.tickets.length > 4}<li class="quiet">and {b.tickets.length - 4} more</li>{/if}
      </ul>
      {#if tooBig(b)}
        <p class="warn">This browser holds received files in memory, and these are large. It may run out. Chrome on a laptop or Android saves straight to disk instead.</p>
      {:else if isNative}
        <p class="quiet">Files are saved to Download/Stub on this phone.</p>
      {:else if canStreamToDisk && b.total > 100e6}
        <p class="quiet">You’ll pick a folder. Files are written straight to it as they arrive.</p>
      {/if}
      <div class="row">
        <button class="btn go" onclick={() => accept(b)}>Accept</button>
        <button class="btn" onclick={() => peer.decline(b.id)}>Decline</button>
      </div>
    </section>
  {/each}

  {#if staged.length}
    <section class="slip offer" aria-labelledby="staged">
      <h2 id="staged">{plural(staged.length, 'file')}, {bytes(stagedSize)}. Send?</h2>
      <ul class="mono">
        {#each staged.slice(0, 4) as f}<li><span>{f.name}</span><span>{bytes(f.size)}</span></li>{/each}
        {#if staged.length > 4}<li class="quiet">and {staged.length - 4} more</li>{/if}
      </ul>
      <div class="row">
        <button class="btn go" onclick={send}>Send</button>
        <button class="btn" onclick={() => (staged = [])}>Clear</button>
      </div>
    </section>
  {/if}

  {#if showDone}
    <section class="done" aria-labelledby="done-h">
      <h2 id="done-h">All done</h2>
      <p class="summary">
        {plural(received.length + sent.length, 'file')}, {bytes(doneBytes)}, verified.
        {#if missed}{plural(missed, 'file')} didn’t go through.{/if}
      </p>
      {#if received.length}
        <ul class="manifest">
          {#each received as t (t.id)}
            <li>
              <div class="nm">
                <span>{t.name}</span>
                <span class="mono quiet">{bytes(t.size)}</span>
              </div>
              {#if t.blob}
                <div class="acts">
                  <a class="btn small" href={urlFor(t.blob)} download={t.name}>Save<span class="sr-only"> {t.name}</span></a>
                  <a class="btn small" href={urlFor(t.blob)} target="_blank" rel="noopener">Open<span class="sr-only"> {t.name}</span></a>
                </div>
              {:else}
                <div class="acts">
                  <span class="quiet">Saved to {t.savedTo}</span>
                  {#if t.uri}
                    <button class="btn small" onclick={() => openSaved(t.uri!, t.type)}>Open<span class="sr-only"> {t.name}</span></button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if sent.length}<p class="quiet">Sent {plural(sent.length, 'file')}. They have verified copies.</p>{/if}
      <div class="row">
        {#if connected}<button class="btn go" onclick={() => (seen = shown.length)}>Send more</button>{/if}
        <button class="btn" onclick={onleave}>Disconnect</button>
      </div>
    </section>
  {:else if shown.length}
    <ol class="queue" aria-label="Transfers">
      {#each shown as t (t.dir + t.id)}
        <li>
          <TicketView {t} oncancel={() => peer.cancel(find(t.id, t.dir))} onretry={() => peer.retry(find(t.id, t.dir))} />
        </li>
      {/each}
    </ol>
  {:else if connected && !offers.length && !staged.length}
    <section class="empty">
      <h2>Nothing sent yet</h2>
      <p class="quiet">Add files to send them across. They can send to you too.</p>
    </section>
  {/if}

  {#if connected && !showDone}
    <div class="dock">
      <input bind:this={picker} type="file" multiple hidden onchange={(e) => (stage(e.currentTarget.files), (e.currentTarget.value = ''))} data-testid="file-input" />
      <button class="btn go wide" onclick={() => picker?.click()}>Choose files</button>
      <p class="hint quiet">or drop them anywhere on this window</p>
    </div>
  {/if}
</main>

{#if dragging}
  <div class="drop" aria-hidden="true"><span>Drop to add</span></div>
{/if}

<style>
  .link-state {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--t-sm);
  }
  /* A live dot: the link is up. */
  .link-state::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--signal);
    animation: live 2.4s ease-in-out infinite;
  }
  @keyframes live {
    50% {
      opacity: 0.35;
    }
  }
  .link-state .code {
    padding-left: var(--s2);
    border-left: 1px solid var(--rule-soft);
    color: var(--ink-2);
  }
  .transfer {
    display: grid;
    gap: var(--s5);
    width: 100%;
    max-width: 46rem;
    margin: 0 auto;
    padding: var(--s5) var(--s4) 0;
  }
  h2 {
    font-size: var(--t-xl);
  }
  .offer,
  .lost {
    display: grid;
    gap: var(--s4);
    padding: var(--s5);
    border-width: 2px;
  }
  .offer ul,
  .manifest {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--line) solid var(--rule);
  }
  .offer li {
    display: flex;
    justify-content: space-between;
    gap: var(--s4);
    padding: var(--s2) 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
  }
  .offer li span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    padding-left: var(--s3);
    border-left: 4px solid var(--signal);
    font-size: var(--t-sm);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
  }
  .queue {
    container-type: inline-size;
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr); /* long file names ellipsize instead of widening the page */
    gap: var(--s4);
  }
  .empty {
    display: grid;
    gap: var(--s3);
    padding: var(--s7) 0 var(--s5);
    border-top: var(--line) solid var(--rule);
  }
  .empty h2 {
    font-size: var(--t-2xl);
  }
  .done {
    display: grid;
    gap: var(--s4);
  }
  .done h2 {
    font-size: var(--t-2xl);
  }
  .summary {
    font-size: var(--t-lg);
    line-height: 1.3;
  }
  .manifest li {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .manifest .nm {
    display: grid;
    min-width: 0;
  }
  .manifest .nm span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .manifest .nm span:last-child {
    font-size: var(--t-xs);
  }
  .acts {
    display: flex;
    gap: var(--s2);
  }
  .dock {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: var(--s2);
    margin: 0 calc(var(--s4) * -1);
    padding: var(--s4) var(--s4) calc(var(--s4) + env(safe-area-inset-bottom));
    background: var(--page);
    border-top: var(--line) solid var(--rule);
  }
  .hint {
    display: none;
    text-align: center;
    max-width: none; /* the global 60ch cap would push it off centre */
    font-size: var(--t-sm);
  }
  @media (hover: hover) and (pointer: fine) {
    .hint {
      display: block;
    }
    .dock {
      position: static;
      border-top: 0;
      padding-bottom: var(--s7);
    }
  }
  .drop {
    position: fixed;
    inset: var(--s4);
    display: grid;
    place-items: center;
    border: 3px dashed var(--ink);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--page) 88%, transparent);
    pointer-events: none;
  }
  .drop span {
    font: 800 var(--t-2xl) / 1 var(--display);
    font-stretch: 62%;
  }
</style>
