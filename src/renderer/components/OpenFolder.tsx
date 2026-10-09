import { useBoard } from '../store'
import type { IpcInput } from '../../shared/ipc'

/** A link that opens one of the campaign's folders in Explorer (to upload files to other sites, or back up). */
export function OpenFolder({ sub, label = 'Open folder', className = 'link-button' }: { sub: IpcInput<'campaign:openFolder'>['sub']; label?: string; className?: string }) {
  const act = useBoard((s) => s.act)
  return <button type="button" className={className} title="Show the files in Explorer" onClick={() => void act('campaign:openFolder', { sub })}>{label}</button>
}
