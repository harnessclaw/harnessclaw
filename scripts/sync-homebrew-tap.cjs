const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null) {
      throw new Error(`Invalid arguments near: ${key || '<missing>'}`)
    }
    args[key.slice(2)] = value
  }
  return args
}

function loadMetadata(metadataDir) {
  const files = readdirSync(metadataDir).filter((file) => file.endsWith('.json'))
  if (files.length === 0) {
    throw new Error(`No metadata files found in ${metadataDir}`)
  }

  const records = files.map((file) => {
    const fullPath = join(metadataDir, file)
    return JSON.parse(readFileSync(fullPath, 'utf8'))
  })

  const byArch = Object.fromEntries(records.map((record) => [record.arch, record]))
  const arm = byArch.arm64
  const intel = byArch.x64

  if (!arm || !intel) {
    throw new Error(`Expected arm64 and x64 metadata, got: ${Object.keys(byArch).join(', ') || 'none'}`)
  }

  if (arm.version !== intel.version) {
    throw new Error(`Version mismatch between arm64 (${arm.version}) and x64 (${intel.version})`)
  }

  return {
    version: arm.version,
    armSha256: arm.sha256,
    intelSha256: intel.sha256,
  }
}

function renderCask({ version, sourceRepo, armSha256, intelSha256 }) {
  return `cask "harnessclaw" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armSha256}",
         intel: "${intelSha256}"

  url "https://github.com/${sourceRepo}/releases/download/v#{version}/HarnessClaw-#{version}-mac-#{arch}.zip",
      verified: "github.com/${sourceRepo}/"
  name "HarnessClaw"
  desc "Desktop agent control console"
  homepage "https://github.com/${sourceRepo}"

  auto_updates true

  livecheck do
    url :url
    strategy :github_latest
  end

  app "HarnessClaw.app"
end
`
}

function main() {
  const args = parseArgs(process.argv)
  const metadataDir = args['metadata-dir']
  const tapDir = args['tap-dir']
  const sourceRepo = args['source-repo']

  if (!metadataDir || !tapDir || !sourceRepo) {
    throw new Error('Usage: node scripts/sync-homebrew-tap.cjs --metadata-dir <dir> --tap-dir <dir> --source-repo <owner/repo>')
  }

  const metadata = loadMetadata(metadataDir)
  const caskDir = join(tapDir, 'Casks')
  const caskPath = join(caskDir, 'harnessclaw.rb')

  mkdirSync(caskDir, { recursive: true })
  writeFileSync(caskPath, renderCask({ ...metadata, sourceRepo }), 'utf8')
  process.stdout.write(`${caskPath}\n`)
}

main()
