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

    throw new Error('Unable to locate npm-cli.js for the Electron beforeBuild hook.');
}

module.exports = async function beforeBuild(context) {
    const { rebuild } = await import('@electron/rebuild');
    const npmCli = getNpmCliPath();

    fs.rmSync(`${context.appDir}/node_modules`, { recursive: true, force: true });

    execFileSync(
        process.execPath,
        [
            npmCli,
            'install',
            '--omit=dev',
            '--workspaces=false',
            '--package-lock=false',
            '--fund=false',
            '--audit=false',
        ],
        {
            cwd: context.appDir,
            stdio: 'inherit',
            env: process.env,
        }
    );

    await rebuild({
        buildPath: context.appDir,
        electronVersion: context.electronVersion,
        arch: context.arch,
        force: true,
        onlyModules: ['better-sqlite3'],
        mode: 'sequential',
        types: ['prod', 'optional'],
    });

    return false;
};