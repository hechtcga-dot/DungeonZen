import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A plain text log of errors (userData/logs/dungeonzen.log) for bug reports: Setup › Open log folder.
// Over 1 MB it moves to dungeonzen.old.log (the one before is replaced), so it never grows without end.
let dir = ''
export const logFolder = () => dir

export function startLog(userData: string): void {
  dir = join(userData, 'logs')
  mkdirSync(dir, { recursive: true })
}

export function logError(where: string, err: unknown): void {
  if (!dir) return
  const file = join(dir, 'dungeonzen.log')
  try {
    if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, join(dir, 'dungeonzen.old.log'))
    const text = err instanceof Error ? err.stack ?? err.message : String(err)
    appendFileSync(file, `${new Date().toISOString()} [${where}] ${text}\n`)
  } catch { /* the log never stops the app */ }
}
