import type Database from 'better-sqlite3';
import { Config } from '../utils/config';
import { encrypt, decrypt } from '../utils/crypto';

export interface CredentialProfile {
  id: number;
  name: string;
  agent_type: string;
  created_at: string;
}

export interface CredentialData {
  envVars: Record<string, string>;
}

export class CredentialStore {
  constructor(private db: Database.Database) {}

  list(): CredentialProfile[] {
    return this.db
      .prepare('SELECT id, name, agent_type, created_at FROM credentials ORDER BY created_at DESC')
      .all() as CredentialProfile[];
  }

  get(id: number): CredentialProfile & { data: CredentialData } {
    const row = this.db
      .prepare('SELECT * FROM credentials WHERE id = ?')
      .get(id) as (CredentialProfile & { encrypted_data: string }) | undefined;
    if (!row) throw new Error(`Credential ${id} not found`);
    const data: CredentialData = JSON.parse(decrypt(row.encrypted_data, Config.MASTER_PASSWORD));
    return { id: row.id, name: row.name, agent_type: row.agent_type, created_at: row.created_at, data };
  }

  create(name: string, agentType: string, data: CredentialData): CredentialProfile {
    const encrypted = encrypt(JSON.stringify(data), Config.MASTER_PASSWORD);
    const result = this.db
      .prepare('INSERT INTO credentials (name, agent_type, encrypted_data) VALUES (?, ?, ?)')
      .run(name, agentType, encrypted);
    return this.db
      .prepare('SELECT id, name, agent_type, created_at FROM credentials WHERE id = ?')
      .get(result.lastInsertRowid) as CredentialProfile;
  }

  update(id: number, name: string, agentType: string, data: CredentialData): CredentialProfile {
    const encrypted = encrypt(JSON.stringify(data), Config.MASTER_PASSWORD);
    const result = this.db
      .prepare('UPDATE credentials SET name = ?, agent_type = ?, encrypted_data = ? WHERE id = ?')
      .run(name, agentType, encrypted, id);
    if (result.changes === 0) throw new Error(`Credential ${id} not found`);
    return this.db
      .prepare('SELECT id, name, agent_type, created_at FROM credentials WHERE id = ?')
      .get(id) as CredentialProfile;
  }

  delete(id: number): void {
    const result = this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error(`Credential ${id} not found`);
  }
}
