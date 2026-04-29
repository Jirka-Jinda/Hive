// Comprehensive ANSI/VT escape sequence patterns:
//   CSI sequences  – ESC [ ... <final byte>
//   OSC sequences  – ESC ] ... BEL  or  ESC ] ... ST
//   DCS/SOS/PM/APC – ESC P/X/^/_ ... ST
//   Simple 2-char  – ESC <any single non-[ char>
const ANSI_ESCAPE_RE =
  /\x1B(?:\[[0-9;?<>!]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[PX^_][^\x1B]*(?:\x1B\\|$)|[^[\]])/g;
const FALLBACK_CHARS_PER_TOKEN = 4;

function normalizeText(text: string): string {
  return (
    text
      .replace(ANSI_ESCAPE_RE, '')                        // remove ANSI/VT escape sequences
      .replace(/\x1B[^\x1B]*/g, '')                       // strip any remaining ESC debris
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove non-printable controls (keep \t \n)
      .replace(/\r\n?/g, '\n')                            // normalise line endings
  );
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