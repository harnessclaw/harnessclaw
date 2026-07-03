#!/usr/bin/env node

const { execFileSync } = require('node:child_process')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function tryRun(command, args, options = {}) {
  try {
    return run(command, args, options)
  } catch {
    return ''
  }
}

function resolveTargetMonth(rawMonth) {
  if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) return rawMonth
  const now = new Date()
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return previousMonth.toISOString().slice(0, 7)
}

function parseRewardPayload(raw) {
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (parsed && Array.isArray(parsed.entries)) {
    return parsed.entries
  }
  return []
}

function formatReleaseNotes(month, summary, rawData) {
  const lines = [
    `## Reward Summary ${month}`,
    '',
    '| Payee | Totals |',
    '| --- | --- |',
    ...summary.map((item) => `| ${item.payee} | ${item.totals.join(', ')} |`),
    '',
    '<details>',
    '<summary>Raw reward data</summary>',
    '',
    '```json',
    JSON.stringify(rawData, null, 2),
    '```',
    '',
    '</details>',
  ]
  return lines.join('\n')
}

const month = resolveTargetMonth(process.argv[2])
const statisticsTag = `statistic-${month}`
const rawTagList = run('git', [
  'for-each-ref',
  'refs/tags/reward-*',
  '--format=%(refname:short)|%(creatordate:short)',
])

const rewardTags = rawTagList
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [tag, createdAt] = line.split('|')
    return { tag, createdAt }
  })
  .filter((item) => item.createdAt && item.createdAt.startsWith(month))

if (!rewardTags.length) {
  console.log(`No reward tags found for ${month}.`)
  process.exit(0)
}

const rawEntries = rewardTags.flatMap(({ tag }) => {
  const payload = tryRun('git', ['tag', '-l', '--format=%(contents)', tag])
  if (!payload) return []
  return parseRewardPayload(payload)
})

if (!rawEntries.length) {
  console.log(`Reward tags exist for ${month}, but none contains parsable entries.`)
  process.exit(0)
}

const grouped = new Map()
for (const entry of rawEntries) {
  const payee = String(entry.payee || '').trim()
  const currency = String(entry.currency || '').trim()
  const reward = Number(entry.reward || 0)
  if (!payee || !currency || !Number.isFinite(reward) || reward <= 0) continue

  if (!grouped.has(payee)) {
    grouped.set(payee, { payee, totals: new Map(), rewards: [] })
  }

  const item = grouped.get(payee)
  item.totals.set(currency, (item.totals.get(currency) || 0) + reward)
  item.rewards.push({
    issue: entry.issue,
    payer: entry.payer,
    currency,
    reward,
  })
}

const summary = Array.from(grouped.values())
  .sort((left, right) => String(left.payee).localeCompare(String(right.payee)))
  .map((item) => ({
    payee: item.payee,
    totals: Array.from(item.totals.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, total]) => `${currency} ${Number(total).toFixed(2)}`),
    rewards: item.rewards,
  }))

const statisticsPayload = {
  month,
  generatedAt: new Date().toISOString(),
  rewardTagCount: rewardTags.length,
  entries: summary,
}

const releaseNotes = formatReleaseNotes(month, summary, statisticsPayload)
const hasStatisticsTag = !!tryRun('git', ['rev-parse', '-q', '--verify', `refs/tags/${statisticsTag}`])

run('git', ['config', 'user.name', 'github-actions[bot]'])
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
try {
  if (!hasStatisticsTag) {
    run('git', ['tag', '-a', statisticsTag, 'HEAD', '-m', JSON.stringify(statisticsPayload, null, 2)])
    run('git', ['push', 'origin', `refs/tags/${statisticsTag}`])
  }
} finally {
  tryRun('git', ['config', '--unset', 'user.name'])
  tryRun('git', ['config', '--unset', 'user.email'])
}

// 统计 release 必须标记为 prerelease：否则它会成为 GitHub 的 `releases/latest`
// （非 prerelease 且日期最新），把 electron-updater 的更新源顶包 —— 客户端拉
// `.../releases/latest/download/latest.yml` 会 302 到统计 release 而 404，导致
// 每次启动弹“更新失败”。加 --prerelease 让 releases/latest 只认真正的 App 版本。
const existingRelease = tryRun('gh', ['release', 'view', statisticsTag])
if (existingRelease) {
  run('gh', ['release', 'edit', statisticsTag, '--title', statisticsTag, '--notes', releaseNotes, '--prerelease'])
} else {
  run('gh', ['release', 'create', statisticsTag, '--title', statisticsTag, '--notes', releaseNotes, '--prerelease'])
}
