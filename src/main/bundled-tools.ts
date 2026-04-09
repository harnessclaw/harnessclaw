import AdmZip from 'adm-zip'
import { app } from 'electron'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { writeAppLog } from './logging'
import { BIN_DIR } from './runtime-paths'

export interface LaunchSpec {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  source: string
}

export interface BundledToolStatus {
  installed: boolean
  bundled: boolean
  path: string
  runtimePath: string
  entryPath: string
  source: string
  error?: string
  archivePath?: string
  sourcePath?: string
}

interface RuntimeManifest {
  name: string
  version: string
  appVersion: string
  entry?: string
  executable?: string
  archive?: string
}

type RuntimeName = 'nanobot' | 'clawhub'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readManifest(dir: string): RuntimeManifest | null {
  const path = join(dir, 'runtime-manifest.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeManifest
  } catch {
    return null
  }
}

function getSourceRootCandidates(): string[] {
  const appPath = app.getAppPath()
  const root = process.cwd()

  return [
    process.env.ICUCLAW_BUNDLED_TOOLS_DIR,
    app.isPackaged ? join(process.resourcesPath, 'bundled-tools') : undefined,
    join(root, 'build', 'bundled-tools'),
    join(appPath, 'build', 'bundled-tools'),
    join(appPath, '..', 'build', 'bundled-tools'),
    join(appPath, '..', '..', 'build', 'bundled-tools'),
  ].filter((value): value is string => Boolean(value))
}

function getSourceRuntimeDir(name: RuntimeName): string | null {
  for (const candidate of getSourceRootCandidates()) {
    const dir = resolve(candidate, name)
    if (existsSync(join(dir, 'runtime-manifest.json'))) {
      return dir
    }
  }
  return null
}

function getTargetRuntimeDir(name: RuntimeName): string {
  return join(BIN_DIR, `${name}-runtime`)
}

function getEntryRelativePath(name: RuntimeName, manifest: RuntimeManifest | null): string {
  if (name === 'nanobot') {
    return manifest?.executable || (process.platform === 'win32' ? 'nanobot.exe' : 'nanobot')
  }
  return manifest?.entry || join('node_modules', 'clawhub', 'bin', 'clawdhub.js')
}

function getEntryAbsolutePath(name: RuntimeName, runtimeDir: string, manifest?: RuntimeManifest | null): string {
  const resolvedManifest = manifest ?? readManifest(runtimeDir)
  return join(runtimeDir, getEntryRelativePath(name, resolvedManifest))
}

function getArchiveAbsolutePath(runtimeDir: string, manifest: RuntimeManifest | null): string {
  if (!manifest?.archive) return ''
  return join(runtimeDir, manifest.archive)
}

function runtimeHasExtractedEntry(name: RuntimeName, runtimeDir: string, manifest?: RuntimeManifest | null): boolean {
  if (!existsSync(runtimeDir)) return false
  return existsSync(getEntryAbsolutePath(name, runtimeDir, manifest))
}

function runtimeIsHealthy(name: RuntimeName, runtimeDir: string): boolean {
  if (!existsSync(runtimeDir)) return false
  const manifest = readManifest(runtimeDir)
  if (!manifest) return false
  return runtimeHasExtractedEntry(name, runtimeDir, manifest)
}

function manifestsMatch(sourceDir: string, targetDir: string): boolean {
  const source = readManifest(sourceDir)
  const target = readManifest(targetDir)
  return Boolean(source && target && JSON.stringify(source) === JSON.stringify(target))
}

function copyManifestFiles(sourceDir: string, targetDir: string): void {
  for (const filename of ['runtime-manifest.json', 'package.json']) {
    const sourcePath = join(sourceDir, filename)
    if (!existsSync(sourcePath)) continue
    copyFileSync(sourcePath, join(targetDir, filename))
  }
}

function extractRuntimeArchive(sourceDir: string, targetDir: string, manifest: RuntimeManifest): string {
  const archivePath = getArchiveAbsolutePath(sourceDir, manifest)
  if (!archivePath || !existsSync(archivePath)) {
    throw new Error(`Bundled runtime archive not found: ${archivePath || '(missing archive path)'}`)
  }

  copyManifestFiles(sourceDir, targetDir)
  const zip = new AdmZip(archivePath)
  zip.extractAllTo(targetDir, true)
  return archivePath
}

function logSyncOutcome(
  level: 'info' | 'warn' | 'error',
  name: RuntimeName,
  message: string,
  meta: Record<string, unknown>
): void {
  writeAppLog(level, `bundled-tools:${name}`, message, meta)
}

function syncBundledRuntime(name: RuntimeName, options?: { force?: boolean }): BundledToolStatus {
  const sourceDir = getSourceRuntimeDir(name)
  const targetDir = getTargetRuntimeDir(name)

  if (!sourceDir) {
    const missingStatus = {
      installed: false,
      bundled: false,
      path: targetDir,
      runtimePath: targetDir,
      entryPath: '',
      source: 'not bundled',
      error: 'Bundled runtime not found',
      sourcePath: '',
      archivePath: '',
    }
    logSyncOutcome('warn', name, 'Bundled runtime source missing', missingStatus)
    return missingStatus
  }

  const sourceManifest = readManifest(sourceDir)
  const sourceEntryPath = getEntryAbsolutePath(name, sourceDir, sourceManifest)
  const sourceArchivePath = getArchiveAbsolutePath(sourceDir, sourceManifest)
  const sourceHealthy = Boolean(sourceManifest) && runtimeHasExtractedEntry(name, sourceDir, sourceManifest)
  const sourceRecoverable = Boolean(sourceManifest && sourceArchivePath && existsSync(sourceArchivePath))
  const sourceLabel = app.isPackaged ? 'bundled resources' : 'local bundled-tools'

  try {
    ensureDir(BIN_DIR)

    if (!sourceHealthy && !sourceRecoverable) {
      const status = {
        installed: false,
        bundled: true,
        path: targetDir,
        runtimePath: targetDir,
        entryPath: sourceEntryPath,
        source: sourceLabel,
        error: 'Bundled runtime source is incomplete',
        sourcePath: sourceDir,
        archivePath: sourceArchivePath,
      }
      logSyncOutcome('warn', name, 'Bundled runtime source is incomplete', {
        sourcePath: sourceDir,
        targetPath: targetDir,
        entryPath: sourceEntryPath,
        archivePath: sourceArchivePath,
      })
      return status
    }

    const targetHealthy = runtimeIsHealthy(name, targetDir)
    const shouldSync = options?.force || !targetHealthy || !manifestsMatch(sourceDir, targetDir)

    if (shouldSync) {
      rmSync(targetDir, { recursive: true, force: true })
      ensureDir(targetDir)

      if (sourceHealthy) {
        cpSync(sourceDir, targetDir, { recursive: true, force: true })
        logSyncOutcome('info', name, 'Synced bundled runtime from extracted source', {
          sourcePath: sourceDir,
          targetPath: targetDir,
          entryPath: sourceEntryPath,
          archivePath: sourceArchivePath,
        })
      } else if (sourceManifest) {
        const archivePath = extractRuntimeArchive(sourceDir, targetDir, sourceManifest)
        logSyncOutcome('info', name, 'Restored bundled runtime from archive', {
          sourcePath: sourceDir,
          targetPath: targetDir,
          entryPath: getEntryAbsolutePath(name, targetDir, sourceManifest),
          archivePath,
        })
      }
    }

    const targetManifest = readManifest(targetDir)
    const entryPath = getEntryAbsolutePath(name, targetDir, targetManifest)
    const installed = existsSync(entryPath)
    const error = installed
      ? undefined
      : `Bundled runtime entry not found: ${entryPath}`

    if (error) {
      logSyncOutcome('error', name, 'Bundled runtime entry missing after sync', {
        sourcePath: sourceDir,
        targetPath: targetDir,
        entryPath,
        archivePath: sourceArchivePath,
        manifestEntry: getEntryRelativePath(name, targetManifest),
      })
    }

    return {
      installed,
      bundled: true,
      path: targetDir,
      runtimePath: targetDir,
      entryPath,
      source: sourceLabel,
      error,
      archivePath: sourceArchivePath,
      sourcePath: sourceDir,
    }
  } catch (error) {
    const entryPath = getEntryAbsolutePath(name, targetDir)
    logSyncOutcome('error', name, 'Failed to sync bundled runtime', {
      sourcePath: sourceDir,
      targetPath: targetDir,
      entryPath,
      archivePath: sourceArchivePath,
      error: String(error),
    })
    return {
      installed: false,
      bundled: true,
      path: targetDir,
      runtimePath: targetDir,
      entryPath,
      source: sourceLabel,
      error: String(error),
      archivePath: sourceArchivePath,
      sourcePath: sourceDir,
    }
  }
}

export function ensureBundledRuntimes(): void {
  syncBundledRuntime('nanobot')
  syncBundledRuntime('clawhub')
}

export function getBundledNanobotLaunchSpec(): LaunchSpec | null {
  const status = syncBundledRuntime('nanobot')
  if (!status.installed) return null

  const manifest = readManifest(status.runtimePath)
  const executable = manifest?.executable || (process.platform === 'win32' ? 'nanobot.exe' : 'nanobot')
  const binaryPath = join(status.runtimePath, executable)
  if (!existsSync(binaryPath)) return null

  return {
    command: binaryPath,
    args: [],
    cwd: status.runtimePath,
    source: `bundled runtime: ${binaryPath}`,
  }
}

export function getBundledClawhubStatus(options?: { forceSync?: boolean }): BundledToolStatus {
  const status = syncBundledRuntime('clawhub', { force: options?.forceSync })
  if (!status.installed) return status

  return {
    ...status,
    installed: existsSync(status.entryPath),
    path: status.runtimePath,
    runtimePath: status.runtimePath,
    entryPath: status.entryPath,
    error: existsSync(status.entryPath) ? undefined : `Bundled ClawHub entrypoint not found: ${status.entryPath}`,
  }
}

export function getBundledClawhubLaunchSpec(): LaunchSpec | null {
  const status = getBundledClawhubStatus()
  if (!status.installed) return null

  return {
    command: process.execPath,
    args: [status.entryPath],
    cwd: status.runtimePath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    source: `bundled runtime: ${status.runtimePath}`,
  }
}
