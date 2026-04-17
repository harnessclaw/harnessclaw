const { chmodSync, createWriteStream, mkdirSync, readdirSync, rmSync, writeFileSync } = require('fs')
const https = require('https')
const { join, resolve } = require('path')

function normalizePlatform(platform) {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  throw new Error(`Unsupported platform: ${platform}`)
}

function normalizeArch(arch) {
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`Unsupported arch: ${arch}`)
}

function request(url, headers, redirectCount = 0) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = https.get(url, { headers }, (response) => {
      const statusCode = response.statusCode || 0

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume()
        if (redirectCount >= 5) {
          rejectRequest(new Error(`Too many redirects while requesting ${url}`))
          return
        }
        resolveRequest(request(response.headers.location, headers, redirectCount + 1))
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          rejectRequest(new Error(`Request to ${url} failed: ${statusCode} ${Buffer.concat(chunks).toString('utf8').trim()}`))
        })
        return
      }

      resolveRequest(response)
    })

    req.on('error', rejectRequest)
  })
}

async function fetchJson(url, headers) {
  const response = await request(url, headers)
  const chunks = []
  for await (const chunk of response) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function downloadToFile(url, headers, targetPath) {
  const response = await request(url, headers)
  await new Promise((resolveDownload, rejectDownload) => {
    const fileStream = createWriteStream(targetPath)
    response.pipe(fileStream)

    response.on('error', rejectDownload)
    fileStream.on('error', rejectDownload)
    fileStream.on('finish', () => {
      fileStream.close((error) => {
        if (error) {
          rejectDownload(error)
          return
        }
        resolveDownload()
      })
    })
  })
}

async function main() {
  const outputDir = resolve(process.argv[2] || join(__dirname, '..', 'resources', 'bin'))
  const baseName = 'harnessclaw-engine'
  const platform = normalizePlatform(process.env.HARNESSCLAW_ENGINE_PLATFORM || process.platform)
  const arch = normalizeArch(process.env.HARNESSCLAW_ENGINE_ARCH || process.arch)
  const extension = platform === 'windows' ? '.exe' : ''
  const assetName = `${baseName}-${platform}-${arch}${extension}`
  const repo = process.env.HARNESSCLAW_ENGINE_REPO || 'harnessclaw/harnessclaw-engine'
  const releaseApiUrl = `https://api.github.com/repos/${repo}/releases/latest`
  const token = process.env.HARNESSCLAW_ENGINE_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'harnessclaw-release-fetcher',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const release = await fetchJson(releaseApiUrl, headers)
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item && item.name === assetName)
    : null

  if (!asset || !asset.browser_download_url) {
    throw new Error(`Asset ${assetName} not found in latest release ${release.tag_name || '<unknown>'}`)
  }

  mkdirSync(outputDir, { recursive: true })
  for (const entry of readdirSync(outputDir)) {
    if (entry === 'README.md') continue
    if (entry === 'harnessclaw-engine' || entry.startsWith('harnessclaw-engine-')) {
      rmSync(join(outputDir, entry), { recursive: true, force: true })
    }
  }

  const targetPath = join(outputDir, `${baseName}${extension}`)
  await downloadToFile(asset.browser_download_url, headers, targetPath)
  if (platform !== 'windows') {
    chmodSync(targetPath, 0o755)
  }

  process.stdout.write(`Downloaded ${asset.name} from ${release.tag_name} to ${targetPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
