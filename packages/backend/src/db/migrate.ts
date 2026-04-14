import type Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA);
}
