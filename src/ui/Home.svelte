<script lang="ts">
  let { onsend, onreceive, offlineReady }: { onsend: () => void; onreceive: () => void; offlineReady: boolean } = $props()
</script>

<main class="home">
  <header class="top">
    <span class="mark">Stub</span>
    <span class="ready mono" class:on={offlineReady}>{offlineReady ? 'Works offline' : 'Saving for offline use'}</span>
  </header>

  <div class="pass">
    <button class="half send" onclick={onsend}>
      <span class="word">Send</span>
      <span class="sub">Show a code, then scan theirs.</span>
    </button>
    <div class="tear" aria-hidden="true"></div>
    <button class="half receive" onclick={onreceive}>
      <span class="word">Receive</span>
      <span class="sub">Scan their code, then show yours.</span>
    </button>
  </div>

  <p class="foot quiet">Both devices on the same Wi-Fi or hotspot. Files go straight across and are never uploaded.</p>
</main>

<style>
  .home {
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--s4);
    padding: env(safe-area-inset-top) var(--s4) calc(var(--s4) + env(safe-area-inset-bottom));
    max-width: 72rem;
    margin: 0 auto;
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-top: var(--s4);
  }
  .mark {
    font: 800 var(--t-xl) / 1 var(--display);
    font-stretch: 62%;
  }
  .ready {
    font-size: var(--t-xs);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
  }
  .ready::before {
    content: '';
    width: 8px;
    height: 8px;
    border: var(--line) solid var(--ink-2);
    border-radius: 50%;
  }
  .ready.on::before {
    background: var(--ink-2);
  }

  /* One ticket, torn in two. */
  .pass {
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    background: var(--slip);
    min-height: 0;
  }
  .half {
    appearance: none;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    gap: var(--s2);
    min-height: 34vh;
    padding: var(--s5);
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    font: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  .send {
    background: var(--signal);
    color: var(--on-signal);
    border-radius: 1px 1px 0 0;
  }
  .word {
    font: 800 var(--t-3xl) / 0.8 var(--display);
    font-stretch: 62%;
    letter-spacing: -0.02em;
    transition: font-stretch 180ms cubic-bezier(0.3, 0, 0, 1);
  }
  .half:hover .word,
  .half:focus-visible .word {
    font-stretch: 72%;
  }
  .half:active .word {
    font-stretch: 66%;
  }
  .sub {
    font-size: var(--t-md);
    font-weight: 500;
  }
  .half:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: -9px;
  }

  .tear {
    position: relative;
    height: 0;
    border-top: 2px dotted var(--rule);
    margin: 0 calc(var(--line) * -1);
  }
  .tear::before,
  .tear::after {
    content: '';
    position: absolute;
    top: -13px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--page);
    border: var(--line) solid var(--rule);
  }
  .tear::before {
    left: -12px;
    clip-path: inset(0 0 0 50%);
  }
  .tear::after {
    right: -12px;
    clip-path: inset(0 50% 0 0);
  }

  .foot {
    font-size: var(--t-sm);
  }

  @media (min-width: 52rem) {
    .home {
      padding-inline: var(--s6);
      gap: var(--s5);
    }
    .pass {
      grid-template-rows: none;
      grid-template-columns: 1fr auto 1fr;
    }
    .half {
      min-height: 0;
      padding: var(--s6);
    }
    .send {
      border-radius: 1px 0 0 1px;
    }
    .tear {
      height: auto;
      width: 0;
      border-top: 0;
      border-left: 2px dotted var(--rule);
      margin: calc(var(--line) * -1) 0;
    }
    .tear::before,
    .tear::after {
      left: -13px;
      right: auto;
    }
    .tear::before {
      top: -12px;
      clip-path: inset(50% 0 0 0);
    }
    .tear::after {
      top: auto;
      bottom: -12px;
      clip-path: inset(0 0 50% 0);
    }
  }
</style>
