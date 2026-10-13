<script lang="ts">
  import type { Ticket } from '../transfer'
  import { openSaved } from '../transfer'
  import { bytes, eta, speed, urlFor } from './format'

  let { t, oncancel, onretry }: { t: Ticket; oncancel: () => void; onretry: () => void } = $props()

  const pct = $derived(t.size ? Math.floor((t.bytes / t.size) * 100) : t.status === 'done' ? 100 : 0)
  const status = $derived.by(() => {
    switch (t.status) {
      case 'offered':
        return 'Waiting for you to accept'
      case 'waiting':
        return 'Waiting for them to accept'
      case 'queued':
        return 'In line'
      case 'active':
        return t.dir === 'out' ? 'Sending' : 'Receiving'
      case 'checking':
        return 'Checking their copy'
      case 'done':
        return t.savedTo ? `Verified. Saved to ${t.savedTo}` : 'Verified'
      case 'declined':
        return 'They declined'
      case 'cancelled':
        return t.error ?? 'Cancelled'
      case 'failed':
        return t.error ?? 'Failed'
    }
  })
  const live = $derived(t.status === 'active' || t.status === 'checking')
  const stoppable = $derived(['waiting', 'queued', 'active', 'checking'].includes(t.status))
  const retryable = $derived(t.status === 'failed' || t.status === 'cancelled')
</script>

<article class="ticket" class:out={t.dir === 'out'} aria-label="{t.name}, {status}">
  <div class="main">
    <div class="meta">
      <span>{t.dir === 'out' ? 'To them' : 'From them'}</span>
      <span class="mono">No. {t.id}</span>
    </div>
    <h3 class="name" title={t.name}>{t.name}</h3>
    <p class="size mono">{bytes(t.size)}</p>

    {#if live}
      <div
        class="bar"
        role="progressbar"
        aria-label="{t.name} progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={pct}
      >
        <span style="width: {pct}%"></span>
      </div>
      <p class="nums mono">
        <span>{pct}%</span>
        <span>{speed(t.rate)}</span>
        <span>{eta(t.size - t.bytes, t.rate)}</span>
      </p>
    {/if}
    <p class="status" class:bad={t.status === 'failed'} aria-live="polite">{status}</p>
  </div>

  <div class="tear" aria-hidden="true"></div>

  <div class="stub">
    {#if stoppable}
      <button class="btn small" onclick={oncancel}>Cancel<span class="sr-only"> {t.name}</span></button>
    {:else if retryable}
      <button class="btn small" onclick={onretry}>Try again<span class="sr-only"> {t.name}</span></button>
    {:else if t.status === 'done' && t.blob}
      <a class="btn small" href={urlFor(t.blob)} download={t.name}>Save<span class="sr-only"> {t.name}</span></a>
      <a class="btn small" href={urlFor(t.blob)} target="_blank" rel="noopener">Open<span class="sr-only"> {t.name}</span></a>
    {:else if t.status === 'done' && t.uri}
      <button class="btn small" onclick={() => openSaved(t.uri!, t.type)}>Open<span class="sr-only"> {t.name}</span></button>
    {/if}
  </div>

  {#if t.status === 'done'}<span class="stamp" aria-hidden="true">Verified</span>{/if}
</article>

<style>
  /* The list around tickets is the size container (see Transfer.svelte). */
  .ticket {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto auto;
    background: var(--slip);
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
  }
  .main {
    display: grid;
    gap: var(--s2);
    padding: var(--s4);
    min-width: 0;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: var(--s3);
    font-size: var(--t-xs);
    color: var(--ink-2);
  }
  .out .meta span:first-child {
    color: var(--ink);
    font-weight: 600;
  }
  .name {
    font-size: var(--t-xl);
    font-stretch: 70%;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 5.5rem;
  }
  .size {
    font-size: var(--t-sm);
  }

  /* Progress: a ruled gauge with tick marks. The fill advances in small mechanical steps. */
  .bar {
    position: relative;
    height: 14px;
    margin-top: var(--s2);
    border: var(--line) solid var(--rule);
    background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--rule-soft) calc(10% - 1px) 10%);
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--signal);
    transition: width 320ms steps(4, end);
  }
  .nums {
    display: flex;
    gap: var(--s4);
    font-size: var(--t-xs);
  }
  .nums span:first-child {
    min-width: 4ch;
  }
  .nums span:last-child {
    margin-left: auto;
  }
  .status {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .status.bad {
    color: var(--danger);
  }

  .tear {
    position: relative;
    border-top: 2px dotted var(--rule-soft);
  }
  .tear::before,
  .tear::after {
    content: '';
    position: absolute;
    top: -11px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--page);
    border: var(--line) solid var(--rule);
  }
  .tear::before {
    left: -11.5px;
    clip-path: inset(0 0 0 50%);
  }
  .tear::after {
    right: -11.5px;
    clip-path: inset(0 50% 0 0);
  }

  .stub {
    display: flex;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    min-height: calc(40px + var(--s3) * 2);
  }

  .stamp {
    position: absolute;
    top: 2.6rem; /* level with the file name, clear of the ticket number */
    right: var(--s4);
    padding: 3px var(--s2) 2px;
    border: 3px double var(--stamp);
    color: var(--stamp);
    font: 800 var(--t-md) / 1 var(--display);
    font-stretch: 75%;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transform: rotate(-7deg);
    animation: stamp 260ms cubic-bezier(0.2, 0, 0, 1) both;
    pointer-events: none;
  }
  @keyframes stamp {
    from {
      opacity: 0;
      transform: scale(1.9) rotate(-16deg);
    }
    70% {
      opacity: 1;
      transform: scale(0.94) rotate(-6deg);
    }
    to {
      transform: scale(1) rotate(-7deg);
    }
  }

  /* Wide: a boarding pass, stub on the right. */
  @container (min-width: 34rem) {
    .ticket {
      grid-template-rows: none;
      grid-template-columns: 1fr auto 11rem;
    }
    .main {
      padding: var(--s4) var(--s5);
    }
    .tear {
      border-top: 0;
      border-left: 2px dotted var(--rule-soft);
    }
    .tear::before,
    .tear::after {
      left: -11px;
      right: auto;
    }
    .tear::before {
      top: -11.5px;
      clip-path: inset(50% 0 0 0);
    }
    .tear::after {
      top: auto;
      bottom: -11.5px;
      clip-path: inset(0 0 50% 0);
    }
    .stub {
      flex-direction: column;
      justify-content: flex-end;
      padding: var(--s4);
    }
    .stamp {
      right: calc(11rem + var(--s5));
    }
  }
</style>
