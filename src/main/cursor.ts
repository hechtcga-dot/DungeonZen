import { execFile } from 'node:child_process'

// Windows hides the mouse pointer while the DM types (the campaign name) and shows it again only on real mouse input.
// A folder window opened right after typing kept it hidden (owner, 2026-10-09 and 2026-10-22). A move sent into the
// page (2.7.0) never reached Windows, so this moves the real pointer one step right and back through user32.
const SCRIPT = "Add-Type -Name M -Namespace DZ -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(int f, int x, int y, int d, int e);'; [DZ.M]::mouse_event(1, 1, 0, 0, 0); [DZ.M]::mouse_event(1, -1, 0, 0, 0)"

/** PowerShell arguments that nudge the pointer (encoded: no quoting problems). */
export function wakeCursorArgs(): string[] {
  return ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')]
}

/** Shows the pointer again on Windows; not awaited, so it lands while the folder window is open. Nothing elsewhere. */
export function wakeCursor(): void {
  if (process.platform !== 'win32') return
  execFile('powershell.exe', wakeCursorArgs(), { windowsHide: true, timeout: 10000 }, () => { /* best effort */ })
}
