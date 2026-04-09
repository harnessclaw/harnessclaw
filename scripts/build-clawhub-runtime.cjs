const AdmZip = require('adm-zip')
const { spawnSync } = require('child_process')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = process.cwd()
const outputDir = join(root, 'build', 'bundled-tools', 'clawhub')
const packageJsonPath = join(outputDir, 'package.json')
const archiveName = 'payload.zip'
const archivePath = join(outputDir, archiveName)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function ensureCleanDir(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function run(command, args, cwd) {
  const invocation = process.platform === 'win32'
    ? {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/c', command, ...args],
      }
    : { command, args }

  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`)
  }
}

function buildArchive() {
  const zip = new AdmZip()
  zip.addLocalFile(packageJsonPath)
  zip.addLocalFolder(join(outputDir, 'node_modules'), 'node_modules')
  zip.writeZip(archivePath)
}

ensureCleanDir(outputDir)

writeFileSync(packageJsonPath, JSON.stringify({
  name: 'openclaw-clawhub-runtime',
  private: true,
}, null, 2))

run(npmCommand, ['install', '--omit=dev', '--no-package-lock', '--fund=false', '--audit=false', 'clawhub@0.9.0'], outputDir)

const clawhubPkg = JSON.parse(readFileSync(join(outputDir, 'node_modules', 'clawhub', 'package.json'), 'utf-8'))
const packageBin = clawhubPkg.bin || {}
const entry = packageBin.clawhub || packageBin.clawdhub || 'bin/clawdhub.js'

buildArchive()

const manifest = {
  name: 'clawhub',
  version: clawhubPkg.version,
  appVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version,
  entry: join('node_modules', 'clawhub', entry),
  archive: archiveName,
}

writeFileSync(join(outputDir, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2))

if (!existsSync(join(outputDir, manifest.entry))) {
  throw new Error('Bundled ClawHub entrypoint was not created')
}

if (!existsSync(archivePath)) {
  throw new Error('Bundled ClawHub archive was not created')
}
