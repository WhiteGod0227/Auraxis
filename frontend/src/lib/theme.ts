import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'auraxis.theme'
const listeners = new Set<() => void>()

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function apply(theme: Theme, animate: boolean) {
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-anim')
    window.setTimeout(() => root.classList.remove('theme-anim'), 450)
  }
  root.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f6f6f4' : '#0a0a0b')
  listeners.forEach((listener) => listener())
}

/** Explicit choice from the toggle; remembered for next visits. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  apply(theme, true)
}

/** Call once at start-up: stored choice, else follow the device. */
export function initTheme() {
  apply(storedTheme() ?? systemTheme(), false)
  window
    .matchMedia?.('(prefers-color-scheme: light)')
    .addEventListener?.('change', (event) => {
      if (!storedTheme()) apply(event.matches ? 'light' : 'dark', true)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'dark')
}
