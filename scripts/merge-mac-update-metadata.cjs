const { readFileSync, writeFileSync } = require('fs')
const yaml = require('js-yaml')

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'))
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function main() {
  const [, , arm64Path, x64Path, outputPath] = process.argv

  if (!arm64Path || !x64Path || !outputPath) {
    throw new Error('Usage: node scripts/merge-mac-update-metadata.cjs <arm64.yml> <x64.yml> <output.yml>')
  }

  const arm64 = loadYaml(arm64Path)
  const x64 = loadYaml(x64Path)

  if (!arm64 || typeof arm64 !== 'object' || !x64 || typeof x64 !== 'object') {
    throw new Error('Invalid update metadata input')
  }

  const arm64Files = ensureArray(arm64.files)
  const x64Files = ensureArray(x64.files)

  if (arm64Files.length === 0 || x64Files.length === 0) {
    throw new Error('Expected both arm64 and x64 metadata to contain files entries')
  }

  const merged = {
    version: arm64.version || x64.version,
    files: [...arm64Files, ...x64Files],
    releaseDate: arm64.releaseDate || x64.releaseDate,
  }

  writeFileSync(outputPath, yaml.dump(merged, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8')
  process.stdout.write(`Merged ${arm64Path} and ${x64Path} into ${outputPath}\n`)
}

main()
