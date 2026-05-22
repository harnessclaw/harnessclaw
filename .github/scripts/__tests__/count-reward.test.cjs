#!/usr/bin/env node
/**
 * Unit test for .github/scripts/count-reward.cjs
 *
 * Verifies that a reward entry with currency "CNY RMB" and amount 100
 * is aggregated into the monthly statistics output produced by
 * count-reward.cjs.
 *
 * Run:
 *   node .github/scripts/__tests__/count-reward.test.cjs
 *
 * Strategy:
 *   1. Create an isolated temp git repo + a bare repo as `origin`.
 *   2. Create an annotated `reward-37` tag whose message is the JSON
 *      payload share-reward.cjs would have written
 *      (CNY RMB 100 for @FenjuFu).
 *   3. Run count-reward.cjs with `node --require <preload>` where the
 *      preload monkey-patches child_process so any `gh` invocation is
 *      intercepted: `release view` returns empty (so the script enters
 *      the `release create` branch), and `release create` captures the
 *      `--notes` argument to a file for inspection. Other commands
 *      (git, node) pass through unchanged.
 *   4. Assert the captured release notes contain "CNY RMB 100.00"
 *      attributed to "@FenjuFu".
 */

const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const scriptPath = path.join(repoRoot, '.github', 'scripts', 'count-reward.cjs')

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
}

function setupTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-reward-test-'))
  run('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  run('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir })

  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-reward-origin-'))
  run('git', ['init', '-q', '--bare', bareDir])
  run('git', ['remote', 'add', 'origin', bareDir], { cwd: dir })
  run('git', ['push', '-q', 'origin', 'main'], { cwd: dir })

  return dir
}

function createRewardTag(repoDir, payload) {
  const message = JSON.stringify(payload, null, 2)
  const tagName = `reward-${payload.issue.replace('#', '')}`
  run('git', ['tag', '-a', tagName, 'HEAD', '-m', message], { cwd: repoDir })
}

function writePreload(captureFile) {
  // Preload script: intercepts child_process.execFileSync for `gh` only.
  const preloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-reward-preload-'))
  const preloadPath = path.join(preloadDir, 'preload.cjs')
  const src = `
const cp = require('node:child_process')
const fs = require('node:fs')

const realExecFileSync = cp.execFileSync.bind(cp)
cp.execFileSync = function (command, args, options) {
  if (command === 'gh' && Array.isArray(args)) {
    if (args[0] === 'release' && args[1] === 'view') {
      const err = new Error('release not found')
      err.status = 1
      throw err
    }
    if (args[0] === 'release' && (args[1] === 'create' || args[1] === 'edit')) {
      const idx = args.indexOf('--notes')
      if (idx >= 0) fs.writeFileSync(${JSON.stringify(captureFile)}, args[idx + 1])
      return 'ok'
    }
    return ''
  }
  return realExecFileSync(command, args, options)
}
`
  fs.writeFileSync(preloadPath, src)
  return preloadPath
}

function main() {
  console.log('Setting up isolated repo + bare origin...')
  const repoDir = setupTempRepo()

  const payload = {
    issue: '#37',
    sourcePr: 'https://github.com/harnessclaw/harnessclaw/pull/38',
    mergeCommitSha: 'deadbeefcafebabe',
    currency: 'CNY RMB',
    totalReward: 100,
    entries: [
      { issue: '#37', payer: '@harnessclaw', payee: '@FenjuFu', currency: 'CNY RMB', reward: 100 },
    ],
  }
  createRewardTag(repoDir, payload)

  const month = run('git', ['for-each-ref', 'refs/tags/reward-37', '--format=%(creatordate:short)'], { cwd: repoDir }).slice(0, 7)
  console.log(`Tag created in month: ${month}`)

  const captureFile = path.join(os.tmpdir(), `count-reward-notes-${Date.now()}.txt`)
  const preloadPath = writePreload(captureFile)

  console.log(`Running count-reward.cjs ${month} (gh calls intercepted via preload)...`)
  const result = spawnSync(process.execPath, ['--require', preloadPath, scriptPath, month], {
    cwd: repoDir,
    encoding: 'utf8',
  })

  console.log('--- script stdout ---')
  console.log(result.stdout)
  if (result.stderr) {
    console.log('--- script stderr ---')
    console.log(result.stderr)
  }

  assert.equal(result.status, 0, `Script exited with non-zero status: ${result.status}`)
  assert.ok(fs.existsSync(captureFile), 'gh release create was not invoked; release notes were not captured.')

  const notes = fs.readFileSync(captureFile, 'utf8')
  console.log('--- captured release notes ---')
  console.log(notes)

  assert.match(notes, /## Reward Summary /, 'Release notes missing header')
  assert.match(notes, /CNY RMB 100\.00/, 'Expected "CNY RMB 100.00" in release notes')
  assert.match(notes, /@FenjuFu/, 'Expected "@FenjuFu" payee in release notes')

  const jsonMatch = notes.match(/```json\n([\s\S]+?)\n```/)
  assert.ok(jsonMatch, 'Raw JSON block missing from release notes')
  const parsed = JSON.parse(jsonMatch[1])
  assert.equal(parsed.month, month)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].payee, '@FenjuFu')
  assert.deepEqual(parsed.entries[0].totals, ['CNY RMB 100.00'])

  console.log('\nPASS: CNY RMB 100 is counted correctly by count-reward.cjs')
}

main()

// touched by PR for issue #39 (reward workflow E2E test)
