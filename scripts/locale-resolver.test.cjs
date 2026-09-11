const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = join(__dirname, '..')

function loadLocaleModule() {
  const sourcePath = join(root, 'src', 'renderer', 'src', 'lib', 'locale.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const mod = { exports: {} }
  const fn = new Function('require', 'module', 'exports', compiled)
  fn(require, mod, mod.exports)
  return mod.exports
}

function loadLocaleJson(language) {
  const path = join(root, 'src', 'renderer', 'src', 'locales', `${language}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('resolves each supported language to its own locale', () => {
  const { resolveLocale } = loadLocaleModule()

  assert.equal(resolveLocale('en'), 'en-US')
  assert.equal(resolveLocale('zh'), 'zh-CN')
  assert.equal(resolveLocale('ko'), 'ko-KR')
})

test('resolves region and script subtags back to the base language', () => {
  const { resolveLocale } = loadLocaleModule()

  assert.equal(resolveLocale('ko-KR'), 'ko-KR')
  assert.equal(resolveLocale('ko_KR'), 'ko-KR')
  assert.equal(resolveLocale('KO'), 'ko-KR')
  assert.equal(resolveLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(resolveLocale('en-GB'), 'en-US')
})

test('falls back to the i18next fallback language for anything unmapped', () => {
  const { resolveLocale, FALLBACK_LOCALE } = loadLocaleModule()

  assert.equal(FALLBACK_LOCALE, 'zh-CN')
  assert.equal(resolveLocale('fr'), 'zh-CN')
  assert.equal(resolveLocale(''), 'zh-CN')
  assert.equal(resolveLocale(undefined), 'zh-CN')
  assert.equal(resolveLocale(null), 'zh-CN')
})

test('Korean actually reaches Intl rather than falling through to en-US or zh-CN', () => {
  const { resolveLocale } = loadLocaleModule()

  const locale = resolveLocale('ko')
  assert.equal(new Intl.DateTimeFormat(locale).resolvedOptions().locale, 'ko-KR')

  // The regression this guards: every call site used to map any non-zh language
  // to en-US, or any non-en language to zh-CN, so a Korean user saw English or
  // Chinese dates. Formatting the same instant must now differ from both.
  const instant = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }
  const ko = new Intl.DateTimeFormat(locale, options).format(instant)

  assert.notEqual(ko, new Intl.DateTimeFormat('en-US', options).format(instant))
  assert.notEqual(ko, new Intl.DateTimeFormat('zh-CN', options).format(instant))
})

test('every mapped language agrees with the common.locale string in its locale file', () => {
  const { LOCALE_BY_LANGUAGE } = loadLocaleModule()

  for (const [language, locale] of Object.entries(LOCALE_BY_LANGUAGE)) {
    assert.equal(
      loadLocaleJson(language).common.locale,
      locale,
      `common.locale in ${language}.json should match resolveLocale('${language}')`,
    )
  }
})
