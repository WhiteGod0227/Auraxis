// Local HTTP + actual client validators + rendered explanation. Not browser automation.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const urls = {}
for (const name of [
  'format',
  'relativeValue',
  'comparisonExplanation',
  'schemas',
  'api',
]) {
  const source = await readFile(
    new URL(`../src/lib/${name}.ts`, import.meta.url),
    'utf8',
  )
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(
      /from '\.\/(\w+)'/g,
      (_, imported) => `from '${urls[imported]}'`,
    )
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const require = createRequire(import.meta.url)
const componentCode = ts
  .transpileModule(
    await readFile(
      new URL('../src/components/ComparisonExplanation.tsx', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  )
  .outputText.replace(
    /from ["']@\/lib\/(\w+)["']/g,
    (_, name) => `from '${urls[name]}'`,
  )
  .replace(
    /from ["']react\/jsx-runtime["']/g,
    `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`,
  )
const { default: Component } = await import(
  'data:text/javascript;base64,' + Buffer.from(componentCode).toString('base64')
)
const { createApiClient } = await import(urls.api)
const { explainComparison } = await import(urls.comparisonExplanation)
const { maturityMatchingChange } = await import(urls.relativeValue)
const baseUrl = 'http://localhost:8010'
const preview = 'http://localhost:5173'
const snapshotBaseUrl = preview + '/snapshots/'
const manifest = await (await fetch(snapshotBaseUrl + 'manifest.json')).json()
const online = createApiClient({ baseUrl })
const offline = createApiClient({
  baseUrl,
  snapshotBaseUrl,
  fetcher: (url, options) => {
    if (String(url).startsWith(baseUrl))
      throw new TypeError('Verification transport outage')
    return fetch(url, options)
  },
})
const names = {
  '/api/meta': 'meta',
  '/api/overview': 'overview',
  '/api/prices': 'prices',
  '/api/data-health': 'dataHealth',
  '/api/spreads': 'spreads',
  '/api/curve': 'curve',
  '/api/rolldown': 'rolldown',
  '/api/backtest': 'backtest',
  '/api/coverage': 'coverage',
}
const counts = {}
for (let i = 0; i < manifest.files.length; i += 3) {
  await Promise.all(
    manifest.files.slice(i, i + 3).map(async (entry) => {
      const name = names[entry.endpoint]
      const parameters = Object.fromEntries(
        Object.entries(entry.parameters).filter(([, value]) => value !== null),
      )
      const live =
        name === 'meta' ? await online.meta() : await online[name](parameters)
      const saved =
        name === 'meta' ? await offline.meta() : await offline[name](parameters)
      assert.equal(live.source, 'API')
      assert.equal(saved.source, 'Offline snapshot')
      assert.deepEqual(saved.data, live.data)
      if (name === 'spreads') {
        for (const series of live.data.series) {
          assert.ok(series.latest.calculation)
          assert.ok(explainComparison(live.data, series.latest).length)
          const html = renderToStaticMarkup(
            createElement(Component, {
              resource: { response: live, loading: false, retry() {} },
              row: series.latest,
              counterpart: { loading: false, retry() {} },
            }),
          )
          assert.match(html, /Backend-recorded inputs/)
          assert.doesNotMatch(html, /Unavailable%/)
        }
      }
      counts[entry.endpoint] = (counts[entry.endpoint] || 0) + 1
    }),
  )
}
const pair = 'GOLDM-GOLDTEN'
const on = await online.spreads({ pair, purity: false, carry_adjusted: true })
const off = await online.spreads({ pair, purity: false, carry_adjusted: false })
const select = (value) =>
  value.data.series.find((s) => s.expiry_a === '2026-11-05').latest
const current = select(on)
const other = select(off)
console.log(
  'Real observation:',
  JSON.stringify({
    date: current.trade_date,
    pair,
    expiry: current.expiry_a,
    purity: false,
    offGap: other.spread_abs,
    onGap: current.spread_abs,
    matchingEffect: maturityMatchingChange(current, other, true),
    bWeights: current.calculation.b_weights,
    historyCount: current.calculation.preceding_finite_count,
  }),
)
assert.equal(current.calculation.a.close, other.calculation.a.close)
assert.equal(current.trade_date, other.trade_date)
await assert.rejects(
  offline.spreads({ pair, window: 11 }),
  (error) => error.kind === 'offline-unavailable',
)
await assert.rejects(
  online.curve({ product: 'INVALID' }),
  (error) => error.kind === 'http' && error.status === 422,
)
for (const route of [
  '/',
  '/app',
  '/app/relative-value',
  '/app/term-structure',
  '/app/backtest',
  '/app/data-health',
  '/app/calendar',
  '/app/methodology',
  '/login',
]) {
  const response = await fetch(preview + route)
  assert.equal(response.status, 200)
}
console.log(
  'Passed live and served-offline response equality:',
  JSON.stringify(counts),
)
console.log(
  'Passed explanation rendering, unsupported offline configuration, HTTP 422 and nine route responses. Browser layout/keyboard checks are separate.',
)
