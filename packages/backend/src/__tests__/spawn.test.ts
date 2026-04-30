/**
 * Tests for agent command resolution and PTY spawn argument construction.
 *
 * Key scenarios verified:
 *  1. resolveCommand on Windows prefers .exe > .cmd > extensionless shell scripts
 *  2. spawnAgent wraps .cmd/.bat paths with `cmd.exe /c` on Windows (error 193 fix)
 *  3. spawnAgent spawns .exe files directly (no wrapping)
 *  4. Each agent adapter injects the correct env var into the PTY env
 */

// ── Module-level mocks (hoisted before imports) ────────────────────────────
vi.mock('node:child_process', () => ({ execSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    kill: vi.fn(),
  })),
}));

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as pty from 'node-pty';

import { resolveCommand, AGENT_ADAPTERS } from '../services/agents';
import { killProcessAndWait, spawnAgent } from '../services/process-manager';

const mockExecSync = vi.mocked(execSync);
const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(existsSync);
const mockPtySpawn = vi.mocked(pty.spawn);

// Unique session ID counter so the module-level `processes` Map never collides
let nextSessionId = 10_000;
const freshId = () => nextSessionId++;

// ── Platform helpers ────────────────────────────────────────────────────────
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// ── resolveCommand ──────────────────────────────────────────────────────────
describe('resolveCommand – Windows', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    setPlatform('win32');
  });

  afterEach(() => setPlatform(originalPlatform as NodeJS.Platform));

  it('returns the .cmd path when where.exe returns only .cmd', () => {
    mockExecSync.mockReturnValue('C:\\npm\\codex.cmd\r\n');
    mockExistsSync.mockImplementation((p) => p === 'C:\\npm\\codex.cmd');

    expect(resolveCommand('codex')).toBe('C:\\npm\\codex.cmd');
  });

  it('prefers .cmd over extensionless when both appear in where.exe output', () => {
    // where.exe returns extensionless FIRST (the Unix shim), then .cmd
    mockExecSync.mockReturnValue('C:\\npm\\codex\r\nC:\\npm\\codex.cmd\r\n');
    mockExistsSync.mockImplementation((p) =>
      p === 'C:\\npm\\codex' || p === 'C:\\npm\\codex.cmd'
    );

    expect(resolveCommand('codex')).toBe('C:\\npm\\codex.cmd');
  });

  it('prefers .exe over .cmd when both available', () => {
    mockExecSync.mockReturnValue('C:\\bin\\copilot.exe\r\nC:\\npm\\copilot.cmd\r\n');
    mockExistsSync.mockImplementation((p) =>
      p === 'C:\\bin\\copilot.exe' || p === 'C:\\npm\\copilot.cmd'
    );

    expect(resolveCommand('copilot')).toBe('C:\\bin\\copilot.exe');
  });

  it('falls back to known paths when where.exe throws and returns .cmd variant', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    // Simulate only the .cmd variant being present on disk
    mockExistsSync.mockImplementation((p) => String(p).endsWith('codex.cmd'));

    const result = resolveCommand('codex');

    expect(result).toMatch(/codex\.cmd$/i);
  });

  it('returns bare command name when nothing can be found', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockReturnValue(false);

    expect(resolveCommand('codex')).toBe('codex');
  });

  it('resolves claude via where.exe .cmd result', () => {
    mockExecSync.mockReturnValue('C:\\npm\\claude.cmd\r\n');
    mockExistsSync.mockImplementation((p) => p === 'C:\\npm\\claude.cmd');

    expect(resolveCommand('claude')).toBe('C:\\npm\\claude.cmd');
  });

  it('resolves copilot .exe via where.exe', () => {
    const copilotExe =
      `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe`;
    mockExecSync.mockReturnValue(`${copilotExe}\r\n`);
    mockExistsSync.mockImplementation((p) => p === copilotExe);

    expect(resolveCommand('copilot')).toBe(copilotExe);
  });
});

describe('resolveCommand – non-Windows', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    setPlatform('linux');
  });

  afterEach(() => setPlatform(originalPlatform as NodeJS.Platform));

  it('returns path from which', () => {
    mockExecSync.mockReturnValue('/usr/local/bin/codex\n');
    mockExistsSync.mockReturnValue(true);

    expect(resolveCommand('codex')).toBe('/usr/local/bin/codex');
  });

  it('returns bare name when which throws', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    expect(resolveCommand('codex')).toBe('codex');
  });
});

// ── spawnAgent spawn argument construction ──────────────────────────────────
describe('spawnAgent – Windows cmd wrapping', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockPtySpawn.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof pty.spawn>);
  });

  afterEach(() => setPlatform(originalPlatform as NodeJS.Platform));

  it('wraps a .cmd path with cmd.exe /c for codex', () => {
    setPlatform('win32');
    mockExecSync.mockReturnValue('C:\\npm\\codex.cmd\r\n');
    mockExistsSync.mockImplementation((p) => p === 'C:\\npm\\codex.cmd');

    spawnAgent(freshId(), AGENT_ADAPTERS['codex'], 'C:\\repo');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining(['/c', expect.stringContaining('codex.cmd')]),
      expect.any(Object)
    );
  });

  it('wraps a .bat path with cmd.exe /c', () => {
    setPlatform('win32');
    mockExecSync.mockReturnValue('C:\\scripts\\run.bat\r\n');
    mockExistsSync.mockImplementation((p) => p === 'C:\\scripts\\run.bat');

    spawnAgent(freshId(), { ...AGENT_ADAPTERS['claude'], command: 'run' }, 'C:\\repo');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining(['/c', 'C:\\scripts\\run.bat']),
      expect.any(Object)
    );
  });

  it('spawns a .exe file directly without cmd.exe wrapping', () => {
    setPlatform('win32');
    const copilotExe = 'C:\\bin\\copilot.exe';
    mockExecSync.mockReturnValue(`${copilotExe}\r\n`);
    mockExistsSync.mockImplementation((p) => p === copilotExe);

    spawnAgent(freshId(), AGENT_ADAPTERS['copilot'], 'C:\\repo');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      copilotExe,
      [],
      expect.any(Object)
    );
  });

  it('does NOT wrap with cmd.exe on Linux even for extensionless paths', () => {
    setPlatform('linux');
    mockExecSync.mockReturnValue('/usr/local/bin/codex\n');
    mockExistsSync.mockReturnValue(true);

    spawnAgent(freshId(), AGENT_ADAPTERS['codex'], '/repo');

    const [spawnFile] = mockPtySpawn.mock.calls[0] as [string, ...unknown[]];
    expect(spawnFile).not.toBe('cmd.exe');
    expect(spawnFile).toBe('/usr/local/bin/codex');
  });

  it('passes the provided working directory through to node-pty', () => {
    setPlatform('linux');
    mockExecSync.mockReturnValue('/usr/local/bin/codex\n');
    mockExistsSync.mockReturnValue(true);

    spawnAgent(freshId(), AGENT_ADAPTERS['codex'], '/repo/worktrees/session-1');

    expect(mockPtySpawn).toHaveBeenCalledWith(
      '/usr/local/bin/codex',
      [],
      expect.objectContaining({ cwd: '/repo/worktrees/session-1' })
    );
  });

  it('waits for the real PTY exit when killing a process for cleanup', async () => {
    setPlatform('linux');
    mockExecSync.mockReturnValue('/usr/local/bin/codex\n');
    mockExistsSync.mockReturnValue(true);

    let exitHandler: ((event: { exitCode: number }) => void) | undefined;
    const kill = vi.fn(() => {
      setTimeout(() => exitHandler?.({ exitCode: 0 }), 5);
    });
    mockPtySpawn.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
        exitHandler = handler;
      }),
      kill,
    } as unknown as ReturnType<typeof pty.spawn>);

    const sessionId = freshId();
    spawnAgent(sessionId, AGENT_ADAPTERS['codex'], '/repo/worktrees/session-1');
    await killProcessAndWait(sessionId, 1000);

    expect(kill).toHaveBeenCalledTimes(1);
  });
});

// ── Adapter env-var contracts ───────────────────────────────────────────────
describe('AGENT_ADAPTERS – envVars', () => {
  it('claude maps ANTHROPIC_API_KEY', () => {
    expect(AGENT_ADAPTERS['claude'].envVars({ ANTHROPIC_API_KEY: 'sk-ant' }))
      .toEqual({ ANTHROPIC_API_KEY: 'sk-ant' });
  });

  it('copilot maps COPILOT_GITHUB_TOKEN to all three token env vars', () => {
    expect(AGENT_ADAPTERS['copilot'].envVars({ COPILOT_GITHUB_TOKEN: 'gho_xyz' }))
      .toEqual({ COPILOT_GITHUB_TOKEN: 'gho_xyz', GH_TOKEN: 'gho_xyz', GITHUB_TOKEN: 'gho_xyz' });
  });

  it('codex maps OPENAI_API_KEY', () => {
    expect(AGENT_ADAPTERS['codex'].envVars({ OPENAI_API_KEY: 'sk-openai' }))
      .toEqual({ OPENAI_API_KEY: 'sk-openai' });
  });

  it('returns empty string for missing credential in claude and codex', () => {
    expect(AGENT_ADAPTERS['claude'].envVars({})['ANTHROPIC_API_KEY']).toBe('');
    expect(AGENT_ADAPTERS['codex'].envVars({})['OPENAI_API_KEY']).toBe('');
  });

  it('copilot returns empty object when no token — preserves Windows Credential Manager / gh CLI auth', () => {
    expect(AGENT_ADAPTERS['copilot'].envVars({})).toEqual({});
    expect(AGENT_ADAPTERS['copilot'].envVars(undefined)).toEqual({});
  });
});

// ── Copilot setupAuth ─────────────────────────────────────────────────
describe('AGENT_ADAPTERS[copilot] — setupAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls gh auth login --with-token with the PAT on stdin', () => {
    AGENT_ADAPTERS['copilot'].setupAuth?.({ COPILOT_GITHUB_TOKEN: 'gho_test123' });

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'gh',
      ['auth', 'login', '--with-token'],
      expect.objectContaining({ input: 'gho_test123' })
    );
  });

  it('is a no-op when no token is provided', () => {
    AGENT_ADAPTERS['copilot'].setupAuth?.({});

    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('swallows errors when gh is not installed', () => {
    mockSpawnSync.mockImplementation(() => { throw new Error('gh not found'); });

    expect(() =>
      AGENT_ADAPTERS['copilot'].setupAuth?.({ COPILOT_GITHUB_TOKEN: 'gho_xyz' })
    ).not.toThrow();
  });
});

// ── spawnAgent injects credentials into PTY env ─────────────────────────────
describe('spawnAgent – credential injection into PTY env', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('linux');
    // which succeeds for any command
    mockExecSync.mockImplementation((cmd: unknown) => {
      const name = String(cmd).split(' ').pop() ?? '';
      return `/usr/local/bin/${name}\n`;
    });
    mockExistsSync.mockReturnValue(true);
    mockPtySpawn.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof pty.spawn>);
  });

  afterEach(() => setPlatform(originalPlatform as NodeJS.Platform));

  it.each([
    ['claude',  { ANTHROPIC_API_KEY: 'sk-ant-123' },   'ANTHROPIC_API_KEY',     'sk-ant-123'],
    ['copilot', { COPILOT_GITHUB_TOKEN: 'gho_abc' },   'COPILOT_GITHUB_TOKEN',  'gho_abc'],
    ['codex',   { OPENAI_API_KEY: 'sk-openai-456' },   'OPENAI_API_KEY',        'sk-openai-456'],
  ] as const)(
    '%s passes %s to pty.spawn env',
    (agentId, cred, envKey, envVal) => {
      spawnAgent(freshId(), AGENT_ADAPTERS[agentId], '/repo', cred as Record<string, string>);

      expect(mockPtySpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ [envKey]: envVal }),
        })
      );
    }
  );
});
