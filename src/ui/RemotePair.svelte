<script lang="ts">
  import { pairThroughPhone, PinError, type Link } from '../pairing'
  import type { ProblemKind } from './problems'
  import Bar from './Bar.svelte'

  let {
    onlink,
    onfail,
    onback,
  }: { onlink: (l: Link) => void; onfail: (k: ProblemKind, detail?: string) => void; onback: () => void } = $props()

  let pin = $state('')
  let busy = $state(false)
  let problem = $state<string | null>(null)
  let input = $state<HTMLInputElement>()

  $effect(() => input?.focus())

  // Arrived from a phone code on the Stub website: the PIN is in the #fragment. Use it once, then drop it.
  $effect(() => {
    const m = /^#pin=(\d{4})$/.exec(location.hash)
    if (!m) return
    history.replaceState(null, '', location.pathname + location.search)
    pin = m[1]!
    void connect()
  })

  async function connect(e?: SubmitEvent) {
    e?.preventDefault()
    if (pin.length !== 4 || busy) return
    busy = true
    problem = null
    try {
      onlink(await pairThroughPhone(pin))
    } catch (err) {
      busy = false
      problem = err instanceof Error ? err.message : String(err)
      if (err instanceof PinError) {
        pin = ''
        input?.focus()
      }
    }
  }
</script>

<Bar {onback} />

<main class="remote">
  <div class="copy">
    <h1>Enter the PIN on the phone</h1>
    <p class="quiet">The phone that showed you this address also shows a 4-digit PIN.</p>
  </div>

  <form class="slip panel" onsubmit={connect}>
    <label for="pin" class="label">PIN</label>
    <input
      id="pin"
      class="pin mono"
      bind:this={input}
      bind:value={pin}
      oninput={() => (pin = pin.replace(/\D/g, '').slice(0, 4))}
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="4"
      placeholder="0000"
      disabled={busy}
      aria-describedby={problem ? 'pin-problem' : undefined}
    />
    {#if problem}<p id="pin-problem" class="problem" role="alert">{problem}</p>{/if}
    <button class="btn go wide" type="submit" disabled={pin.length !== 4 || busy}>{busy ? 'Connecting' : 'Connect'}</button>
  </form>
</main>

<style>
  .remote {
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
  .panel {
    display: grid;
    gap: var(--s4);
    padding: var(--s5);
  }
  .label {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }
  .pin {
    width: 100%;
    padding: var(--s3) var(--s4);
    border: var(--line) solid var(--rule);
    border-radius: var(--radius);
    background: var(--page);
    color: var(--ink);
    font-size: 2.5rem;
    letter-spacing: 0.3em;
    text-align: center;
  }
  .problem {
    padding: var(--s3);
    border-left: 4px solid var(--danger);
    font-size: var(--t-sm);
  }
</style>
