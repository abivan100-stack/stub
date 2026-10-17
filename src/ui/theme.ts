// Light, dark, or follow the device. The choice lives in this browser (or app) only.
// index.html applies it before first paint; this module changes it.

export type Theme = 'auto' | 'light' | 'dark'
export const THEMES: Theme[] = ['auto', 'light', 'dark']
const KEY = 'stub-theme'

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'auto'
  } catch {
    return 'auto' // storage blocked: follow the device
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme
  // Browser chrome (address bar, Android status bar in the PWA) follows the page colour.
  const page = getComputedStyle(root).getPropertyValue('--page').trim()
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.content = page
    m.removeAttribute('media')
  }
}

/** Switch theme. With View Transitions, the new colours grow as a circle from (x, y). */
export function setTheme(theme: Theme, x = innerWidth / 2, y = 0) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // not saved; still applies for this visit
  }
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || still) return apply(theme)
  const root = document.documentElement
  root.style.setProperty('--vt-x', `${x}px`)
  root.style.setProperty('--vt-y', `${y}px`)
  document.startViewTransition(() => apply(theme))
}
