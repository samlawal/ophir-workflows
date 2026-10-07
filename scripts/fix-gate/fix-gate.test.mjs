// node --test scripts/fix-gate/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, globToRegExp, isTestFile } from './classify.mjs'
import { sign, bugIdFromBranch, buildReport } from './report.mjs'

const rules = {
  forbidden: ['.github/**', 'vercel.json', 'package.json', 'package-lock.json', '.env*', '.ophir/**'],
  protected: [
    { area: 'money', globs: ['app/api/checkout/**', 'lib/stripe.ts', 'app/checkout/**'] },
    { area: 'data', globs: ['lib/db.ts', '**/schema.ts', 'drizzle/**'] },
    { area: 'shared', globs: ['middleware.ts', 'app/layout.tsx'] },
  ],
}

test('globs: ** spans directories, * stays within one', () => {
  assert.ok(globToRegExp('app/api/checkout/**').test('app/api/checkout/route.ts'))
  assert.ok(globToRegExp('app/api/checkout/**').test('app/api/checkout/a/b/c.ts'))
  assert.ok(globToRegExp('**/schema.ts').test('schema.ts'))
  assert.ok(globToRegExp('**/schema.ts').test('src/db/schema.ts'))
  assert.ok(!globToRegExp('lib/*.ts').test('lib/a/b.ts'))
  assert.ok(globToRegExp('.env*').test('.env.local'))
  assert.ok(!globToRegExp('vercel.json').test('xvercel.json'))
  assert.ok(!globToRegExp('app/layout.tsx').test('app/menu/layout.tsx'))
})

test('only unprotected files → low', () => {
  const r = classify(['components/Footer.tsx', 'lib/menu-sort.ts'], rules)
  assert.equal(r.risk, 'low')
})

test('a protected area → protected, with the area named', () => {
  const r = classify(['components/Footer.tsx', 'lib/stripe.ts'], rules)
  assert.equal(r.risk, 'protected')
  assert.deepEqual(r.protectedHits.map((h) => h.area), ['money'])
})

test('forbidden beats protected', () => {
  const r = classify(['lib/stripe.ts', '.github/workflows/ci.yml'], rules)
  assert.equal(r.risk, 'forbidden')
})

test('the agent cannot edit its own rules or the deploy config', () => {
  for (const f of ['.ophir/protected.json', 'vercel.json', 'package.json', '.env.production']) {
    assert.equal(classify([f], rules).risk, 'forbidden', f)
  }
})

test('no rules file → never low (fail safe)', () => {
  assert.equal(classify(['components/Footer.tsx'], null).risk, 'protected')
})

test('no changes → empty; blank lines and duplicates ignored', () => {
  assert.equal(classify(['', '  '], rules).risk, 'empty')
  assert.deepEqual(classify(['a.ts', 'a.ts'], rules).changedFiles, ['a.ts'])
})

test('test files are recognised', () => {
  assert.ok(isTestFile('lib/menu-sort.test.ts'))
  assert.ok(isTestFile('e2e/menu.spec.tsx'))
  assert.ok(!isTestFile('lib/menu-sort.ts'))
})

test('report: bug id only from fix/<id> branches', () => {
  assert.equal(bugIdFromBranch('fix/bug-2026-10-07-AbC_9-x'), 'bug-2026-10-07-AbC_9-x')
  assert.equal(bugIdFromBranch('main'), null)
  assert.equal(bugIdFromBranch('fix/a/b'), null)
  assert.equal(bugIdFromBranch('fix/../../etc'), null)
})

test('report: signature is HMAC of timestamp.body', () => {
  const s = sign('secret', '123', '{"a":1}')
  assert.equal(s, sign('secret', '123', '{"a":1}'))
  assert.notEqual(s, sign('secret', '124', '{"a":1}'))
  assert.notEqual(s, sign('other', '123', '{"a":1}'))
  assert.match(s, /^[0-9a-f]{64}$/)
})

test('report: carries the verdict and where it came from', () => {
  const r = buildReport(
    { risk: 'low', reason: 'x', changedFiles: ['a.ts'], testFiles: ['a.test.ts'], protectedHits: [], forbiddenHits: [] },
    { GITHUB_REF_NAME: 'fix/bug-1', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '7', CI_OUTCOME: 'success' },
  )
  assert.equal(r.bugId, 'bug-1')
  assert.equal(r.ci, 'success')
  assert.equal(r.runUrl, 'https://github.com/o/r/actions/runs/7')
})
