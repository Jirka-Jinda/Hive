import type { PipelineNode, PipelineContext } from '../types';
import type { MdRefService } from '../../services/md-ref-service';

/**
 * MD Context Node
 *
 * Runs at session-start only.
 * Resolves the effective set of MD files linked to the repo/session and
 * formats them as a preamble that is typed into the PTY before the user
 * starts interacting with the agent.
 *
 * Priority (highest wins when filenames clash):
 *   session-level refs > repo-scoped files (same basename) > repo-level central refs
 */
export function createMdContextNode(mdRefService: MdRefService): PipelineNode {
  return {
    id: 'md-context',
    name: 'MD File Context',
    description: 'Injects linked MD files as a context preamble when a session starts.',
    phases: ['session-start'],
    defaultEnabled: true,

    transform(_text: string, ctx: PipelineContext): string {
      const resolved = mdRefService.resolveSessionContext(ctx.sessionId, ctx.repoId);
      return mdRefService.buildPreamble(resolved);
    },
  };
}
