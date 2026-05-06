import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

type MdFileType = 'documentation' | 'skill' | 'tool' | 'instruction' | 'prompt' | 'other';

export interface DiscoveredRepoMdFile {
  path: string;
  content: string;
  type: MdFileType;
}

const MAX_DISCOVERED_FILES = 200;
const MAX_FILE_SIZE_BYTES = 256 * 1024;
const MAX_SCAN_DEPTH = 6;

const FULL_INCLUDE_DIRS = new Set([
  '.agent',
  '.agents',
  '.ai',
  '.claude',
  '.codex',
  '.copilot',
  '.cursor',
  '.gemini',
  '.windsurf',
]);

const TRACKED_DIRS = new Set([
  ...FULL_INCLUDE_DIRS,
  '.github',
  '.vscode',
  'agents',
  'instructions',
  'prompts',
  'skills',
]);

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.svn',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'vendor',
]);

const EXACT_FILENAMES = new Set([
  '.agent.md',
  '.copilot.md',
  'agent.md',
  'agents.md',
  'claude.md',
  'codex.md',
  'copilot-instructions.md',
  'copilot.md',
  'cursor.md',
  'gemini.md',
  'instructions.md',
  'prompt.md',
  'prompts.md',
  'skill.md',
  'windsurf.md',
]);

const KEYWORD_RE = /(agent|copilot|claude|codex|cursor|gemini|instruction|prompt|skill|windsurf)/i;
const HINT_DIR_RE = /(agent|copilot|claude|codex|cursor|gemini|instruction|prompt|skill|windsurf)/i;

function normalizeRepoRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid repo markdown path: ${relativePath}`);
  }
  return normalized;
}

function inferDiscoveredType(relativePath: string): MdFileType {
  const lower = relativePath.toLowerCase();
  if (lower.includes('/skills/') || lower.endsWith('/skill.md') || lower.includes('skill')) return 'skill';
  if (lower.includes('tool')) return 'tool';
  if (lower.includes('/prompts/') || lower.includes('prompt')) return 'prompt';
  if (lower.includes('/instructions/') || lower.includes('instruction') || lower.includes('copilot') || lower.includes('agent')) {
    return 'instruction';
  }
  return 'other';
}

function isCandidate(relativePath: string, includeAllMarkdown: boolean): boolean {
  const normalized = normalizeRepoRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  if (includeAllMarkdown) return true;

  const segments = lower.split('/');
  const filename = segments[segments.length - 1] ?? lower;
  if (EXACT_FILENAMES.has(filename)) return true;
  if (/\.(agent|copilot|instruction|instructions|prompt|skill)\.md$/i.test(filename)) return true;
  if (KEYWORD_RE.test(filename)) return true;
  if (segments.some((segment) => /(prompts?|instructions?|skills?)/i.test(segment))) return true;
  return KEYWORD_RE.test(lower);
}

function walkRepo(
  repoPath: string,
  relativeDir: string,
  depth: number,
  includeAllMarkdown: boolean,
  results: DiscoveredRepoMdFile[],
  seen: Set<string>,
): void {
  if (results.length >= MAX_DISCOVERED_FILES || depth > MAX_SCAN_DEPTH) return;

  const dirPath = relativeDir ? resolve(repoPath, relativeDir) : repoPath;
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];

  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (results.length >= MAX_DISCOVERED_FILES) return;

    const nextRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const lowerName = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(lowerName)) continue;

      const nextIncludeAllMarkdown = includeAllMarkdown || FULL_INCLUDE_DIRS.has(lowerName);
      // Always recurse one level deep from the root so files in any top-level
      // directory (e.g. docs/, sessions/) are discovered. Deeper levels use the
      // tracked-dir / keyword heuristic to avoid scanning unrelated trees.
      const shouldDescend = nextIncludeAllMarkdown || depth === 0 || TRACKED_DIRS.has(lowerName) || HINT_DIR_RE.test(lowerName);
      if (!shouldDescend) continue;

      walkRepo(repoPath, nextRelative, depth + 1, nextIncludeAllMarkdown, results, seen);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!isCandidate(nextRelative, includeAllMarkdown)) continue;

    const normalizedPath = normalizeRepoRelativePath(nextRelative);
    if (seen.has(normalizedPath)) continue;

    const fullPath = resolve(repoPath, nextRelative);
    let size = 0;

    try {
      size = statSync(fullPath).size;
    } catch {
      continue;
    }

    if (size > MAX_FILE_SIZE_BYTES) continue;

    try {
      results.push({
        path: normalizedPath,
        content: readFileSync(fullPath, 'utf8'),
        type: inferDiscoveredType(normalizedPath),
      });
      seen.add(normalizedPath);
    } catch {
      // Ignore unreadable or non-UTF8 files and continue discovery.
    }
  }
}

export function discoverRepoMdFiles(repoPath: string): DiscoveredRepoMdFile[] {
  const results: DiscoveredRepoMdFile[] = [];
  const seen = new Set<string>();

  walkRepo(repoPath, '', 0, false, results, seen);

  return results.sort((left, right) => left.path.localeCompare(right.path));
}