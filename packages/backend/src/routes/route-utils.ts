import type { Context } from 'hono';
import { getErrorMessage } from '../utils/errors';

type SuccessStatus = 200 | 201;
type ErrorStatus = 400 | 404;

export function parseIdParam(c: Context, name: string): number {
  const raw = c.req.param(name);
  if (raw === undefined) {
    throw new Error(`${name} is required`);
  }

  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

export async function jsonRoute<T>(
  c: Context,
  task: () => Promise<T> | T,
  options?: { successStatus?: SuccessStatus; errorStatus?: ErrorStatus },
): Promise<Response> {
  try {
    return c.json(await task(), options?.successStatus ?? 200);
  } catch (error: unknown) {
    return c.json({ error: getErrorMessage(error) }, options?.errorStatus ?? 400);
  }
}