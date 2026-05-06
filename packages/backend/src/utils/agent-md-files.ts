import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const AGENT_MD_DIR = '.agent';
export const AGENT_MD_DIR_ALIASES = [AGENT_MD_DIR, '.agents'] as const;

export interface AgentMarkdownFile {
  /** Path relative to the .agent directory, using forward slashes. */
  agentRelativePath: string;
  agentDirName: string;
  /** Repo-relative path, using forward slashes. */
  repoRelativePath: string;
  fullPath: string;
  content: string;
}

export function isAgentDirName(value: string): boolean {
  const lower = value.toLowerCase();
  return AGENT_MD_DIR_ALIASES.some((dirName) => dirName === lower);
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

function getReadableAgentDirNames(rootPath: string): readonly string[] {
  return AGENT_MD_DIR_ALIASES.filter((dirName) => existsSync(resolve(rootPath, dirName)));
}

export function getAgentDirNameFromRepoRelativePath(repoRelativePath: string): string | null {
  const normalized = normalizeMarkdownRelativePath(repoRelativePath);
  const lower = normalized.toLowerCase();
  return AGENT_MD_DIR_ALIASES.find((dirName) => lower.startsWith(`${dirName}/`)) ?? null;
}

export function toAgentRelativePath(repoRelativePath: string): string {
  const normalized = normalizeMarkdownRelativePath(repoRelativePath);
  const lower = normalized.toLowerCase();
  const agentPrefix = AGENT_MD_DIR_ALIASES.find((dirName) => lower.startsWith(`${dirName}/`));
  return agentPrefix ? normalized.slice(agentPrefix.length + 1) : normalized;
}

export function toRepoAgentPath(agentRelativePath: string, agentDirName = AGENT_MD_DIR): string {
  const normalizedDirName = isAgentDirName(agentDirName) ? agentDirName.toLowerCase() : AGENT_MD_DIR;
  return `${normalizedDirName}/${normalizeMarkdownRelativePath(agentRelativePath)}`;
}

export function ensureAgentDir(rootPath: string): string {
  const dir = getAgentDir(rootPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function agentRelativePathFromFullPath(rootPath: string, fullPath: string): string | null {
  const resolvedFullPath = resolve(fullPath);
  for (const dirName of AGENT_MD_DIR_ALIASES) {
    const agentDir = resolve(rootPath, dirName);
    const rel = relative(agentDir, resolvedFullPath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    const normalized = rel.replace(/\\/g, '/');
    if (!normalized.toLowerCase().endsWith('.md')) return null;
    return normalizeMarkdownRelativePath(normalized);
  }
  return null;
}

function readAgentMarkdownFile(rootPath: string, agentDirName: string, agentRelativePath: string): AgentMarkdownFile | null {
  const normalized = normalizeMarkdownRelativePath(agentRelativePath);
  const fullPath = resolve(rootPath, agentDirName, normalized);

  try {
    statSync(fullPath);
    return {
      agentRelativePath: normalized,
      agentDirName,
      repoRelativePath: toRepoAgentPath(normalized, agentDirName),
      fullPath,
      content: readFileSync(fullPath, 'utf8'),
    };
  } catch {
    return null;
  }
}

export function findAgentMarkdownFile(rootPath: string, agentRelativePath: string): AgentMarkdownFile | null {
  const normalized = normalizeMarkdownRelativePath(agentRelativePath);
  for (const dirName of AGENT_MD_DIR_ALIASES) {
    const file = readAgentMarkdownFile(rootPath, dirName, normalized);
    if (file) return file;
  }
  return null;
}

function walkAgentDir(
  rootPath: string,
  agentDirName: string,
  relativeDir: string,
  results: AgentMarkdownFile[],
  seen: Set<string>,
): void {
  const dirPath = resolve(rootPath, agentDirName, relativeDir);
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];

  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const fullPath = resolve(rootPath, agentDirName, nextRelative);

    if (entry.isDirectory()) {
      walkAgentDir(rootPath, agentDirName, nextRelative, results, seen);
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

    try {
      statSync(fullPath);
      const agentRelativePath = normalizeMarkdownRelativePath(nextRelative);
      const agentRelativeKey = agentRelativePath.toLowerCase();
      if (seen.has(agentRelativeKey)) continue;
      results.push({
        agentRelativePath,
        agentDirName,
        repoRelativePath: toRepoAgentPath(agentRelativePath, agentDirName),
        fullPath,
        content: readFileSync(fullPath, 'utf8'),
      });
      seen.add(agentRelativeKey);
    } catch {
      // Ignore unreadable files and keep syncing the rest of the folder.
    }
  }
}

export function readAgentMarkdownFiles(rootPath: string): AgentMarkdownFile[] {
  const results: AgentMarkdownFile[] = [];
  const seen = new Set<string>();
  for (const agentDirName of getReadableAgentDirNames(rootPath)) {
    walkAgentDir(rootPath, agentDirName, '', results, seen);
  }
  return results.sort((left, right) => left.repoRelativePath.localeCompare(right.repoRelativePath));
}
