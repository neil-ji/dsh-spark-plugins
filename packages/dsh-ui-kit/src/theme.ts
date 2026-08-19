/**
 * Theme helper replicating the DeepSeek Harness ui-theme DOM contract:
 * the dark flag lives on `body[data-ds-dark-theme]` and
 * `document.documentElement.style.colorScheme` mirrors it, exactly as the
 * host boot script and ThemePresenter do. All `--dsw-*` tokens are declared
 * under `body` / `body[data-ds-dark-theme]`, so this attribute pair is the
 * whole theme switch.
 */

/** Built-in preferences accepted by the settings surface. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** Default preference when no override is stored. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Narrow a wire or registry value to a persistable preference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value)
}

function isSystemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** Resolve the effective dark flag for one preference. */
export function resolveDark(preference: ThemePreference): boolean {
  return preference === 'dark' || (preference === 'system' && isSystemDark())
}

/** Apply a preference to the DOM (idempotent, SSR-safe). */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return
  const dark = resolveDark(preference)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
}

const listeners = new Set<() => void>()
let current: ThemePreference = DEFAULT_PREFERENCE
let currentDark = resolveDark(current)

function notify(): void {
  for (const listener of listeners) listener()
}

if (typeof matchMedia !== 'undefined') {
  // Follow live OS changes while the preference is `system`.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') {
      currentDark = resolveDark(current)
      applyTheme(current)
      notify()
    }
  })
}

/** Store and apply a preference; no-op for the current value. */
export function setThemePreference(preference: ThemePreference): void {
  if (current === preference) return
  current = preference
  currentDark = resolveDark(preference)
  applyTheme(preference)
  notify()
}

/** Read the stored preference. */
export function getThemePreference(): ThemePreference {
  return current
}

/** Read the effective dark flag (live for `system`). */
export function getIsDark(): boolean {
  return currentDark
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}


import { useSyncExternalStore } from 'react'

/** Subscribe a component to the current preference. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, getThemePreference)
}

/** Subscribe a component to the effective dark flag. */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, getIsDark, getIsDark)
}
