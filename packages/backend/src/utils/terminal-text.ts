// Comprehensive ANSI/VT escape sequence patterns:
//   CSI sequences  - ESC [ ... <final byte>
//   OSC sequences  - ESC ] ... BEL  or  ESC ] ... ST
//   DCS/SOS/PM/APC - ESC P/X/^/_ ... ST
//   Simple 2-char  - ESC <any single non-[ char>
const ANSI_ESCAPE_RE =
  /\x1B(?:\[[0-9;?<>!]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[PX^_][^\x1B]*(?:\x1B\\|$)|[^[\]])/g;

const CSI_CURSOR_POSITION_RE = /\x1B\[(\d+)?(?:;(\d+))?[Hf]/g;
const CSI_LINE_MOVEMENT_RE = /\x1B\[(?:\d+)?[EF]/g;

export function stripTerminalControls(text: string, options: { cursorMovesAsNewlines?: boolean } = {}): string {
  let normalized = text;

  if (options.cursorMovesAsNewlines) {
    normalized = normalized
      .replace(CSI_CURSOR_POSITION_RE, (_sequence, _row: string | undefined, col: string | undefined) => {
        // Absolute cursor moves to column 1 usually mean a TUI is painting a
        // new logical row. Preserve that boundary before removing the escape.
        return col === undefined || col === '1' ? '\n' : '';
      })
      .replace(CSI_LINE_MOVEMENT_RE, '\n');
  }

  return normalized
    .replace(ANSI_ESCAPE_RE, '')
    .replace(/\x1B[^\x1B]*/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function normalizeTerminalText(text: string): string {
  return stripTerminalControls(text, { cursorMovesAsNewlines: true })
    .replace(/\r\n?/g, '\n');
}
