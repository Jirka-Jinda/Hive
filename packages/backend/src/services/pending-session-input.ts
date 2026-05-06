const pendingSessionInputs = new Map<number, string>();
const pendingStartupReady = new Map<number, Promise<void>>();
const pendingStartupTokens = new Map<number, symbol>();

function splitAtFirstSubmit(input: string): { beforeSubmit: string; submitChunk: string; afterSubmit: string } | null {
  const match = /\r\n|\r|\n/.exec(input);
  if (!match || match.index === undefined) {
    return null;
  }

  return {
    beforeSubmit: input.slice(0, match.index),
    submitChunk: match[0],
    afterSubmit: input.slice(match.index + match[0].length),
  };
}

export function primePendingSessionInput(sessionId: number, startupInput: Promise<string>): void {
  const token = Symbol(`pending-session-input:${sessionId}`);
  pendingStartupTokens.set(sessionId, token);

  let ready: Promise<void>;
  ready = startupInput
    .then((resolvedInput) => {
      if (pendingStartupTokens.get(sessionId) !== token) return;
      if (resolvedInput) {
        pendingSessionInputs.set(sessionId, resolvedInput);
      } else {
        pendingSessionInputs.delete(sessionId);
      }
    })
    .catch(() => {
      if (pendingStartupTokens.get(sessionId) !== token) return;
      pendingSessionInputs.delete(sessionId);
    })
    .finally(() => {
      if (pendingStartupTokens.get(sessionId) === token) {
        pendingStartupReady.delete(sessionId);
      }
    });

  pendingStartupReady.set(sessionId, ready);
}

export async function mergePendingSessionInput(sessionId: number, input: string): Promise<string> {
  const ready = pendingStartupReady.get(sessionId);
  if (ready) {
    await ready;
  }

  const pendingInput = pendingSessionInputs.get(sessionId);
  if (!pendingInput) {
    return input;
  }

  const submitSplit = splitAtFirstSubmit(input);
  if (!submitSplit) {
    return input;
  }

  pendingSessionInputs.delete(sessionId);
  pendingStartupTokens.delete(sessionId);

  const separator = submitSplit.beforeSubmit.endsWith('\n') || submitSplit.beforeSubmit.endsWith('\r') || submitSplit.beforeSubmit.length === 0
    ? ''
    : '\n\n';

  return `${submitSplit.beforeSubmit}${separator}${pendingInput}${submitSplit.submitChunk}${submitSplit.afterSubmit}`;
}

export function clearPendingSessionInput(sessionId: number): void {
  pendingSessionInputs.delete(sessionId);
  pendingStartupReady.delete(sessionId);
  pendingStartupTokens.delete(sessionId);
}
