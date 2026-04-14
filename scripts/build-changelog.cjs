#!/usr/bin/env node

const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = process.cwd()
const changelogDir = join(root, 'changelog')
const releasesPath = join(changelogDir, 'releases.json')

const LOCALES = {
  en: {
    file: join(root, 'CHANGELOG.md'),
    title: '# Changelog',
    intro: [
      'All notable changes to this project will be documented in this file.',
      '',
      'The format is based on Keep a Changelog, with versions tracked in the repository and published to GitHub Releases.',
    ],
  },
  'zh-CN': {
    file: join(root, 'CHANGELOG_zh.md'),
    title: '# 更新日志',
    intro: [
      '本文件用于记录项目的重要更新内容。',
      '',
      '格式参考 Keep a Changelog。英文原始版本请见 `CHANGELOG.md`。',
    ],
  },
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function readSection(version, locale) {
  return readFileSync(join(changelogDir, version, `${locale}.md`), 'utf-8').trim()
}

function buildDocument(locale) {
  const releases = readJson(releasesPath)
  const config = LOCALES[locale]
  const lines = [config.title, '', ...config.intro]

  releases.forEach((release) => {
    lines.push('', `## [${release.version}] - ${release.date}`, '', readSection(release.version, locale))
  })

  return `${lines.join('\n').trim()}\n`
}

function main() {
  Object.keys(LOCALES).forEach((locale) => {
    const config = LOCALES[locale]
    writeFileSync(config.file, buildDocument(locale), 'utf-8')
    process.stdout.write(`Updated ${config.file}\n`)
  })
}

main()
