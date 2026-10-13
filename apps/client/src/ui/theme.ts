import { settings, type ThemePref } from './settings.js'

export type Theme = 'light' | 'dark'

const media = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<(theme: Theme) => void>()

let resolved: Theme = 'dark'

function resolve(pref: ThemePref): Theme {
  if (pref === 'auto') return media.matches ? 'dark' : 'light'
  return pref
}

function apply(): void {
  const next = resolve(settings.get().theme)
  const changed = next !== resolved
  resolved = next
  const root = document.documentElement
  root.dataset.theme = next
  root.style.colorScheme = next
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = next === 'dark' ? '#0d0822' : '#ffe9c7'
  if (changed) for (const fn of listeners) fn(next)
}

/** Aktuell wirksames Theme (Auto bereits aufgeloest). */
export function currentTheme(): Theme {
  return resolved
}

export function onThemeChange(fn: (theme: Theme) => void): void {
  listeners.add(fn)
}

/** Hell <-> Dunkel (aus "auto" wird dabei eine feste Wahl). */
export function toggleTheme(): Theme {
  const next: Theme = resolved === 'dark' ? 'light' : 'dark'
  settings.set({ theme: next })
  return next
}

export function initTheme(): void {
  apply()
  settings.subscribe((_s, changed) => {
    if (changed.includes('theme')) apply()
  })
  // Bei "auto" dem Betriebssystem live folgen.
  media.addEventListener('change', () => {
    if (settings.get().theme === 'auto') apply()
  })
}
