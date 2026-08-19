/**
 * POSIX shell quoting for git/npm command strings (mirrors dsh-github).
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}
