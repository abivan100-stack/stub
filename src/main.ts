import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, { target: document.getElementById('app')! })

// The loading ticket (index.html) prints for about 1.6 s, then tears away: about 2 s in all.
const splash = document.getElementById('splash')
if (splash) {
  setTimeout(() => {
    splash.classList.add('torn')
    document.documentElement.classList.remove('splashing') // the screen behind arrives as the halves part
    setTimeout(() => splash.remove(), 600)
  }, Math.max(0, 1600 - performance.now()))
}

export default app
