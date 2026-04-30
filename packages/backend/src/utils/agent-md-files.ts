import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const AGENT_MD_DIR = '.agent';

export interface AgentMarkdownFile {
  /** Path relative to the .agent directory, using forward slashes. */
  agentRelativePath: string;
  /** Repo-relative path, using forward slashes. */
  repoRelativePath: string;
  fullPath: string;
  content: string;
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid markdown path: ${path}`);
  }
  return normalized;
}

export function normalizeMarkdownRelativePath(path: string): string {
  const normalized = normalizeRelativePath(path);
  if (!normalized.toLowerCase().endsWith('.md')) {
    throw new Error(`Expected a markdown path: ${path}`);
  }
  return normalized;
}

export function getAgentDir(rootPath: string): string {
  return resolve(rootPath, AGENT_MD_DIR);
}

export function toAgentRelativePath(repoRelativePath: string): string {
  const normalized = normalizeMarkdownRelativePath(repoRelativePath);
  const agentPrefix = `${AGENT_MD_DIR}/`;
  return normalized.toLowerCase().startsWith(agentPrefix)
    ? normalized.slice(agentPrefix.length)
    : normalized;
}

export function toRepoAgentPath(agentRelativePath: string): string {
  return `${AGENT_MD_DIR}/${normalizeMarkdownRelativePath(agentRelativePath)}`;
}

export function ensureAgentDir(rootPath: string): string {
  const dir = getAgentDir(rootPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function agentRelativePathFromFullPath(rootPath: string, fullPath: string): string | null {
  const agentDir = getAgentDir(rootPath);
  const rel = relative(agentDir, resolve(fullPath));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  const normalized = rel.replace(/\\/g, '/');
  if (!normalized.toLowerCase().endsWith('.md')) return null;
  return normalizeMarkdownRelativePath(normalized);
}

function walkAgentDir(rootPath: string, relativeDir: string, results: AgentMarkdownFile[]): void {
  const dirPath = resolve(getAgentDir(rootPath), relativeDir);
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];

  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const fullPath = resolve(getAgentDir(rootPath), nextRelative);

    if (entry.isDirectory()) {
      walkAgentDir(rootPath, nextRelative, results);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

    try {
      statSync(fullPath);
      const agentRelativePath = normalizeMarkdownRelativePath(nextRelative);
      results.push({
        agentRelativePath,
        repoRelativePath: toRepoAgentPath(agentRelativePath),
        fullPath,
        content: readFileSync(fullPath, 'utf8'),
      });
    } catch {
      // Ignore unreadable files and keep syncing the rest of the folder.
    }
  }
}

export function readAgentMarkdownFiles(rootPath: string): AgentMarkdownFile[] {
  if (!existsSync(getAgentDir(rootPath))) return [];
  const results: AgentMarkdownFile[] = [];
  walkAgentDir(rootPath, '', results);
  return results.sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath));
}
