import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPendingSessionInput,
  mergePendingSessionInput,
  primePendingSessionInput,
} from '../services/pending-session-input';

describe('pending session input', () => {
  afterEach(() => {
    clearPendingSessionInput(1);
    clearPendingSessionInput(2);
    clearPendingSessionInput(3);
  });

  it('appends startup context to the first input only once', async () => {
    primePendingSessionInput(1, Promise.resolve('=== context.md ===\n# Context\n\n'));

    await expect(mergePendingSessionInput(1, 'hello\r')).resolves.toBe('hello\n\n=== context.md ===\n# Context\n\n\r');
    await expect(mergePendingSessionInput(1, 'second')).resolves.toBe('second');
  });

  it('waits for startup context before merging the first input', async () => {
    let resolveStartup: (value: string) => void = () => {};
    const startup = new Promise<string>((resolve) => {
      resolveStartup = resolve;
    });

    primePendingSessionInput(2, startup);

    const mergedInput = mergePendingSessionInput(2, 'first line\n');
    resolveStartup('=== delayed.md ===\nDelayed context\n\n');

    await expect(mergedInput).resolves.toBe('first line\n\n=== delayed.md ===\nDelayed context\n\n\n');
  });

  it('does not consume startup context until the first submitted input arrives', async () => {
    primePendingSessionInput(3, Promise.resolve('=== context.md ===\n# Context\n\n'));

    await expect(mergePendingSessionInput(3, 'h')).resolves.toBe('h');
    await expect(mergePendingSessionInput(3, 'ello')).resolves.toBe('ello');
    await expect(mergePendingSessionInput(3, '\r')).resolves.toBe('=== context.md ===\n# Context\n\n\r');
    await expect(mergePendingSessionInput(3, 'second')).resolves.toBe('second');
  });
});
