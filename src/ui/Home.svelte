<script lang="ts">
  import { decodeDirect, directUrl } from '../pairing'
  import { bytes, plural } from './format'
  import { THEMES, savedTheme, setTheme, type Theme } from './theme'

  let {
    onsend,
    onreceive,
    offlineReady,
    shared = [],
    onclearshared,
    onhost,
    codeEntry = false,
  }: {
    onsend: () => void
    onreceive: () => void
    offlineReady: boolean
    shared?: File[]
    onclearshared?: () => void
    /** Android app only: show the phone's address so a laptop can pair without scanning. */
    onhost?: () => void
    /** Web only: type the short code a phone shows under "Connect a laptop". */
    codeEntry?: boolean
  } = $props()

  let theme = $state<Theme>(savedTheme())
  const themeLabel: Record<Theme, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' }

  function nextTheme(e: MouseEvent) {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTheme(theme, r.left + r.width / 2, r.top + r.height / 2)
  }

  let code = $state('')
  let codeProblem = $state<string | null>(null)

  function goToPhone(e: SubmitEvent) {
    e.preventDefault()
    const target = decodeDirect(code)
    if (!target) {
      codeProblem = 'That isn’t a phone code. Check it on the phone and try again.'
      return
    }
    // The phone serves Stub itself; the PIN rides in the #fragment, which never leaves this browser.
    location.href = directUrl(target)
  }
</script>

<main class="home">
  <header class="top">
    <span class="mark"><img src="/icon.svg" alt="" />Stub</span>
    <div class="tools">
      <span class="ready mono" class:on={offlineReady}><span class="words">{offlineReady ? 'Works offline' : 'Saving for offline use'}</span></span>
      <button class="theme mono" onclick={nextTheme} aria-label="Theme: {themeLabel[theme]}. Tap to change.">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          {#if theme === 'light'}
            <circle cx="8" cy="8" r="3.2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
          {:else if theme === 'dark'}
            <path d="M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1Z" />
          {:else}
            <circle cx="8" cy="8" r="6" />
            <path class="fill" d="M8 2a6 6 0 0 1 0 12Z" />
          {/if}
        </svg>
        {themeLabel[theme]}
      </button>
    </div>
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
  {#if codeEntry}
    <form class="phonecode" onsubmit={goToPhone}>
      <label for="phone-code">Got a code from a phone?</label>
      <div class="row">
        <input
          id="phone-code"
          class="mono"
          bind:value={code}
          oninput={() => (codeProblem = null)}
          placeholder="7KQ-2MX4"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          aria-describedby={codeProblem ? 'phone-code-problem' : undefined}
        />
        <button class="btn small" type="submit" disabled={!code.trim()}>Connect</button>
      </div>
      {#if codeProblem}<p id="phone-code-problem" class="problem" role="alert">{codeProblem}</p>{/if}
    </form>
  {/if}
  {#if onhost}
    <button class="laptop" onclick={onhost}>
      <span>Connect another device</span>
      <span class="quiet">Laptop or phone: no scanning, works on this phone’s hotspot</span>
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
    grid-template-columns: minmax(0, 1fr); /* no child can stretch the page past a narrow phone */
    grid-template-rows: auto auto minmax(19rem, 1fr) auto;
    gap: var(--s5);
    max-width: 72rem;
    margin: 0 auto;
    padding: env(safe-area-inset-top) var(--s4) calc(var(--s6) + env(safe-area-inset-bottom));
  }

  .top {
    grid-area: top;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    padding-top: var(--s4);
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    font: 800 var(--t-xl) / 1 var(--display);
    font-stretch: 62%;
  }
  .mark img {
    width: 1.5em;
    height: 1.5em;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: var(--s4);
  }
  .theme {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    min-height: 36px;
    padding: 0 var(--s3);
    border: var(--line) solid var(--rule);
    border-radius: 999px;
    background: var(--slip);
    color: var(--ink);
    font-size: var(--t-xs);
    cursor: pointer;
  }
  .theme svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    transition: transform 420ms cubic-bezier(0.3, 0, 0, 1);
  }
  .theme svg .fill {
    fill: currentColor;
    stroke: none;
  }
  .theme:hover svg,
  .theme:focus-visible svg {
    transform: rotate(-25deg);
  }
  .theme:active {
    transform: translateY(1px);
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
  /* Narrow phones: the dot alone, so the header stays one line; the words stay for screen readers. */
  @media (max-width: 26rem) {
    .ready .words {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
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
    margin-bottom: var(--s4);
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
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s4);
  }
  .phonecode {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s2);
    font-size: var(--t-sm);
  }
  .phonecode .row {
    display: flex;
    gap: var(--s2);
  }
  .phonecode input {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 0 var(--s3);
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    background: var(--slip);
    color: var(--ink);
    font-size: var(--t-md);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .phonecode .problem {
    padding-left: var(--s3);
    border-left: 4px solid var(--danger);
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
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
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
