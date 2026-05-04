import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SettingsService } from './settings-service';
import type { MdFileManager, MdFile } from './mdfile-manager';
import type { NotificationBus } from './notification-bus';

/**
 * Keeps the `central-md/` folder on disk in sync with the `md_files` table
 * (scope = 'central').
 *
 * Disk is the working surface for CLI tools (e.g. Copilot, Claude). The DB
 * is the source of truth for metadata (type, refs). Content is kept in sync
 * bidirectionally: whoever changed last wins.
 *
 * Call `fullSync()` once on startup to reconcile any changes made while the
 * app was offline. After that, `writeToDisk` / `deleteFromDisk` are called
 * inline by MdFileManager for real-time sync.
 */
export class CentralMdSyncService {
  private watcher: FSWatcher | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private mdMgr: MdFileManager,
    private settings: SettingsService,
    private notificationBus?: NotificationBus,
  ) {
    mkdirSync(this.dir, { recursive: true });
  }

  private get dir(): string {
    return this.settings.load().centralMdDir;
  }

  startWatching(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 25,
      },
    });

    const onDiskChange = (path: string) => {
      if (!path.toLowerCase().endsWith('.md')) return;
      this.scheduleSync();
    };

    this.watcher.on('add', onDiskChange);
    this.watcher.on('change', onDiskChange);
    this.watcher.on('unlink', onDiskChange);
    this.watcher.on('ready', () => {
      this.scheduleSync();
    });
    this.watcher.on('error', (error) => {
      console.warn('[CentralMdSync] watcher error:', error);
    });
  }

  async stopWatching(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /** Call after centralMdDir setting changes to re-sync and restart the watcher. */
  async restartWithNewDir(): Promise<void> {
    await this.stopWatching();
    mkdirSync(this.dir, { recursive: true });
    this.fullSync();
    this.startWatching();
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      try {
        if (this.fullSync()) {
          this.notificationBus?.emitMdFilesChanged({ scope: 'central' });
        }
      } catch (error) {
        console.warn('[CentralMdSync] live sync failed:', error);
      }
    }, 100);
  }

  /** Write a single central MD file to disk. Call after DB create/update. */
  writeToDisk(filename: string, content: string): void {
    try {
      writeFileSync(join(this.dir, filename), content, 'utf-8');
    } catch (e) {
      console.warn('[CentralMdSync] writeToDisk failed:', e);
    }
  }

  /** Delete a single central MD file from disk. Call after DB delete. */
  deleteFromDisk(filename: string): void {
    try {
      const p = join(this.dir, filename);
      if (existsSync(p)) unlinkSync(p);
    } catch (e) {
      console.warn('[CentralMdSync] deleteFromDisk failed:', e);
    }
  }

  /**
   * Full two-way sync. Run once at startup.
   *
   * - Disk files not in DB → create DB row (disk-created by CLI tools)
   * - DB rows not on disk  → write file to disk (DB-created in app)
   * - Both exist, content differs → disk wins (CLI edited while app was off)
   */
  fullSync(): boolean {
    mkdirSync(this.dir, { recursive: true });
    let changed = false;

    // Index current DB rows by filename
    const dbFiles = this.mdMgr.list('central') as MdFile[];
    const dbByPath = new Map(dbFiles.map((f) => [f.path, f]));

    // Index current disk files
    let diskFilenames: string[] = [];
    try {
      diskFilenames = readdirSync(this.dir).filter((f) => f.endsWith('.md'));
    } catch {
      return false; // dir not readable — skip
    }
    const diskSet = new Set(diskFilenames);

    // 1. Disk → DB: files on disk but not (or outdated) in DB
    for (const filename of diskFilenames) {
      try {
        const diskContent = readFileSync(join(this.dir, filename), 'utf-8');
        const dbRow = dbByPath.get(filename);
        if (!dbRow) {
          // New file created by CLI — add to DB
          this.mdMgr.create('central', null, filename, diskContent);
          changed = true;
          console.log(`[CentralMdSync] imported from disk: ${filename}`);
        } else {
          // File exists in both — check content
          const { content: dbContent } = this.mdMgr.read(dbRow.id);
          if (dbContent !== diskContent) {
            // Disk wins (was edited while app was off)
            this.mdMgr.write(dbRow.id, diskContent);
            changed = true;
            console.log(`[CentralMdSync] updated from disk: ${filename}`);
          }
        }
      } catch (e) {
        console.warn(`[CentralMdSync] error syncing disk file ${filename}:`, e);
      }
    }

    // 2. DB → Disk: rows in DB but missing on disk
    for (const dbFile of dbFiles) {
      if (!diskSet.has(dbFile.path)) {
        try {
          const { content } = this.mdMgr.read(dbFile.id);
          writeFileSync(join(this.dir, dbFile.path), content, 'utf-8');
          changed = true;
          console.log(`[CentralMdSync] exported to disk: ${dbFile.path}`);
        } catch (e) {
          console.warn(`[CentralMdSync] error exporting ${dbFile.path}:`, e);
        }
      }
    }

    return changed;
  }
}
