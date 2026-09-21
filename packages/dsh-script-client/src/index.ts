/**
 * Host loader entry for the browser implementation exported from './client'.
 * The node half has no behavior — it exists so the bundle's cordis.patch.yml row
 * loads this package, and dsh-client-modules scans its dsh.client declaration
 * into window.__DSH_BOOT__（与 npm-ui / github-ui 同形）。
 */
export function apply(): void {}
