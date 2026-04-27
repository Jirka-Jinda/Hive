const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function getNpmCliPath() {
  if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) {
    return process.env.npm_execpath;
  }

  const bundledCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );

  if (fs.existsSync(bundledCli)) {
    return bundledCli;
  }

  throw new Error('Unable to locate npm-cli.js for native dependency repair.');
}

function loadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return null;
  } catch (error) {
    return error;
  }
}

function isAbiMismatch(error) {
  if (!error || typeof error !== 'object') return false;
  const message = error instanceof Error ? error.message : String(error);
  return /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/.test(message);
}

const loadError = loadBetterSqlite3();
if (!loadError) {
  process.exit(0);
}

if (!isAbiMismatch(loadError)) {
  throw loadError;
}

console.log('[native-deps] Rebuilding better-sqlite3 for the current Node runtime...');

execFileSync(
  process.execPath,
  [getNpmCliPath(), 'rebuild', 'better-sqlite3', '--foreground-scripts'],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  }
);

const rebuiltError = loadBetterSqlite3();
if (rebuiltError) {
  throw rebuiltError;
}