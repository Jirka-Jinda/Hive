import { describe, expect, it } from 'vitest';
import { req, setupApiTestApp } from './api-test-support';

const getApp = setupApiTestApp();

describe('GET /api/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await req(getApp(), '/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});

describe('GET /api/agents', () => {
  it('returns 200 with a non-empty agent list', async () => {
    const res = await req(getApp(), '/api/agents');
    const agents = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });

  it('each agent has id, name, command, installed, credentialFields', async () => {
    const res = await req(getApp(), '/api/agents');
    for (const agent of await res.json()) {
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('command');
      expect(typeof agent.installed).toBe('boolean');
      expect(Array.isArray(agent.credentialFields)).toBe(true);
    }
  });

  it('includes the claude agent with ANTHROPIC_API_KEY field', async () => {
    const res = await req(getApp(), '/api/agents');
    const claude = (await res.json()).find((agent: { id: string }) => agent.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude.credentialFields).toHaveLength(1);
    expect(claude.credentialFields[0].key).toBe('ANTHROPIC_API_KEY');
    expect(claude.credentialFields[0].secret).toBe(true);
  });

  it('includes codex and copilot agents', async () => {
    const res = await req(getApp(), '/api/agents');
    const ids = (await res.json()).map((agent: { id: string }) => agent.id);
    expect(ids).toContain('codex');
    expect(ids).toContain('copilot');
  });
});