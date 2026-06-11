const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const root = join(__dirname, '..')

function loadUtilsModule() {
  const sourcePath = join(root, 'src', 'renderer', 'src', 'lib', 'utils.ts')
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

test('normalizes markdown image sources that point at generated local images', () => {
  const { normalizeMarkdownImageSrc } = loadUtilsModule()

  assert.equal(typeof normalizeMarkdownImageSrc, 'function')
  assert.equal(
    normalizeMarkdownImageSrc('/Users/alice/Pictures/generated image.png'),
    'local-file://local/Users/alice/Pictures/generated%20image.png',
  )
  assert.equal(
    normalizeMarkdownImageSrc('file:///Users/alice/Pictures/generated%20image.png'),
    'local-file://local/Users/alice/Pictures/generated%20image.png',
  )
  assert.equal(
    normalizeMarkdownImageSrc('local-file://local/Users/alice/Pictures/generated%20image.png'),
    'local-file://local/Users/alice/Pictures/generated%20image.png',
  )
})

test('preserves safe remote and data image sources while rejecting non-image data URLs', () => {
  const { normalizeMarkdownImageSrc } = loadUtilsModule()

  assert.equal(normalizeMarkdownImageSrc('https://example.com/generated.png'), 'https://example.com/generated.png')
  assert.equal(normalizeMarkdownImageSrc('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(normalizeMarkdownImageSrc('data:text/html;base64,PGh0bWw+'), undefined)
})
