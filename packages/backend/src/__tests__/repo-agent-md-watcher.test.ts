import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPaths } from './api-test-support';

const chokidarMock = vi.hoisted(() => {
  const handlers = new Map<string, (path: string) => void>();
  const watcher = {
    on: vi.fn((event: string, handler: (path: string) => void) => {
      handlers.set(event, handler);
      return watcher;
    }),
    add: vi.fn(),
    unwatch: vi.fn(),
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

import { RepoAgentMdWatcher } from '../services/repo-agent-md-watcher';

describe('RepoAgentMdWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
    chokidarMock.handlers.clear();
    chokidarMock.watch.mockClear();
    chokidarMock.watcher.on.mockClear();
    chokidarMock.watcher.add.mockClear();
    chokidarMock.watcher.unwatch.mockClear();
    chokidarMock.watcher.close.mockClear();
  });

  it('re-scans repo markdown when an .agent markdown file is added or deleted', () => {
    vi.useFakeTimers();
    const rootPath = join(testPaths.root, 'watcher-root');
    const workspace = {
      listAgentMdWatchRoots: vi.fn(() => [{ repoId: 42, path: rootPath }]),
      rediscoverRepoMdFiles: vi.fn(),
    };
    const notificationBus = {
      emitMdFilesChanged: vi.fn(),
    };

    const watcher = new RepoAgentMdWatcher(workspace as any, notificationBus as any);
    watcher.startWatching();
    vi.advanceTimersByTime(100);
    workspace.rediscoverRepoMdFiles.mockClear();
    notificationBus.emitMdFilesChanged.mockClear();

    chokidarMock.handlers.get('add')?.(join(rootPath, '.agent', 'created.md'));
    vi.advanceTimersByTime(100);

    expect(workspace.rediscoverRepoMdFiles).toHaveBeenCalledWith(42);
    expect(notificationBus.emitMdFilesChanged).toHaveBeenCalledWith({ scope: 'repo', repoId: 42 });

    workspace.rediscoverRepoMdFiles.mockClear();
    notificationBus.emitMdFilesChanged.mockClear();

    chokidarMock.handlers.get('unlink')?.(join(rootPath, '.agent', 'created.md'));
    vi.advanceTimersByTime(100);

    expect(workspace.rediscoverRepoMdFiles).toHaveBeenCalledWith(42);
    expect(notificationBus.emitMdFilesChanged).toHaveBeenCalledWith({ scope: 'repo', repoId: 42 });
  });
});
