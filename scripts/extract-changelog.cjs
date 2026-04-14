#!/usr/bin/env node

const { readFileSync } = require('fs')
const { join } = require('path')

function printUsage() {
  process.stderr.write(
    'Usage: node scripts/extract-changelog.cjs --version <x.y.z> [--locale <en|zh-CN|bilingual>] [--with-title]\n'
  )
}

function parseArgs(argv) {
  const options = {
    changelogDir: join(process.cwd(), 'changelog'),
    version: '',
    locale: 'en',
    withTitle: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--version') {
      options.version = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--locale') {
      options.locale = argv[index + 1] || options.locale
      index += 1
      continue
    }
    if (arg === '--with-title') {
      options.withTitle = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
  }

  if (!options.version) {
    printUsage()
    process.stderr.write('\nMissing required --version argument.\n')
    process.exit(1)
  }

  return options
}

function normalizeLineEndings(input) {
  return input.replace(/\r\n/g, '\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function findRelease(changelogDir, version) {
  const releases = readJson(join(changelogDir, 'releases.json'))
  const release = releases.find((item) => item.version === version)
  if (!release) {
    throw new Error(`Version ${version} not found in changelog`)
  }
  return release
}

function readLocaleSection(changelogDir, version, locale) {
  return normalizeLineEndings(
    readFileSync(join(changelogDir, version, `${locale}.md`), 'utf-8')
  ).trim()
}

function composeBilingualBody(changelogDir, version) {
  const zh = readLocaleSection(changelogDir, version, 'zh-CN')
  const en = readLocaleSection(changelogDir, version, 'en')

  return [
    '## 中文',
    '',
    zh,
    '',
    '## English',
    '',
    en,
  ].join('\n').trim()
}

function extractVersionSection(changelogDir, version, locale) {
  const release = findRelease(changelogDir, version)
  const title = `## [${release.version}] - ${release.date}`

  if (locale === 'bilingual') {
    return {
      title,
      body: composeBilingualBody(changelogDir, version),
    }
  }

  return {
    title,
    body: readLocaleSection(changelogDir, version, locale),
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const section = extractVersionSection(options.changelogDir, options.version, options.locale)
  const output = options.withTitle ? `${section.title}\n\n${section.body}` : section.body

  process.stdout.write(`${output.trim()}\n`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
