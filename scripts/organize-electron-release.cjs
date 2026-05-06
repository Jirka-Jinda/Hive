const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'install', 'release');
const readmePath = path.join(rootDir, 'README.md');
const executableDir = path.join(releaseDir, 'executable');
const installationDir = path.join(releaseDir, 'installation');

function moveEntry(name, destinationDir) {
  const sourcePath = path.join(releaseDir, name);
  const destinationPath = path.join(destinationDir, name);
  if (!fs.existsSync(sourcePath) || sourcePath === destinationPath) return;
  fs.rmSync(destinationPath, { recursive: true, force: true });
  fs.renameSync(sourcePath, destinationPath);
}

function classifyEntry(entry) {
  const lowerName = entry.name.toLowerCase();

  if (entry.isDirectory()) {
    if (lowerName === 'win-unpacked' || lowerName.includes('portable') || lowerName.endsWith('-unpacked')) {
      return 'executable';
    }
    return 'installation';
  }

  if (lowerName.endsWith('.blockmap')) return 'installation';
  if (lowerName.endsWith('.yml') || lowerName.endsWith('.yaml')) return 'installation';
  if (lowerName.endsWith('.exe')) return lowerName.includes('setup') ? 'installation' : 'executable';
  if (lowerName.endsWith('.msi') || lowerName.endsWith('.dmg') || lowerName.endsWith('.appimage')) return 'installation';

  return 'installation';
}

if (!fs.existsSync(releaseDir)) {
  throw new Error(`Release directory not found: ${releaseDir}`);
}

fs.mkdirSync(executableDir, { recursive: true });
fs.mkdirSync(installationDir, { recursive: true });

for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  if (entry.name === 'executable' || entry.name === 'installation') continue;
  const targetDir = classifyEntry(entry) === 'executable' ? executableDir : installationDir;
  moveEntry(entry.name, targetDir);
}

fs.copyFileSync(readmePath, path.join(executableDir, 'README.md'));
fs.copyFileSync(readmePath, path.join(installationDir, 'README.md'));
