import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Known absolute install locations for Windows (winget / official installers). */
export const WIN_KNOWN_PATHS: Record<string, string[]> = {
  gh: ['C:\\Program Files\\GitHub CLI\\gh.exe'],
  claude: [
    `${process.env.APPDATA ?? ''}\\npm\\claude`,
    `${process.env.APPDATA ?? ''}\\npm\\claude.cmd`,
    `${process.env.LOCALAPPDATA ?? ''}\\npm\\claude`,
  ],
  copilot: [
    `${process.env.APPDATA ?? ''}\\npm\\copilot`,
    `${process.env.APPDATA ?? ''}\\npm\\copilot.cmd`,
    `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\\copilot.exe`,
  ],
};

export function isInstalled(command: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? `where.exe ${command}` : `which ${command}`;
    execSync(cmd, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    if (process.platform === 'win32') {
      return (WIN_KNOWN_PATHS[command] ?? []).some(existsSync);
    }
    return false;
  }
}
