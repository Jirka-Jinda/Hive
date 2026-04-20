import { parse as parseYaml } from 'yaml';

export interface ParamDef {
  name: string;
  type: 'text' | 'repo' | 'session';
  default?: string;
  description?: string;
}

export interface FrontmatterShape {
  name?: string;
  description?: string;
  params?: ParamDef[];
}

export function parseFrontmatter(content: string): { meta: FrontmatterShape; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { meta: {}, body: content };
  const meta = (parseYaml(match[1]) ?? {}) as FrontmatterShape;
  return { meta, body: match[2] };
}

export function renderTemplate(content: string, params: Record<string, string>): string {
  const { body } = parseFrontmatter(content);
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? `{{${key}}}`);
}
