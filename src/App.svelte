<script lang="ts">
  import { registerSW } from 'virtual:pwa-register'
  import type { Link } from './pairing'
  import { Peer } from './transfer'
  import Home from './ui/Home.svelte'
  import SendFlow from './ui/SendFlow.svelte'
  import ReceiveFlow from './ui/ReceiveFlow.svelte'
  import Verify from './ui/Verify.svelte'
  import Transfer from './ui/Transfer.svelte'
  import Problem from './ui/Problem.svelte'
  import type { ProblemKind } from './ui/problems'

  type View = 'home' | 'send' | 'receive' | 'verify' | 'transfer' | 'problem'

  let view = $state<View>('home')
  let link = $state.raw<Link | null>(null)
  let peer = $state.raw<Peer | null>(null)
  let problem = $state<ProblemKind>('network')
  let offlineReady = $state(!!navigator.serviceWorker?.controller)

  registerSW({ immediate: true, onOfflineReady: () => (offlineReady = true) })

  function linked(l: Link) {
    link = l
    // Start listening now: the other side may confirm first and send an offer while we verify.
    peer = new Peer(l.channel)
    view = 'verify'
  }

  function fail(kind: ProblemKind) {
    disconnect()
    problem = kind
    view = 'problem'
  }

  function disconnect() {
    link?.close()
    link = null
    peer = null
  }

  function home() {
    disconnect()
    view = 'home'
  }

  $effect(() => {
    window.scrollTo(0, 0)
    document.title = view === 'transfer' ? 'Stub, connected' : 'Stub'
    void view
  })
</script>

{#if view === 'home'}
  <Home {offlineReady} onsend={() => (view = 'send')} onreceive={() => (view = 'receive')} />
{:else if view === 'send'}
  <SendFlow onlink={linked} onfail={fail} onback={home} />
{:else if view === 'receive'}
  <ReceiveFlow onlink={linked} onfail={fail} onback={home} />
{:else if view === 'verify' && link}
  <Verify code={link.code} onmatch={() => (view = 'transfer')} onmismatch={() => fail('mismatch')} />
{:else if view === 'transfer' && peer && link}
  <Transfer {peer} code={link.code} onleave={home} />
{:else if view === 'problem'}
  <Problem kind={problem} onhome={home} />
{/if}
