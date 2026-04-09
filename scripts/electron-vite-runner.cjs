const { dirname, join } = require('path')
const { spawn } = require('child_process')

const electronVitePkg = require.resolve('electron-vite/package.json')
const electronViteCli = join(dirname(electronVitePkg), 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [electronViteCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error('[dev-runner] Failed to start electron-vite:', error)
  process.exit(1)
})
