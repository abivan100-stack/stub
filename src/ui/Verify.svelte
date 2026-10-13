<script lang="ts">
  import Bar from './Bar.svelte'
  import { spaced } from './format'

  let { code, onmatch, onmismatch }: { code: string; onmatch: () => void; onmismatch: () => void } = $props()
  const chars = $derived([...spaced(code)])
</script>

<Bar><span class="quiet small">Connected</span></Bar>

<main class="verify">
  <div class="copy">
    <h1>Check the code</h1>
    <p class="quiet">Both screens should show the same six digits.</p>
  </div>

  <div class="slip receipt">
    <p class="sr-only">Your code is {code.split('').join(' ')}</p>
    <p class="code mono" aria-hidden="true">
      {#each chars as c, i}<span style="--i: {i}">{c}</span>{/each}
    </p>
  </div>

  <div class="actions">
    <button class="btn go wide" onclick={onmatch}>Match</button>
    <button class="btn wide" onclick={onmismatch}>Doesn’t match</button>
  </div>
</main>

<style>
  .small {
    font-size: var(--t-sm);
  }
  .verify {
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
  .receipt {
    padding: var(--s7) var(--s4);
  }
  .code {
    margin: 0 auto;
    text-align: center;
    font-size: clamp(3rem, 15vw, 4.5rem);
    font-weight: 500;
    line-height: 1;
    white-space: pre;
  }
  /* The digits print in, one per tick. */
  .code span {
    display: inline-block;
    animation: print 120ms steps(3, end) both;
    animation-delay: calc(var(--i) * 110ms + 150ms);
  }
  @keyframes print {
    from {
      clip-path: inset(0 0 100% 0);
      transform: translateY(-0.15em);
    }
    to {
      clip-path: inset(0);
      transform: none;
    }
  }
  .actions {
    display: grid;
    gap: var(--s4);
  }
</style>
