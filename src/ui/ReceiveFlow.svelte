<script lang="ts">
  import { acceptOffer, type Answer, type Link } from '../pairing'
  import { failureOf, inlineProblem, type ProblemKind } from './problems'
  import Bar from './Bar.svelte'
  import QrCode from './QrCode.svelte'
  import Scanner from './Scanner.svelte'

  let { onlink, onfail, onback }: { onlink: (l: Link) => void; onfail: (k: ProblemKind) => void; onback: () => void } =
    $props()

  let answer = $state<Answer | null>(null)
  let reading = $state(false)
  let problem = $state<string | null>(null)
  let attempt = $state(0)
  let linked = false
  let gone = false

  $effect(() => () => {
    gone = true
    if (!linked) answer?.cancel()
  })

  async function scanned(text: string) {
    reading = true
    problem = null
    try {
      const a = await acceptOffer(text)
      if (gone) return a.cancel()
      answer = a
      a.link.then(
        (l) => {
          linked = true
          onlink(l)
        },
        (e) => !gone && onfail(failureOf(e) as ProblemKind),
      )
    } catch (e) {
      const kind = failureOf(e)
      problem = inlineProblem(kind, 'offer')
      if (!problem) return onfail(kind as ProblemKind)
      attempt++
    } finally {
      reading = false
    }
  }
</script>

<Bar {onback} step={[answer ? 2 : 1, 2]} />

<main class="pair">
  {#if !answer}
    <div class="copy">
      <h1>Scan their code</h1>
      <p class="quiet">Point at the screen that tapped Send.</p>
    </div>
    <div class="slip panel">
      {#if reading}
        <p class="wait mono" role="status">Reading code</p>
      {:else}
        {#key attempt}<Scanner onresult={scanned} label="Camera view for scanning their code" />{/key}
      {/if}
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
    </div>
  {:else}
    <div class="copy">
      <h1>Let them scan this</h1>
      <p class="quiet" role="status">Waiting for them to scan</p>
    </div>
    <div class="slip panel">
      <QrCode payload={answer.payload} label="Reply code for the other device to scan" />
    </div>
  {/if}
</main>

<style>
  .pair {
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
    padding: var(--s4);
  }
  .wait {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    max-width: 340px;
    margin: 0 auto;
    font-size: var(--t-sm);
  }
  .problem {
    margin-top: var(--s4);
    padding: var(--s3);
    border-left: 4px solid var(--danger);
    font-size: var(--t-sm);
  }
</style>
