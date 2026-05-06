import type { PipelineNode, PipelinePhase } from '../types';

function createFutureNode(input: {
  id: string;
  name: string;
  description: string;
  phases: PipelinePhase[];
}): PipelineNode {
  return {
    ...input,
    configurable: false,
    defaultEnabled: false,
    transform: (text: string) => text,
  };
}

export function createFuturePipelineNodes(): PipelineNode[] {
  return [
    createFutureNode({
      id: 'git-preamble',
      name: 'Git Preamble',
      description: 'Planned: inject branch, worktree, dirty-file, and recent commit context when a session starts.',
      phases: ['session-start'],
    }),
    createFutureNode({
      id: 'context-budgeter',
      name: 'Context Budgeter',
      description: 'Planned: deduplicate and trim linked context files so session startup context stays within a token budget.',
      phases: ['session-start'],
    }),
    createFutureNode({
      id: 'secrets-redactor',
      name: 'Secrets Redactor',
      description: 'Planned: detect and mask API keys, tokens, private keys, and other secrets in pipeline text.',
      phases: ['session-start', 'user-input', 'agent-output'],
    }),
  ];
}
