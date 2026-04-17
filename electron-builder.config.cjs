const { existsSync } = require('fs')
const { join } = require('path')

const owner = process.env.GH_RELEASE_OWNER || process.env.GITHUB_REPOSITORY_OWNER || ''
const repo = process.env.GH_RELEASE_REPO || (process.env.GITHUB_REPOSITORY || '').split('/')[1] || ''
const hasNotarizeCredentials = Boolean(
  (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) ||
    process.env.APPLE_KEYCHAIN_PROFILE ||
    (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD),
)

function optionalFile(path) {
  return existsSync(path) ? path : undefined
}

function resolveMacNotarize() {
  if (!hasNotarizeCredentials) {
    return false
  }

  // Use keychain profile if available (API key mode)
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
    }
  }

  // Use Apple ID mode with explicit teamId
  if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    return {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }
  }

  return false
}

const config = {
  appId: 'com.iflytek.harnessclaw',
  productName: 'HarnessClaw',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'out/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: 'resources/bin',
      to: 'bin',
      filter: ['**/*'],
    },
    {
      from: 'resources/templates',
      to: 'templates',
      filter: ['**/*'],
    },
  ],
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.productivity',
    target: ['dmg', 'zip'],
    icon: optionalFile(join('resources', 'icon.icns')),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: resolveMacNotarize(),
  },
  win: {
    target: ['nsis'],
    icon: optionalFile(join('resources', 'icon.ico')),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  linux: {
    target: ['AppImage'],
    icon: optionalFile(join('resources', 'icon.png')),
    category: 'Utility',
  },
}

if (owner && repo) {
  config.publish = [
    {
      provider: 'github',
      owner,
      repo,
      releaseType: process.env.GH_RELEASE_TYPE || 'draft',
    },
  ]
}

module.exports = config
