import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

// Execute the real helpers, validator, client and component without dependencies.
const require = createRequire(import.meta.url)
const urls = {}
for (const name of [
  'format',
  'relativeValue',
  'comparisonExplanation',
  'schemas',
  'api',
]) {
  let code = ts.transpileModule(
    await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText
  code = code.replace(
    /from '\.\/(\w+)'/g,
    (_, imported) => `from '${urls[imported]}'`,
  )
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const { explainComparison } = await import(urls.comparisonExplanation)
const { parseSpreads } = await import(urls.schemas)
const { createApiClient } = await import(urls.api)
let componentCode = ts.transpileModule(
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
).outputText
componentCode = componentCode.replace(
  /from ["']@\/lib\/(\w+)["']/g,
  (_, name) => `from '${urls[name]}'`,
)
componentCode = componentCode.replace(
  /from ["']react\/jsx-runtime["']/g,
  `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`,
)
const { default: Component } = await import(
  'data:text/javascript;base64,' + Buffer.from(componentCode).toString('base64')
)

const root = new URL('../public/snapshots/', import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', root), 'utf8'),
)
const entry = manifest.files.find(
  (e) =>
    e.endpoint === '/api/spreads' &&
    e.parameters.pair === 'GOLDTEN-GOLDPETAL' &&
    e.parameters.purity === false,
)
const data = JSON.parse(await readFile(new URL(entry.path, root), 'utf8'))
const source = (symbol, close, quote_grams) => ({
  symbol,
  trade_date: '2026-10-01',
  expiry_date: '2026-10-30',
  close,
  quote_grams,
  unit_factor: 10 / quote_grams,
  purity: 999,
  purity_factor: 1,
  close_p10_raw: (close * 10) / quote_grams,
  close_p10_adjusted: (close * 10) / quote_grams,
  has_trade: true,
  volume_grams: 10000,
  open_interest_grams: 10000,
})
const row = {
  ...data.series[0].latest,
  pair: 'GOLDTEN-GOLDPETAL',
  trade_date: '2026-10-01',
  expiry_a: '2026-10-30',
  expiry_b_used: ['2026-10-30'],
  days_mismatch: [0],
  a_p10_999: 102,
  b_p10_999: 100,
  spread_abs: 2,
  spread_pct: 2,
  roll_mean: 1,
  roll_std: 0.5,
  z: 2,
  percentile: 90,
  reason: '',
  liquidity_reason: '',
  liquidity_ok: true,
  source_tradable: true,
  analytics_only: false,
  executable_pair: true,
  comparison_type: 'same_expiry',
  calculation: {
    a: source('GOLDTEN', 102, 10),
    b_components: [source('GOLDPETAL', 10, 1)],
    b_weights: [1],
    preceding_finite_count: 5,
    statistics_status: 'ok',
  },
}
const payload = {
  ...data,
  configuration: {
    ...data.configuration,
    pair: row.pair,
    use_purity_adjustment: false,
  },
  series: [
    {
      expiry_a: row.expiry_a,
      rows: [row],
      latest: row,
      description: 'Synthetic test observation',
    },
  ],
}
const ready = (value, origin = 'API') => ({
  response: { data: value, source: origin },
  loading: false,
  retry() {},
})
const render = (
  resource = ready(payload),
  current = row,
  counterpart = ready(null),
  counterpartRow,
) =>
  renderToStaticMarkup(
    createElement(Component, {
      resource,
      row: current,
      counterpart,
      counterpartRow,
    }),
  )

test('explanation uses actual response values and does not claim a trade opportunity', () => {
  const text = explainComparison(payload, row).join(' ')
  assert.match(text, /higher/)
  assert.match(text, /2 sample standard deviations above/)
  assert.match(text, /90 out of 100/)
  assert.match(text, /not a forecast probability/)
  assert.match(text, /Lower does not mean undervalued/)
  assert.match(text, /Purity adjustment is off/)
  assert.match(
    explainComparison(payload, { ...row, spread_abs: -2 }).join(' '),
    /lower/,
  )
  assert.match(
    explainComparison(
      {
        ...payload,
        configuration: {
          ...payload.configuration,
          use_purity_adjustment: true,
        },
      },
      row,
    ).join(' '),
    /experimental/,
  )
})

test('missing brackets, no trade, thin liquidity and unknown diagnostics remain distinct', () => {
  for (const [reason, expected] of [
    ['no_bracket', /brackets are missing/],
    ['leg_no_trade', /no recorded trade/],
    ['thin_volume', /volume threshold/],
    ['thin_oi', /open-interest threshold/],
    ['future_reason', /future_reason/],
  ]) {
    assert.match(
      explainComparison(payload, { ...row, reason, liquidity_ok: false }).join(
        ' ',
      ),
      expected,
    )
  }
})

test('statistical unavailability distinguishes insufficient history, zero variance and missing current spread', () => {
  for (const [status, expected] of [
    ['insufficient_history', /5 preceding finite/],
    ['zero_variance', /zero variance/],
    ['missing_current_spread', /current percentage spread is missing/],
    ['undefined_variance', /standard deviation is undefined/],
  ]) {
    const text = explainComparison(payload, {
      ...row,
      z: null,
      calculation: { ...row.calculation, statistics_status: status },
    }).join(' ')
    assert.match(text, expected)
  }
  assert.match(
    explainComparison(payload, {
      ...row,
      z: null,
      calculation: undefined,
    }).join(' '),
    /does not identify an exact/,
  )
})

test('loading and failed states cannot retain previous explanation or calculation inputs', () => {
  for (const resource of [
    { loading: true, retry() {} },
    { loading: false, error: 'Temporary failure', retry() {} },
  ]) {
    const html = render(resource, undefined)
    assert.doesNotMatch(
      html,
      /A&#x27;s normalized settlement|Inputs for|Calculation source observations/,
    )
    assert.match(html, /Loading this comparison|Temporary failure/)
  }
  assert.match(
    render(ready({ ...payload, series: [] }), null),
    /no observation exists/,
  )
})

test('legacy offline results remain supported without fabricating calculation inputs', () => {
  const legacy = structuredClone(payload)
  delete legacy.series[0].rows[0].calculation
  delete legacy.series[0].latest.calculation
  assert.deepEqual(parseSpreads(legacy), legacy)
  const html = render(
    ready(legacy, 'Offline snapshot'),
    legacy.series[0].latest,
  )
  assert.match(html, /Offline snapshot/)
  assert.match(html, /Calculation inputs are unavailable/)
  assert.match(html, /missing inputs have not been inferred/)
  assert.doesNotMatch(html, /Calculation source observations/)
})

test('calculation panel preserves source observations, precision, zero-volume flags and unavailable percentages', () => {
  const html = render()
  assert.match(html, /Calculation source observations/)
  assert.match(html, /actual preceding count 5/)
  const missing = {
    ...row,
    spread_pct: null,
    calculation: {
      ...row.calculation,
      a: { ...row.calculation.a, has_trade: false, volume_grams: 0 },
    },
  }
  const unavailable = render(ready(payload), missing)
  assert.match(unavailable, /No recorded trade/)
  assert.doesNotMatch(unavailable, /Unavailable%/)
})

test('maturity effect requires the same observation and source and never reuses missing/stale counterparts', () => {
  const cross = {
    ...row,
    pair: 'GOLDM-GOLDTEN',
    analytics_only: true,
    comparison_type: 'interpolated_maturity',
  }
  const crossData = {
    ...payload,
    configuration: { ...payload.configuration, pair: cross.pair },
  }
  const other = { ...cross, spread_abs: -3 }
  const good = render(ready(crossData), cross, ready(crossData), other)
  assert.match(good, /on minus off/)
  for (const candidate of [
    { ...other, trade_date: '2026-09-30' },
    { ...other, expiry_a: '2026-11-05' },
    { ...other, a_p10_999: 200 },
    { ...other, spread_abs: null },
  ]) {
    assert.match(
      render(ready(crossData), cross, ready(crossData), candidate),
      /Unavailable for this exact observation and source/,
    )
  }
  assert.match(
    render(
      ready(crossData),
      cross,
      ready(crossData, 'Offline snapshot'),
      other,
    ),
    /Unavailable for this exact observation and source/,
  )
})

test('validator rejects malformed/nonfinite or mismatched traces without breaking legacy payloads', () => {
  assert.deepEqual(parseSpreads(payload), payload)
  for (const change of [
    { preceding_finite_count: -1 },
    { preceding_finite_count: 1.5 },
    { b_weights: [NaN] },
    { a: { ...row.calculation.a, trade_date: '2026-09-30' } },
    { b_components: [] },
  ]) {
    const invalid = structuredClone(payload)
    invalid.series[0].latest.calculation = { ...row.calculation, ...change }
    assert.throws(() => parseSpreads(invalid))
  }
})

test('client rejects an API response for the wrong pair, purity, window or maturity mode', async () => {
  for (const change of [
    { pair: 'GOLDM-GOLDTEN' },
    { use_purity_adjustment: true },
    { window: 11 },
    { carry_adjusted: false },
  ]) {
    const client = createApiClient({
      baseUrl: 'http://test',
      fetcher: async () =>
        Response.json({
          ...payload,
          configuration: { ...payload.configuration, ...change },
        }),
    })
    await assert.rejects(
      client.spreads({ pair: row.pair }),
      (error) => error.kind === 'invalid-response',
    )
  }
})
