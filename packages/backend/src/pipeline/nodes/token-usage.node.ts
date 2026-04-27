import type { PipelineContext, PipelineNode } from '../types';
import type { SessionStore } from '../../services/session-store';
import type { UsageService } from '../../services/usage-service';
import type { TokenCounterService } from '../../services/token-counter-service';

export function createTokenUsageNode(
  sessionStore: SessionStore,
  usageService: UsageService,
  tokenCounter: TokenCounterService,
): PipelineNode {
  const outputCountingEnabled = new Set<number>();

  return {
    id: 'token-usage',
    name: 'Token Usage Counter',
    description: 'Counts approximate prompt and output tokens for usage analytics.',
    phases: ['session-start', 'user-input', 'agent-output'],
    defaultEnabled: true,

    async transform(text: string, ctx: PipelineContext): Promise<string> {
      if (ctx.phase === 'session-start') {
        outputCountingEnabled.delete(ctx.sessionId);
      } else if (ctx.phase === 'user-input') {
        outputCountingEnabled.add(ctx.sessionId);
      } else if (!outputCountingEnabled.has(ctx.sessionId)) {
        return text;
      }

      const tokens = await tokenCounter.count(text);
      if (tokens === 0) return text;

      let session;
      try {
        session = sessionStore.get(ctx.sessionId);
      } catch {
        outputCountingEnabled.delete(ctx.sessionId);
        return text;
      }

      usageService.increment(
        {
          sessionId: ctx.sessionId,
          repoId: session.repo_id,
          agentType: session.agent_type,
          credentialId: session.credential_id,
        },
        ctx.phase === 'session-start'
          ? { contextTokens: tokens }
          : ctx.phase === 'user-input'
            ? { inputTokens: tokens }
            : { outputTokens: tokens },
      );

      return text;
    },
  };
}