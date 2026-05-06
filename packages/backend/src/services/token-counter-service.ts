import { normalizeTerminalText } from '../utils/terminal-text';

const FALLBACK_CHARS_PER_TOKEN = 4;

function normalizeText(text: string): string {
  return normalizeTerminalText(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

export class TokenCounterService {
  private encoderPromise: Promise<{ encode: (text: string) => number[] } | null> | null = null;

  async count(text: string): Promise<number> {
    const normalized = normalizeText(text);
    if (!normalized.trim()) return 0;

    const encoder = await this.getEncoder();
    try {
      return encoder?.encode(normalized).length ?? Math.max(1, Math.ceil(normalized.length / FALLBACK_CHARS_PER_TOKEN));
    } catch {
      return Math.max(1, Math.ceil(normalized.length / FALLBACK_CHARS_PER_TOKEN));
    }
  }

  private getEncoder(): Promise<{ encode: (text: string) => number[] } | null> {
    if (!this.encoderPromise) {
      this.encoderPromise = import('js-tiktoken')
        .then(({ getEncoding }) => {
          try {
            return getEncoding('o200k_base');
          } catch {
            return getEncoding('cl100k_base');
          }
        })
        .catch(() => null);
    }

    return this.encoderPromise;
  }
}
