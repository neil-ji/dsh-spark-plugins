/**
 * Lazy accessor for host remote namespaces (mounted asynchronously by their
 * client bundles — must be read at pane load time, not apply time).
 */
let getReflect: ((id: string) => unknown) | undefined

export function setReflectGetter(get: (id: string) => unknown): void {
  getReflect = get
}

export function getNamespace<T>(id: string): T | undefined {
  if (getReflect === undefined) return undefined
  try {
    return getReflect(id) as T | undefined
  } catch {
    return undefined
  }
}
