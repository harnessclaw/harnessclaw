const { spawnSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = process.cwd()
const nanobotRoot = join(root, '..', 'nanobot')
const buildRoot = join(root, 'build', 'bundled-tools')
const distRoot = join(buildRoot, '.nanobot-dist')
const outputRoot = join(buildRoot, 'nanobot')
const workRoot = join(buildRoot, '.pyinstaller')
const entryScriptPath = join(buildRoot, 'nanobot-entry.py')

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`)
  }
}

function runQuiet(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: process.env,
  })
}

function resolvePython() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.ICUCLAW_BUILD_PYTHON,
        join(nanobotRoot, '.venv', 'Scripts', 'python.exe'),
        'py',
        'python',
      ]
    : [
        process.env.ICUCLAW_BUILD_PYTHON,
        join(nanobotRoot, '.venv', 'bin', 'python'),
        'python3',
        'python',
      ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (!existsSync(candidate)) continue
    }

    const args = /^py(?:\.exe)?$/i.test(candidate.split(/[\\/]/).pop() || candidate)
      ? ['-3', '-c', 'import sys; print(sys.executable)']
      : ['-c', 'import sys; print(sys.executable)']

    const result = runQuiet(candidate, args, nanobotRoot)
    if (result.status === 0) {
      return {
        command: candidate,
        prefix: /^py(?:\.exe)?$/i.test(candidate.split(/[\\/]/).pop() || candidate) ? ['-3'] : [],
      }
    }
  }

  throw new Error('Unable to find a Python interpreter for building nanobot')
}

function ensurePyInstaller(python) {
  const version = runQuiet(python.command, [...python.prefix, '-m', 'PyInstaller', '--version'], nanobotRoot)
  if (version.status === 0) return
  run(python.command, [...python.prefix, '-m', 'pip', 'install', 'pyinstaller'], nanobotRoot)
}

if (!existsSync(join(nanobotRoot, 'pyproject.toml'))) {
  throw new Error(`nanobot source repo not found at ${nanobotRoot}`)
}

rmSync(distRoot, { recursive: true, force: true })
rmSync(outputRoot, { recursive: true, force: true })
rmSync(workRoot, { recursive: true, force: true })
ensureDir(buildRoot)
ensureDir(workRoot)

writeFileSync(entryScriptPath, [
  'from nanobot.cli.commands import app',
  '',
  "if __name__ == '__main__':",
  '    app()',
  '',
].join('\n'))

const python = resolvePython()
ensurePyInstaller(python)

run(
  python.command,
  [
    ...python.prefix,
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--name',
    'nanobot',
    '--onedir',
    '--console',
    '--distpath',
    distRoot,
    '--workpath',
    join(workRoot, 'work'),
    '--specpath',
    join(workRoot, 'spec'),
    '--paths',
    nanobotRoot,
    '--collect-submodules',
    'nanobot',
    '--collect-data',
    'nanobot',
    '--add-data',
    `${join(nanobotRoot, 'bridge')}${process.platform === 'win32' ? ';' : ':'}nanobot/bridge`,
    entryScriptPath,
  ],
  nanobotRoot,
)

const stagedDir = join(distRoot, 'nanobot')
if (!existsSync(stagedDir)) {
  throw new Error(`Bundled nanobot output directory not found at ${stagedDir}`)
}

renameSync(stagedDir, outputRoot)

const builtExe = join(outputRoot, process.platform === 'win32' ? 'nanobot.exe' : 'nanobot')
if (!existsSync(builtExe)) {
  throw new Error(`Bundled nanobot executable not found at ${builtExe}`)
}

const nanobotVersion = /version\s*=\s*"([^"]+)"/.exec(readFileSync(join(nanobotRoot, 'pyproject.toml'), 'utf-8'))?.[1] || 'unknown'
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version

writeFileSync(join(outputRoot, 'runtime-manifest.json'), JSON.stringify({
  name: 'nanobot',
  version: nanobotVersion,
  appVersion,
  executable: process.platform === 'win32' ? 'nanobot.exe' : 'nanobot',
}, null, 2))
