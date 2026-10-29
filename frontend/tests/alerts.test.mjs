import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const urls = {}
for (const name of ['relativeValue', 'alerts']) {
  const code = ts
    .transpileModule(
      await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(
      /from '\.\/(\w+)'/g,
      (_, dependency) => `from '${urls[dependency]}'`,
    )
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const { evaluateAlert, validAlertRule, readAlertRules, writeAlertRules } =
  await import(urls.alerts)
const rule = {
  id: 'rule-1',
  pair: 'GOLDTEN-GOLDPETAL',
  metric: 'abs_z',
  threshold: 1.5,
  expiry: null,
}
const row = {
  trade_date: '2026-10-01',
  expiry_a: '2026-10-30',
  z: -1.5,
  spread_pct: -0.2,
  source_tradable: true,
  liquidity_ok: true,
  reason: '',
  analytics_only: false,
}
const response = (changes = {}) => ({
  data_available: true,
  data_as_of: '2026-10-01',
  configuration: { pair: rule.pair, use_purity_adjustment: false },
  series: [{ expiry_a: row.expiry_a, latest: { ...row, ...changes } }],
})

test('alert magnitude uses inclusive threshold while preserving negative observations', () => {
  const hit = evaluateAlert(rule, response())
  assert.equal(hit.status, 'triggered')
  assert.equal(hit.value, -1.5)
  assert.equal(evaluateAlert(rule, response({ z: 1.49 })).status, 'below')
  assert.equal(
    evaluateAlert(
      { ...rule, metric: 'abs_spread_pct', threshold: 0.2 },
      response(),
    ).status,
    'triggered',
  )
  assert.equal(evaluateAlert(rule, response({ z: 0 })).status, 'below')
})
test('missing, stale, nonfinite and low-quality observations never become clear or triggered alerts', () => {
  for (const changes of [
    { z: null },
    { z: NaN },
    { z: Infinity },
    { source_tradable: false },
    { liquidity_ok: false },
    { reason: 'no_bracket' },
    { trade_date: '2026-09-30' },
  ]) {
    assert.equal(evaluateAlert(rule, response(changes)).status, 'unavailable')
  }
  assert.equal(evaluateAlert(rule, undefined).status, 'unavailable')
  assert.equal(
    evaluateAlert(rule, { ...response(), data_available: false }).status,
    'unavailable',
  )
  assert.equal(
    evaluateAlert({ ...rule, expiry: '2099-01-01' }, response()).status,
    'unavailable',
  )
  assert.equal(
    evaluateAlert(rule, {
      ...response(),
      configuration: { pair: 'GOLDM-GOLDTEN', use_purity_adjustment: false },
    }).status,
    'unavailable',
  )
  assert.equal(
    evaluateAlert(rule, {
      ...response(),
      configuration: { pair: rule.pair, use_purity_adjustment: true },
    }).status,
    'unavailable',
  )
})
test('analytics-only comparisons remain labelled as non-executable', () => {
  assert.match(
    evaluateAlert(rule, response({ analytics_only: true })).reason,
    /not an executable/,
  )
})
test('rules reject malformed dates, pairs and thresholds', () => {
  assert.equal(validAlertRule(rule), true)
  for (const invalid of [
    null,
    {},
    { ...rule, threshold: 0 },
    { ...rule, threshold: Infinity },
    { ...rule, threshold: 101 },
    { ...rule, threshold: '2' },
    { ...rule, pair: 'OTHER' },
    { ...rule, expiry: '2026-02-30' },
    { ...rule, expiry: 'not-a-date' },
    { ...rule, metric: 'price' },
  ])
    assert.equal(validAlertRule(invalid), false)
})
test('browser rules survive round trip and broken stores do not overwrite previous data on read', () => {
  let raw = null
  const storage = {
    getItem: () => raw,
    setItem: (_, value) => {
      raw = value
    },
  }
  assert.deepEqual(readAlertRules(storage).rules, [])
  writeAlertRules(storage, [rule])
  assert.deepEqual(readAlertRules(storage).rules, [rule])
  raw = '{broken'
  assert.ok(readAlertRules(storage).warning)
  assert.equal(raw, '{broken')
  assert.throws(() => writeAlertRules(storage, [rule, rule]))
  assert.throws(() =>
    writeAlertRules(
      storage,
      Array.from({ length: 21 }, (_, i) => ({ ...rule, id: `rule-${i}` })),
    ),
  )
  assert.ok(
    readAlertRules({
      getItem() {
        throw Error('blocked')
      },
    }).warning,
  )
})
