import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../db/migrate';
import { MdFileManager } from '../services/mdfile-manager';
import { NotificationBus } from '../services/notification-bus';
import { SettingsService } from '../services/settings-service';
import { testPaths } from './api-test-support';

const chokidarMock = vi.hoisted(() => {
  const handlers = new Map<string, (path?: string) => void>();
  const watcher = {
    on: vi.fn((event: string, handler: (path?: string) => void) => {
      handlers.set(event, handler);
      return watcher;
    }),
    close: vi.fn(async () => undefined),
  };

  return {
    handlers,
    watcher,
    watch: vi.fn(() => watcher),
  };
});

vi.mock('chokidar', () => ({
  default: {
    watch: chokidarMock.watch,
  },
}));

import { CentralMdSyncService } from '../services/central-md-sync';

describe('CentralMdSyncService', () => {
  let db: Database.Database;
  let mdMgr: MdFileManager;
  let notificationBus: NotificationBus;
  let sync: CentralMdSyncService;
  let savedCentralMdDir: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    // Pin env var to the test temp dir so SettingsService returns the right path
    savedCentralMdDir = process.env.CENTRAL_MD_DIR;
    process.env.CENTRAL_MD_DIR = testPaths.central;
    mkdirSync(testPaths.central, { recursive: true });
    chokidarMock.handlers.clear();
    chokidarMock.watch.mockClear();
    chokidarMock.watcher.on.mockClear();
    chokidarMock.watcher.close.mockClear();

    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);

    notificationBus = new NotificationBus();
    mdMgr = new MdFileManager(db);
    sync = new CentralMdSyncService(mdMgr, new SettingsService(), notificationBus);
    mdMgr.setSyncService(sync);
    sync.fullSync();
  });

  afterEach(async () => {
    await sync.stopWatching();
    vi.useRealTimers();
    // Restore the original env var value
    if (savedCentralMdDir === undefined) {
      delete process.env.CENTRAL_MD_DIR;
    } else {
      process.env.CENTRAL_MD_DIR = savedCentralMdDir;
    }
    db.close();
  });

  it('imports newly created disk files during sync', () => {
    const filename = `watch-import-${Date.now()}.md`;
    writeFileSync(join(testPaths.central, filename), '# Live file\n', 'utf-8');

    const changed = sync.fullSync();

    expect(changed).toBe(true);
    expect(mdMgr.list('central').some((file) => file.path === filename)).toBe(true);
  });

  it('imports prompt-named disk files as prompt templates', () => {
    const filename = `watch-import-prompt-${Date.now()}.md`;
    writeFileSync(join(testPaths.central, filename), '---\nname: Imported prompt\n---\nRun the prompt.\n', 'utf-8');

    sync.fullSync();

    const imported = mdMgr.list('central').find((file) => file.path === filename);
    expect(imported?.type).toBe('prompt');
  });

  it('renames central files on disk when the filename changes in the manager', () => {
    const originalName = `rename-source-${Date.now()}.md`;
    const renamedName = `rename-target-${Date.now()}.md`;
    const file = mdMgr.create('central', null, originalName, '# Renamed content', 'other');

    mdMgr.update(file.id, { filename: renamedName });

    expect(existsSync(join(testPaths.central, originalName))).toBe(false);
    expect(existsSync(join(testPaths.central, renamedName))).toBe(true);
    expect(readFileSync(join(testPaths.central, renamedName), 'utf-8')).toBe('# Renamed content');
  });

  it('emits a central refresh event when the watcher sees an md change', () => {
    const eventSpy = vi.fn();
    const syncSpy = vi.spyOn(sync, 'fullSync').mockReturnValue(true);
    notificationBus.onMdFilesChanged(eventSpy);

    sync.startWatching();
    const addHandler = chokidarMock.handlers.get('add');

    expect(addHandler).toBeDefined();

    addHandler?.('live-note.md');
    vi.advanceTimersByTime(100);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(eventSpy).toHaveBeenCalledWith({ scope: 'central' });
  });

  it('reconciles once when the watcher becomes ready', () => {
    const syncSpy = vi.spyOn(sync, 'fullSync').mockReturnValue(false);

    sync.startWatching();
    const readyHandler = chokidarMock.handlers.get('ready');

    expect(readyHandler).toBeDefined();

    readyHandler?.();
    vi.advanceTimersByTime(100);

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
