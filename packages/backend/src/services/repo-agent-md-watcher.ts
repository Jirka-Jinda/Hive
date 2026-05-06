import { isAbsolute, relative, resolve } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { WorkspaceService, AgentMdWatchRoot } from '../application/workspace-service';
import type { NotificationBus } from './notification-bus';
import { agentRelativePathFromFullPath, isAgentDirName } from '../utils/agent-md-files';

function normalizePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithinPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}

export class RepoAgentMdWatcher {
  private watcher: FSWatcher | null = null;
  private roots: AgentMdWatchRoot[] = [];
  private watchedPaths = new Map<string, string>();
  private syncTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly notificationBus?: NotificationBus,
  ) {}

  startWatching(): void {
    if (this.watcher) return;

    this.refreshWatchedRoots();
  }

  async stopWatching(): Promise<void> {
    for (const timer of this.syncTimers.values()) {
      clearTimeout(timer);
    }
    this.syncTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.watchedPaths.clear();
    this.roots = [];
  }

  refreshWatchedRoots(): void {
    const nextRoots = this.workspace
      .listAgentMdWatchRoots()
      .map((root) => ({ repoId: root.repoId, path: resolve(root.path) }));
    const nextPaths = new Map(nextRoots.map((root) => [normalizePath(root.path), root.path]));

    this.roots = nextRoots;

    if (!this.watcher) {
      this.watchedPaths = nextPaths;
      this.watcher = chokidar.watch(nextRoots.map((root) => root.path), {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 150,
          pollInterval: 25,
        },
        ignored: (path) => !this.isRelevantPath(path),
      });

      const onDiskChange = (path: string) => {
        const repoId = this.repoIdForAgentMarkdownPath(path);
        if (repoId === null) return;
        this.scheduleRepoSync(repoId);
      };

      this.watcher.on('add', onDiskChange);
      this.watcher.on('change', onDiskChange);
      this.watcher.on('unlink', onDiskChange);
      this.watcher.on('error', (error) => {
        console.warn('[RepoAgentMdWatcher] watcher error:', error);
      });
      this.scheduleAllRepoSyncs();
      return;
    }

    const toAdd = nextRoots
      .filter((root) => !this.watchedPaths.has(normalizePath(root.path)))
      .map((root) => root.path);
    const toRemove = [...this.watchedPaths.entries()]
      .filter(([key]) => !nextPaths.has(key))
      .map(([, path]) => path);

    if (toRemove.length > 0) {
      this.watcher.unwatch(toRemove);
    }
    if (toAdd.length > 0) {
      this.watcher.add(toAdd);
    }

    this.watchedPaths = nextPaths;
    this.scheduleAllRepoSyncs();
  }

  private isRelevantPath(path: string): boolean {
    const candidate = resolve(path);
    for (const root of this.roots) {
      const rootPath = resolve(root.path);
      if (!isWithinPath(rootPath, candidate)) continue;

      const rel = relative(rootPath, candidate);
      if (!rel) return true;
      const [firstSegment] = rel.split(/[\\/]/);
      if (firstSegment && isAgentDirName(firstSegment)) return true;
    }
    return false;
  }

  private repoIdForAgentMarkdownPath(path: string): number | null {
    const candidate = resolve(path);
    let matchingRoot: AgentMdWatchRoot | null = null;

    for (const root of this.roots) {
      const rootPath = resolve(root.path);
      if (!isWithinPath(rootPath, candidate)) continue;
      if (!agentRelativePathFromFullPath(rootPath, candidate)) continue;
      if (!matchingRoot || rootPath.length > resolve(matchingRoot.path).length) {
        matchingRoot = root;
      }
    }

    return matchingRoot?.repoId ?? null;
  }

  private scheduleRepoSync(repoId: number): void {
    const existing = this.syncTimers.get(repoId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.syncTimers.delete(repoId);
      try {
        this.workspace.rediscoverRepoMdFiles(repoId);
        this.notificationBus?.emitMdFilesChanged({ scope: 'repo', repoId });
      } catch (error) {
        console.warn('[RepoAgentMdWatcher] repo md sync failed:', { repoId, error });
      }
    }, 100);

    this.syncTimers.set(repoId, timer);
  }

  private scheduleAllRepoSyncs(): void {
    const repoIds = new Set(this.roots.map((root) => root.repoId));
    for (const repoId of repoIds) {
      this.scheduleRepoSync(repoId);
    }
  }
}
