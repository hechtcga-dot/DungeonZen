import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// Schema migrations, applied in order. PRAGMA user_version records how many ran.
// Append new steps; never edit a step that has shipped.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE campaign_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE entity (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
    attributes TEXT NOT NULL, tags TEXT NOT NULL, status TEXT NOT NULL,
    parent_id TEXT REFERENCES entity(id), created_at TEXT NOT NULL
  );
  CREATE TABLE relationship (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES entity(id),
    target_id TEXT NOT NULL REFERENCES entity(id), type TEXT NOT NULL,
    is_secret INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE storyline (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, is_major INTEGER NOT NULL,
    status TEXT NOT NULL, bbeg_entity_id TEXT REFERENCES entity(id)
  );
  CREATE TABLE storyline_entity (
    id TEXT PRIMARY KEY, storyline_id TEXT NOT NULL REFERENCES storyline(id),
    entity_id TEXT NOT NULL REFERENCES entity(id), status TEXT NOT NULL
  );
  CREATE TABLE board (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, storyline_id TEXT REFERENCES storyline(id)
  );
  CREATE TABLE board_item (
    id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES board(id), kind TEXT NOT NULL,
    entity_id TEXT REFERENCES entity(id), x REAL NOT NULL, y REAL NOT NULL, w REAL, h REAL,
    content TEXT, status TEXT NOT NULL
  );
  CREATE TABLE command (
    id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, at TEXT NOT NULL, label TEXT NOT NULL,
    group_id TEXT, payload TEXT NOT NULL, state TEXT NOT NULL
  );
  CREATE INDEX relationship_source ON relationship(source_id);
  CREATE INDEX relationship_target ON relationship(target_id);
  CREATE INDEX board_item_board ON board_item(board_id);
  CREATE INDEX storyline_entity_storyline ON storyline_entity(storyline_id);
  CREATE INDEX command_state ON command(state, seq);
  `,
  `
  CREATE TABLE ability (
    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entity(id), name TEXT NOT NULL,
    kind TEXT NOT NULL, description TEXT NOT NULL, macro_text TEXT NOT NULL,
    show_token_action INTEGER NOT NULL, show_macro_bar INTEGER NOT NULL,
    sort INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE knowledge (
    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entity(id), field TEXT NOT NULL,
    known_from_min INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE relationship_known (
    id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES relationship(id),
    known_from_min INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE INDEX ability_entity ON ability(entity_id, sort);
  CREATE INDEX knowledge_entity ON knowledge(entity_id);
  CREATE INDEX relationship_known_rel ON relationship_known(relationship_id);
  `,
  `
  CREATE TABLE map (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, image_path TEXT NOT NULL,
    width INTEGER, height INTEGER, grid_size INTEGER, status TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE storyline ADD COLUMN emblem TEXT;
  ALTER TABLE storyline ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE act (
    id TEXT PRIMARY KEY, storyline_id TEXT NOT NULL REFERENCES storyline(id), title TEXT NOT NULL,
    summary TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
    chosen_outcome_id TEXT, status TEXT NOT NULL
  );
  CREATE TABLE act_outcome (
    id TEXT PRIMARY KEY, act_id TEXT NOT NULL REFERENCES act(id), label TEXT NOT NULL,
    description TEXT NOT NULL, is_default INTEGER NOT NULL, sort INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE story_trigger (
    id TEXT PRIMARY KEY, source_act_id TEXT NOT NULL REFERENCES act(id), outcome_id TEXT NOT NULL,
    target_storyline_id TEXT NOT NULL REFERENCES storyline(id), effect_type TEXT NOT NULL,
    payload TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE INDEX act_storyline ON act(storyline_id);
  CREATE INDEX act_outcome_act ON act_outcome(act_id);
  `,
  `
  CREATE TABLE session (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
    start_min INTEGER NOT NULL, end_min INTEGER, scene_text TEXT NOT NULL, recap TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE log_entry (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), at_min INTEGER NOT NULL, kind TEXT NOT NULL,
    text TEXT NOT NULL, entity_id TEXT REFERENCES entity(id), minutes_taken INTEGER NOT NULL, created_at TEXT NOT NULL,
    status TEXT NOT NULL
  );
  CREATE INDEX log_entry_session ON log_entry(session_id, at_min);
  `,
  `
  ALTER TABLE session ADD COLUMN player_recap TEXT NOT NULL DEFAULT '';
  ALTER TABLE log_entry ADD COLUMN feedback TEXT;
  CREATE TABLE review_decision (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), item_key TEXT NOT NULL,
    decision TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE INDEX review_decision_session ON review_decision(session_id, item_key);
  `,
  `
  ALTER TABLE map ADD COLUMN width_miles REAL;
  ALTER TABLE map ADD COLUMN travel_mph REAL NOT NULL DEFAULT 3;
  CREATE TABLE region_shape (
    id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES map(id), location_id TEXT NOT NULL REFERENCES entity(id),
    polygon TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE party_position (
    id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES map(id), x REAL NOT NULL, y REAL NOT NULL,
    location_id TEXT REFERENCES entity(id), at_min INTEGER NOT NULL, session_id TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE travel_link (
    id TEXT PRIMARY KEY, from_location_id TEXT NOT NULL REFERENCES entity(id), to_location_id TEXT NOT NULL REFERENCES entity(id),
    minutes INTEGER NOT NULL, status TEXT NOT NULL
  );
  CREATE INDEX region_shape_map ON region_shape(map_id);
  CREATE INDEX party_position_map ON party_position(map_id, at_min);
  `,
  `
  ALTER TABLE map ADD COLUMN kind TEXT NOT NULL DEFAULT 'world';
  ALTER TABLE map ADD COLUMN grid_cols INTEGER;
  ALTER TABLE map ADD COLUMN source TEXT;
  ALTER TABLE map ADD COLUMN prompt TEXT;
  CREATE TABLE style_example (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, image_path TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE session_prep (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL, title TEXT NOT NULL, premise TEXT NOT NULL, pacing_minutes INTEGER NOT NULL,
    backup_names TEXT NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL
  );
  CREATE TABLE prep_item (
    id TEXT PRIMARY KEY, prep_id TEXT NOT NULL REFERENCES session_prep(id), kind TEXT NOT NULL, sort REAL NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, scene_type TEXT, target_start INTEGER, target_end INTEGER,
    entity_id TEXT REFERENCES entity(id), location_id TEXT REFERENCES entity(id), discovery_id TEXT,
    role TEXT NOT NULL DEFAULT '', stats TEXT NOT NULL DEFAULT '', tactics TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0, done_at_min INTEGER, status TEXT NOT NULL
  );
  CREATE INDEX prep_item_prep ON prep_item(prep_id, kind, sort);
  `,
  `
  CREATE TABLE encounter_creature (
    id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES entity(id), entity_id TEXT NOT NULL REFERENCES entity(id),
    count INTEGER NOT NULL, notes TEXT NOT NULL, sort REAL NOT NULL, status TEXT NOT NULL
  );
  CREATE INDEX encounter_creature_enc ON encounter_creature(encounter_id, sort);
  ALTER TABLE log_entry ADD COLUMN encounter_id TEXT;
  `,
  `
  ALTER TABLE entity ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE relationship ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE relationship ADD COLUMN board_id TEXT;
  ALTER TABLE board_item ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE storyline ADD COLUMN colour TEXT;
  CREATE TABLE act_entity (
    id TEXT PRIMARY KEY, act_id TEXT NOT NULL REFERENCES act(id), entity_id TEXT NOT NULL REFERENCES entity(id), status TEXT NOT NULL
  );
  CREATE INDEX act_entity_entity ON act_entity(entity_id);
  `,
  // 1.2.0: distances stored metric (owner, 2026-10-06).
  `
  ALTER TABLE map ADD COLUMN width_km REAL;
  ALTER TABLE map ADD COLUMN travel_kmh REAL NOT NULL DEFAULT 4.8;
  UPDATE map SET width_km = width_miles * 1.609344, travel_kmh = travel_mph * 1.609344;
  ALTER TABLE map DROP COLUMN width_miles;
  ALTER TABLE map DROP COLUMN travel_mph;
  `,
  // 1.2.0: player character tokens that split from the party (entity_id set; joined = back with the party).
  `
  ALTER TABLE party_position ADD COLUMN entity_id TEXT;
  ALTER TABLE party_position ADD COLUMN joined INTEGER NOT NULL DEFAULT 0;
  `
]

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDb {
  sqlite: Database.Database
  db: Db
}

export function openDatabase(file: string): OpenedDb {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  return { sqlite, db: drizzle(sqlite, { schema }) }
}

export function migrate(sqlite: Database.Database): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number
  if (current > MIGRATIONS.length) {
    throw new Error(
      `This campaign was saved by a newer version of Dungeon Zen (schema ${current}). Update the app to open it.`
    )
  }
  for (let i = current; i < MIGRATIONS.length; i++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[i])
      sqlite.pragma(`user_version = ${i + 1}`)
    })()
  }
}
