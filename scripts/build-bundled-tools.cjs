const { spawnSync } = require('child_process')
const { join } = require('path')

const root = process.cwd()
const scripts = [
  join(root, 'scripts', 'build-nanobot-runtime.cjs'),
  join(root, 'scripts', 'build-clawhub-runtime.cjs'),
]

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
