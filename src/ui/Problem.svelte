<script lang="ts">
  import Bar from './Bar.svelte'
  import { PROBLEMS, type ProblemKind } from './problems'

  let { kind, detail = '', onhome }: { kind: ProblemKind; detail?: string; onhome: () => void } = $props()
  const p = $derived(PROBLEMS[kind])
</script>

<Bar />

<main class="problem" role="alert">
  <div class="slip notice">
    <span class="mark" aria-hidden="true">Void</span>
    <h1>{p.title}</h1>
    <p>{p.fix}</p>
  </div>
  {#if detail}
    <details class="detail">
      <summary>Details for troubleshooting</summary>
      <pre class="mono">{detail}</pre>
    </details>
  {/if}
  <button class="btn go wide" onclick={onhome}>Start again</button>
</main>

<style>
  .problem {
    display: grid;
    gap: var(--s5);
    width: 100%;
    max-width: 30rem;
    margin: 0 auto;
    padding: var(--s6) var(--s4) var(--s7);
  }
  .notice {
    position: relative;
    display: grid;
    gap: var(--s4);
    padding: var(--s6) var(--s5);
    overflow: hidden;
  }
.detail summary {
    cursor: pointer;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .detail pre {
    margin: var(--s2) 0 0;
    font-size: var(--t-xs);
    white-space: pre-wrap;
    word-break: break-all;
  }
  h1 {
    font-size: var(--t-xl);
    line-height: 1;
    max-width: 14ch;
  }
  /* A cancelled ticket gets a VOID stamp, struck through. */
  .mark {
    justify-self: start;
    padding: 2px var(--s2);
    border: 2px solid var(--danger);
    color: var(--danger);
    font: 800 var(--t-sm) / 1.2 var(--display);
    font-stretch: 75%;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transform: rotate(-4deg);
  }
</style>
