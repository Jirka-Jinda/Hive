import type { PipelineNode, PipelineContext } from '../types';
import type { MdRefService } from '../../services/md-ref-service';

/**
 * MD Context Node
 *
 * Resolves at session-start only.
 * Resolves the effective set of MD files linked to the repo/session and
 * formats them as a preamble that is merged into the first real input sent
 * to the agent.
 *
 * Priority (highest wins when filenames clash):
 *   session-level refs > repo-scoped files (same basename) > repo-level central refs
 */
export function createMdContextNode(mdRefService: MdRefService): PipelineNode {
  return {
    id: 'md-context',
    name: 'MD File Context',
    description: 'Appends linked MD files to the first input sent in a session.',
    phases: ['session-start'],
    defaultEnabled: true,

    transform(_text: string, ctx: PipelineContext): string {
      const resolved = mdRefService.resolveSessionContext(ctx.sessionId, ctx.repoId);
      return mdRefService.buildPreamble(resolved);
    },
  };
}
