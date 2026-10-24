<script lang="ts">
  import type { Snippet } from 'svelte'

  let { onback, step, children }: { onback?: () => void; step?: [number, number]; children?: Snippet } = $props()
</script>

<header class="bar">
  {#if onback}
    <button class="back" onclick={onback}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
      Back
    </button>
  {:else}
    <span class="mark"><img src="/icon.svg" alt="" />Stub</span>
  {/if}
  {#if step}
    <span class="step mono" aria-label="Step {step[0]} of {step[1]}">
      {#each { length: step[1] } as _, i}<span class="pip" class:on={i < step[0]}></span>{/each}
      Step {step[0]} of {step[1]}
    </span>
  {/if}
  {#if children}<div class="end">{@render children()}</div>{/if}
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s4);
    min-height: 60px;
    padding: 0 var(--s4);
    padding-top: env(safe-area-inset-top);
    border-bottom: var(--line) solid var(--rule);
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    font: 800 var(--t-lg) / 1 var(--display);
    font-stretch: 62%;
    letter-spacing: 0.01em;
  }
  .mark img {
    width: 1.5em;
    height: 1.5em;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-height: 44px;
    margin-left: calc(var(--s2) * -1);
    padding: 0 var(--s2);
    border: 0;
    background: none;
    color: var(--ink);
    font: 600 var(--t-sm) var(--body);
    cursor: pointer;
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
  }
  .pip {
    width: 18px;
    height: 6px;
    border: var(--line) solid var(--rule);
  }
  .pip.on {
    background: var(--signal);
  }
  .pip:last-of-type {
    margin-right: var(--s2);
  }
  .end {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
</style>
