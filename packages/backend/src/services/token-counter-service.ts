const ANSI_ESCAPE_RE = /\x1B\[[0-9;?]*[A-Za-z]|\x1B\][^\x07]*\x07|\x1B[PX^_].*?ST|\x1B[()][AB012]/g;
const FALLBACK_CHARS_PER_TOKEN = 4;

function normalizeText(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '').replace(/\r/g, '');
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
        .then(({ getEncoding }) => getEncoding('cl100k_base'))
        .catch(() => null);
    }

    return this.encoderPromise;
  }
}