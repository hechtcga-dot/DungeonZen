import type { DungeonZenApi, IpcChannel, IpcInput, IpcOutputs } from '../shared/ipc'

declare global {
  interface Window { dungeonzen: DungeonZenApi }
}

/** Calls the main process; throws an Error with a readable message on failure. */
export async function call<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutputs[C]> {
  const result = await window.dungeonzen.invoke(channel, input)
  if (!result.ok) throw new Error(result.error)
  return result.value
}
