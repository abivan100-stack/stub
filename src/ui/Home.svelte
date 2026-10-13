<script lang="ts">
  import { bytes, plural } from './format'

  let {
    onsend,
    onreceive,
    offlineReady,
    shared = [],
    onclearshared,
    onhost,
  }: {
    onsend: () => void
    onreceive: () => void
    offlineReady: boolean
    shared?: File[]
    onclearshared?: () => void
    /** Android app only: show the phone's address so a laptop can pair without scanning. */
    onhost?: () => void
  } = $props()
</script>

<main class="home">
  <header class="top">
    <span class="mark">Stub</span>
    <span class="ready mono" class:on={offlineReady}>{offlineReady ? 'Works offline' : 'Saving for offline use'}</span>
  </header>

  <section class="intro">
    <h1>Pass files across the room.</h1>
    <p class="lede">
      Phone to phone, or laptop to phone, over the same Wi-Fi or hotspot. No internet, no account, nothing uploaded.
    </p>
    {#if shared.length}
      <div class="ready-to-send" role="status">
        <p>
          <strong>{plural(shared.length, 'file')}, {bytes(shared.reduce((n, f) => n + f.size, 0))} ready to send.</strong>
          Tap Send and pair with the other device.
        </p>
        <button class="link" onclick={onclearshared}>Clear</button>
      </div>
    {/if}
  </section>

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

  <div class="more">
  {#if onhost}
    <button class="laptop" onclick={onhost}>
      <span>Connect a laptop</span>
      <span class="quiet">Type an address and a PIN instead of scanning</span>
    </button>
  {/if}

  <ol class="steps">
    <li><span class="n mono">1</span>Tap Send on one device and Receive on the other.</li>
    <li><span class="n mono">2</span>Scan each other’s code.</li>
    <li><span class="n mono">3</span>Check the six digits match, then pick your files.</li>
  </ol>
  </div>
</main>

<style>
  .home {
    min-height: 100dvh;
    display: grid;
    grid-template-areas: 'top' 'intro' 'pass' 'steps';
    grid-template-rows: auto auto minmax(19rem, 1fr) auto;
    gap: var(--s5);
    max-width: 72rem;
    margin: 0 auto;
    padding: env(safe-area-inset-top) var(--s4) calc(var(--s6) + env(safe-area-inset-bottom));
  }

  .top {
    grid-area: top;
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
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    font-size: var(--t-xs);
    color: var(--ink-2);
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

  .intro {
    grid-area: intro;
    display: grid;
    gap: var(--s3);
  }
  h1 {
    font-size: clamp(2.6rem, 11vw, 5.5rem);
    font-stretch: 62%;
    line-height: 0.9;
    max-width: 9ch;
  }
  .lede {
    max-width: 34ch;
    color: var(--ink-2);
  }

  .ready-to-send {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    border-left: 4px solid var(--signal);
    background: var(--slip);
    font-size: var(--t-sm);
  }

  /* One ticket, torn in two. */
  .pass {
    grid-area: pass;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    background: var(--slip);
  }
  .half {
    appearance: none;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    gap: var(--s2);
    padding: var(--s5);
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .send {
    background: var(--signal);
    color: var(--on-signal);
    border-radius: 1px 1px 0 0;
  }
  .word {
    font: 800 clamp(4rem, 17vw, 7.5rem) / 0.8 var(--display);
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
    font-weight: 500;
  }
  .half:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: -9px;
  }

  .tear {
    position: relative;
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

  .more {
    grid-area: steps;
    display: grid;
    gap: var(--s4);
  }
  .laptop {
    appearance: none;
    display: grid;
    gap: 2px;
    padding: var(--s3) var(--s4);
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    background: var(--slip);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .laptop span:first-child {
    font-weight: 650;
  }
  .laptop .quiet {
    font-size: var(--t-sm);
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--line) solid var(--rule);
  }
  .steps li {
    display: flex;
    gap: var(--s3);
    padding: var(--s3) 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: var(--t-sm);
  }
  .n {
    flex: none;
    width: 1.5rem;
    color: var(--ink-2);
  }

  /* Desktop: words on the left, the ticket on the right, all in one screen. */
  @media (min-width: 60rem) {
    .home {
      height: 100dvh;
      min-height: 40rem;
      grid-template-areas: 'top top' 'intro pass' 'steps pass';
      grid-template-columns: 1fr minmax(0, 1.05fr);
      grid-template-rows: auto 1fr auto;
      column-gap: var(--s8);
      row-gap: var(--s6);
      padding-inline: var(--s6);
      padding-bottom: var(--s6);
    }
    .intro {
      align-self: end;
      gap: var(--s5);
    }
    .lede {
      font-size: var(--t-lg);
      line-height: 1.35;
    }
    .half {
      padding: var(--s6);
    }
  }
</style>
