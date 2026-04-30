import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { SessionStore } from '../services/session-store';

describe('SessionStore', () => {
  let db: Database.Database;
  let store: SessionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    store = new SessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  function createSession(name: string): number {
    const repoId = db
      .prepare('INSERT INTO repos (name, path, source) VALUES (?, ?, ?)')
      .run(`${name}-repo`, `/tmp/${name}-repo`, 'local').lastInsertRowid as number;
    return db
      .prepare('INSERT INTO sessions (repo_id, agent_type, name) VALUES (?, ?, ?)')
      .run(repoId, 'codex', name).lastInsertRowid as number;
  }

  it('indexes normalized log text with searchable session metadata', () => {
    const sessionId = createSession('searchable-session');
    const otherSessionId = createSession('other-session');

    const logId = store.appendLog(sessionId, Buffer.from('\x1b[32mneedle result ready\x1b[0m'));
    store.appendLog(otherSessionId, Buffer.from('needle belongs to another session'));

    const results = store.searchLogs(sessionId, 'needle');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      log_id: logId,
      snippet: expect.stringContaining('<mark>needle</mark>'),
    });
  });
});
