import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { command, tracked, type CommandRow, type RowChange, type TableName } from '../db/schema'
import type { Db } from '../db/open'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Row = Record<string, unknown>
export type InsertOf<T extends TableName> = (typeof tracked)[T]['table']['$inferInsert']

// Every write goes through a command (CLAUDE.md rule 4). A command records each
// row it touched before and after, so undo restores the "before" rows and redo
// restores the "after" rows.
export class Writer {
  readonly changes: RowChange[] = []

  constructor(private readonly tx: Tx) {}

  get<T extends TableName>(table: T, id: string): Row | null {
    const { table: t, pk } = tracked[table]
    return (this.tx.select().from(t).where(eq(pk, id)).get() as Row | undefined) ?? null
  }

  insert<T extends TableName>(table: T, row: InsertOf<T>): void {
    const id = primaryKeyOf(table, row as Row)
    this.tx.insert(tracked[table].table).values(row as never).run()
    this.changes.push({ table, id, before: null, after: this.get(table, id) })
  }

  /** Applies `patch` to an existing row. Returns false (and records nothing) if nothing changed. */
  update<T extends TableName>(table: T, id: string, patch: Partial<InsertOf<T>>): boolean {
    const before = this.get(table, id)
    if (!before) throw new Error(`No ${table} row with id ${id}`)
    const changed = Object.entries(patch).some(
      ([k, v]) => v !== undefined && JSON.stringify(before[k]) !== JSON.stringify(v)
    )
    if (!changed) return false
    const { table: t, pk } = tracked[table]
    this.tx.update(t).set(patch as never).where(eq(pk, id)).run()
    this.changes.push({ table, id, before, after: this.get(table, id) })
    return true
  }
}

export interface UndoState {
  undoLabel: string | null
  redoLabel: string | null
}

export class CommandLog {
  constructor(private readonly db: Db) {}

  /** Runs `fn` in one transaction and records what it changed as one undoable step. */
  run<R>(label: string, fn: (w: Writer) => R, groupId: string | null = null): R {
    return this.db.transaction((tx) => {
      const w = new Writer(tx)
      const result = fn(w)
      if (w.changes.length > 0) {
        // A new change makes anything previously undone no longer redoable.
        tx.update(command).set({ state: 'discarded' }).where(eq(command.state, 'undone')).run()
        const next = tx
          .select({ seq: sql<number>`coalesce(max(${command.seq}), 0) + 1` })
          .from(command)
          .get()!.seq
        tx.insert(command)
          .values({
            id: randomUUID(),
            seq: next,
            at: new Date().toISOString(),
            label,
            groupId,
            payload: w.changes,
            state: 'done'
          })
          .run()
      }
      return result
    })
  }

  /** Undoes the latest change. Returns its label, or null if there is nothing to undo. */
  undo(): string | null {
    return this.db.transaction((tx) => {
      const latest = tx.select().from(command).where(eq(command.state, 'done')).orderBy(desc(command.seq)).get()
      if (!latest) return null
      for (const change of [...latest.payload].reverse()) restore(tx, change.table, change.id, change.before)
      tx.update(command).set({ state: 'undone' }).where(eq(command.id, latest.id)).run()
      return latest.label
    })
  }

  /** Redoes the most recently undone change. Returns its label, or null. */
  redo(): string | null {
    return this.db.transaction((tx) => {
      const next = tx.select().from(command).where(eq(command.state, 'undone')).orderBy(asc(command.seq)).get()
      if (!next) return null
      for (const change of next.payload) restore(tx, change.table, change.id, change.after)
      tx.update(command).set({ state: 'done' }).where(eq(command.id, next.id)).run()
      return next.label
    })
  }

  state(): UndoState {
    const undo = this.db.select().from(command).where(eq(command.state, 'done')).orderBy(desc(command.seq)).get()
    const redo = this.db.select().from(command).where(eq(command.state, 'undone')).orderBy(asc(command.seq)).get()
    return { undoLabel: undo?.label ?? null, redoLabel: redo?.label ?? null }
  }

  /** Recent changes, newest first (done and undone; discarded ones are hidden). */
  recent(limit = 50): CommandRow[] {
    return this.db
      .select()
      .from(command)
      .where(and(sql`${command.state} != 'discarded'`))
      .orderBy(desc(command.seq))
      .limit(limit)
      .all()
  }
}

function primaryKeyOf(table: TableName, row: Row): string {
  const value = table === 'campaign_settings' ? row.key : row.id
  if (typeof value !== 'string') throw new Error(`Row for ${table} has no primary key`)
  return value
}

function restore(tx: Tx, table: TableName, id: string, row: Row | null): void {
  const { table: t, pk } = tracked[table]
  if (row === null) {
    // Only reached when undoing a creation (or redoing past one): the row did not exist.
    tx.delete(t).where(eq(pk, id)).run()
    return
  }
  tx.insert(t)
    .values(row as never)
    .onConflictDoUpdate({ target: pk, set: row as never })
    .run()
}
