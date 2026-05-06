import type { PipelineNode, PipelineNodeDto, PipelinePhase, PipelineContext } from './types';
import type { SettingsService } from '../services/settings-service';

export class PipelineRegistry {
  private readonly nodes: PipelineNode[] = [];

  constructor(private readonly settings: SettingsService) {}

  register(node: PipelineNode): void {
    if (this.nodes.some((n) => n.id === node.id)) {
      throw new Error(`Pipeline node with id "${node.id}" is already registered`);
    }
    this.nodes.push(node);
  }

  /** Returns serialisable DTOs with resolved enabled state for the API. */
  list(): PipelineNodeDto[] {
    const stored = this.settings.load().pipeline?.nodes ?? {};
    return this.nodes.map((node) => ({
      configurable: node.configurable ?? true,
      id: node.id,
      name: node.name,
      description: node.description,
      phases: node.phases,
      enabled: node.configurable === false ? false : (stored[node.id]?.enabled ?? node.defaultEnabled),
    }));
  }

  setEnabled(id: string, enabled: boolean): PipelineNodeDto[] {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Pipeline node "${id}" not found`);
    if (node.configurable === false) return this.list();
    const current = this.settings.load();
    const nodes = { ...(current.pipeline?.nodes ?? {}), [id]: { enabled } };
    this.settings.save({ pipeline: { nodes } });
    return this.list();
  }

  /** Run all enabled nodes for the given phase in registration order. */
  async run(
    phase: PipelinePhase,
    text: string,
    ctx: Omit<PipelineContext, 'phase'>,
  ): Promise<string> {
    const stored = this.settings.load().pipeline?.nodes ?? {};
    let result = text;
    for (const node of this.nodes) {
      if (!node.phases.includes(phase)) continue;
      const enabled = node.configurable === false ? false : (stored[node.id]?.enabled ?? node.defaultEnabled);
      if (!enabled) continue;
      result = await node.transform(result, { ...ctx, phase });
    }
    return result;
  }
}
