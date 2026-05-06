import { describe, expect, it, vi } from 'vitest';
import type { SessionStore } from '../services/session-store';
import type { UsageService } from '../services/usage-service';
import { TokenCounterService } from '../services/token-counter-service';
import { createTokenUsageNode } from '../pipeline/nodes/token-usage.node';

function createHarness(agentType = 'claude') {
  const session = {
    id: 1,
    repo_id: 2,
    agent_type: agentType,
    credential_id: null,
    name: 'Test Session',
    status: 'running',
    state: 'working',
    branch_mode: null,
    initial_branch_name: null,
    worktree_path: null,
    sort_order: 0,
    archived_at: null,
    created_at: '',
    updated_at: '',
  } as const;

  const sessionStore = {
    get: vi.fn(() => session),
  } as unknown as SessionStore;

  const usageService = {
    increment: vi.fn(),
  } as unknown as UsageService;

  const tokenCounter = new TokenCounterService();
  const node = createTokenUsageNode(sessionStore, usageService, tokenCounter);

  return { node, tokenCounter, usageService };
}

function usageCalls(usageService: UsageService) {
  return vi.mocked(usageService.increment).mock.calls.map(([, delta]) => delta);
}

describe('createTokenUsageNode', () => {
  it('counts terminal input only when submitted and honors backspace edits', async () => {
    const { node, tokenCounter, usageService } = createHarness();

    await node.transform('helo', { sessionId: 1, repoId: 2, phase: 'user-input' });
    expect(usageService.increment).not.toHaveBeenCalled();

    await node.transform('\x7flo\r', { sessionId: 1, repoId: 2, phase: 'user-input' });

    expect(usageCalls(usageService)).toContainEqual({
      inputTokens: await tokenCounter.count('hello'),
    });
  });

  it('strips submitted prompt echoes and terminal prompt chrome from output', async () => {
    const { node, tokenCounter, usageService } = createHarness();
    const input = 'Summarize the repo state.';
    const output = 'Here is the summary from the agent.';

    await node.transform(`${input}\r`, { sessionId: 1, repoId: 2, phase: 'user-input' });
    await node.transform(`> ${input}\r\n${output}\r\nclaude> `, { sessionId: 1, repoId: 2, phase: 'agent-output' });

    expect(usageCalls(usageService)).toContainEqual({
      outputTokens: await tokenCounter.count(output),
    });
  });

  it('counts split agent output as one completed turn', async () => {
    const { node, tokenCounter, usageService } = createHarness();
    const output = 'antidisestablishmentarianism';

    await node.transform('Say the long word.\r', { sessionId: 1, repoId: 2, phase: 'user-input' });
    await node.transform('a', { sessionId: 1, repoId: 2, phase: 'agent-output' });
    await node.transform('ntidisestablishmentarianism\r\nclaude> ', {
      sessionId: 1,
      repoId: 2,
      phase: 'agent-output',
    });

    const wholeOutputTokens = await tokenCounter.count(output);
    const perChunkTokens = await tokenCounter.count('a') + await tokenCounter.count('ntidisestablishmentarianism');

    expect(perChunkTokens).toBeGreaterThan(wholeOutputTokens);
    expect(usageCalls(usageService)).toContainEqual({ outputTokens: wholeOutputTokens });
  });
});
