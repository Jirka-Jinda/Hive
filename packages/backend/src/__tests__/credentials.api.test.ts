import { describe, expect, it } from 'vitest';
import { req, setupApiTestApp } from './api-test-support';

const getApp = setupApiTestApp();

describe('Credentials API', () => {
  let credId = 0;

  it('GET /api/credentials — returns array', async () => {
    const res = await req(getApp(), '/api/credentials');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('POST /api/credentials — 400 when name is empty', async () => {
    const res = await req(getApp(), '/api/credentials', {
      method: 'POST',
      body: { name: '', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/credentials — 400 when agentType is missing', async () => {
    const res = await req(getApp(), '/api/credentials', {
      method: 'POST',
      body: { name: 'cred', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/credentials — 201 with valid body', async () => {
    const res = await req(getApp(), '/api/credentials', {
      method: 'POST',
      body: {
        name: 'my-claude-key',
        agentType: 'claude',
        data: { envVars: { ANTHROPIC_API_KEY: 'sk-test-1234' } },
      },
    });
    expect(res.status).toBe(201);
    const cred = await res.json();
    expect(cred.id).toBeGreaterThan(0);
    expect(cred.name).toBe('my-claude-key');
    expect(cred.agent_type).toBe('claude');
    expect(cred.encrypted_data).toBeUndefined();
    credId = cred.id;
  });

  it('GET /api/credentials — credential appears in list', async () => {
    const res = await req(getApp(), '/api/credentials');
    const creds = await res.json();
    expect(creds.some((credential: { id: number }) => credential.id === credId)).toBe(true);
  });

  it('PUT /api/credentials/:id — updates name and agent type metadata', async () => {
    const res = await req(getApp(), `/api/credentials/${credId}`, {
      method: 'PUT',
      body: {
        name: 'updated-credential',
        agentType: 'claude',
        data: { envVars: { ANTHROPIC_API_KEY: 'sk-updated' } },
      },
    });
    expect(res.status).toBe(200);
    const credential = await res.json();
    expect(credential.id).toBe(credId);
    expect(credential.name).toBe('updated-credential');
    expect(credential.agent_type).toBe('claude');
  });

  it('PUT /api/credentials/:id — 400 when required fields are missing', async () => {
    const res = await req(getApp(), `/api/credentials/${credId}`, {
      method: 'PUT',
      body: { name: '', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name and agentType are required/i);
  });

  it('PUT /api/credentials/:id — 404 for non-existent credential', async () => {
    const res = await req(getApp(), '/api/credentials/99999', {
      method: 'PUT',
      body: { name: 'missing', agentType: 'claude', data: { envVars: {} } },
    });
    expect(res.status).toBe(404);
  });

  it('list response never includes encrypted_data', async () => {
    const res = await req(getApp(), '/api/credentials');
    for (const credential of await res.json()) {
      expect(credential.encrypted_data).toBeUndefined();
    }
  });

  it('DELETE /api/credentials/:id — 200 with ok', async () => {
    const res = await req(getApp(), `/api/credentials/${credId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DELETE /api/credentials/:id — 404 when credential does not exist', async () => {
    const res = await req(getApp(), '/api/credentials/99999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET /api/credentials — credential gone after delete', async () => {
    const res = await req(getApp(), '/api/credentials');
    const creds = await res.json();
    expect(creds.some((credential: { id: number }) => credential.id === credId)).toBe(false);
  });
});