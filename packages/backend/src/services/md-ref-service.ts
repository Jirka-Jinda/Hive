import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { MdFile } from './mdfile-manager';

export interface ResolvedMdFile {
  file: MdFile;
  content: string;
}

export interface ResolvedSessionContextItem extends ResolvedMdFile {
  order: number;
  basename: string;
  source: 'repo-ref' | 'repo-override' | 'session-ref';
}

export class MdRefService {
  constructor(private db: Database.Database) {}

  // ── Repo-level refs ──────────────────────────────────────────────────────

  getRepoRefs(repoId: number): MdFile[] {
    return this.db
      .prepare(
        `SELECT mf.* FROM md_files mf
         JOIN repo_md_refs r ON r.md_file_id = mf.id
         WHERE r.repo_id = ?
         ORDER BY mf.path`
      )
      .all(repoId) as MdFile[];
  }

  setRepoRefs(repoId: number, mdFileIds: number[]): void {
    const del = this.db.prepare('DELETE FROM repo_md_refs WHERE repo_id = ?');
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO repo_md_refs (repo_id, md_file_id) VALUES (?, ?)'
    );
    this.db.transaction(() => {
      del.run(repoId);
      for (const id of mdFileIds) ins.run(repoId, id);
    })();
  }

  // ── Session-level refs ───────────────────────────────────────────────────

  getSessionRefs(sessionId: number): MdFile[] {
    return this.db
      .prepare(
        `SELECT mf.* FROM md_files mf
         JOIN session_md_refs s ON s.md_file_id = mf.id
         WHERE s.session_id = ?
         ORDER BY mf.path`
      )
      .all(sessionId) as MdFile[];
  }

  setSessionRefs(sessionId: number, mdFileIds: number[]): void {
    const del = this.db.prepare('DELETE FROM session_md_refs WHERE session_id = ?');
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO session_md_refs (session_id, md_file_id) VALUES (?, ?)'
    );
    this.db.transaction(() => {
      del.run(sessionId);
      for (const id of mdFileIds) ins.run(sessionId, id);
    })();
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  /**
   * Resolves the effective set of MD files for a session with override priority:
   *
   *   session-level refs (highest)
   *     > repo-scoped file with same basename as a central repo-ref
   *       > repo-level central refs (lowest)
   *
   * Files are deduplicated by basename — higher priority wins.
   */
  resolveSessionContext(sessionId: number, repoId: number): ResolvedMdFile[] {
    return this.resolveSessionContextDetailed(sessionId, repoId).map(({ file, content }) => ({ file, content }));
  }

  resolveSessionContextDetailed(sessionId: number, repoId: number): ResolvedSessionContextItem[] {
    const repoRefs = this.getRepoRefs(repoId);
    const sessionRefs = this.getSessionRefs(sessionId);
    const repoScopedFiles = this.db
      .prepare('SELECT * FROM md_files WHERE scope = ? AND repo_id = ?')
      .all('repo', repoId) as MdFile[];

    // Map keyed by basename — fill in priority order (lowest first)
    const resolved = new Map<string, { file: MdFile; source: ResolvedSessionContextItem['source'] }>();

    // 1. Repo-level central refs (lowest priority)
    for (const f of repoRefs) resolved.set(basename(f.path), { file: f, source: 'repo-ref' });

    // 2. Repo-scoped file overrides central ref of same basename
    for (const rf of repoScopedFiles) {
      if (resolved.has(basename(rf.path))) {
        resolved.set(basename(rf.path), { file: rf, source: 'repo-override' });
      }
    }

    // 3. Session-level refs override everything (highest priority)
    for (const sf of sessionRefs) resolved.set(basename(sf.path), { file: sf, source: 'session-ref' });

    const result: ResolvedSessionContextItem[] = [];
    let order = 0;
    for (const [key, value] of resolved.entries()) {
      const file = value.file;
      const row = this.db
        .prepare('SELECT content FROM md_files WHERE id = ?')
        .get(file.id) as { content: string } | undefined;
      if (row !== undefined) {
        result.push({
          file,
          content: row.content,
          order,
          basename: key,
          source: value.source,
        });
        order += 1;
      }
    }
    return result;
  }

  /**
   * Formats resolved files into a preamble string that is written to the PTY
   * stdin before the user starts interacting with the agent.
   */
  buildPreamble(items: ResolvedMdFile[]): string {
    if (items.length === 0) return '';
    const sections = items.map(
      ({ file, content }) => `=== ${basename(file.path)} ===\n${content.trim()}`
    );
    return sections.join('\n\n') + '\n\n';
  }
}
