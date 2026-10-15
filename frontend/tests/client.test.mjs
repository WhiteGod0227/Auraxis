import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Compile the actual client with the installed TypeScript compiler, without a
// test runner dependency or changing production compiler settings.
const folder = await mkdtemp(join(tmpdir(), 'auraxis-client-test-'))
for (const name of [
  'api',
  'schemas',
  'chart',
  'relativeValue',
  'termStructure',
  'backtest',
  'dataHealth',
  'landing',
]) {
  const source = await readFile(
    new URL(`../src/lib/${name}.ts`, import.meta.url),
    'utf8',
  )
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'")
  await writeFile(join(folder, `${name}.mjs`), compiled)
}
const { createApiClient, ClientError, canonicalParameters } = await import(
  pathToFileURL(join(folder, 'api.mjs')).href
)
const { parseMeta, parseOverview, parsePrices, parseDataHealth } = await import(
  pathToFileURL(join(folder, 'schemas.mjs')).href
)
const { referenceChartRows } = await import(
  pathToFileURL(join(folder, 'chart.mjs')).href
)
const root = new URL('../public/snapshots/', import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', root), 'utf8'),
)
const defaultMeta = manifest.files.find((e) => e.endpoint === '/api/meta')
const meta = JSON.parse(await readFile(new URL(defaultMeta.path, root), 'utf8'))
const calls = []
function offlineFetcher(transform) {
  return async (url, options) => {
    calls.push(String(url))
    if (String(url).startsWith('http://api'))
      throw new TypeError('Network unavailable')
    if (options?.signal?.aborted)
      throw new DOMException('Cancelled', 'AbortError')
    const name = String(url).replace('/snapshots/', '')
    let bytes = await readFile(new URL(name, root))
    if (transform) bytes = transform(name, bytes)
    return new Response(bytes, {
      headers: { 'content-type': 'application/json' },
    })
  }
}
function offline(transform) {
  return createApiClient({
    baseUrl: 'http://api',
    snapshotBaseUrl: '/snapshots/',
    fetcher: offlineFetcher(transform),
  })
}
const isKind = (kind) => (e) => e instanceof ClientError && e.kind === kind

test('all Step 9A snapshots match schemas and exact defaults', async () => {
  const client = offline()
  for (const [endpoint, validator] of [
    ['/api/meta', parseMeta],
    ['/api/overview', parseOverview],
    ['/api/prices', parsePrices],
    ['/api/data-health', parseDataHealth],
  ]) {
    const result = await client.request(endpoint, {}, validator)
    assert.equal(result.source, 'Offline snapshot')
    assert.equal(result.data.data_as_of, manifest.data_as_of)
    assert.equal(result.generatedAt, manifest.generated_at_utc)
  }
})
test('unsupported custom purity/product/volume/window never relabel defaults', async () => {
  const client = offline()
  await assert.rejects(
    client.overview({ purity: true }),
    isKind('offline-unavailable'),
  )
  await assert.rejects(
    client.prices({ product: 'GOLDTEN' }),
    isKind('offline-unavailable'),
  )
  await assert.rejects(
    client.dataHealth({ min_volume_grams: 2001 }),
    isKind('offline-unavailable'),
  )
  await assert.rejects(
    client.request(
      '/api/spreads',
      { pair: 'GOLDTEN-GOLDPETAL', window: 12 },
      (v) => v,
    ),
    isKind('offline-unavailable'),
  )
})
test('analytics mechanism distinguishes purity and carry exactly', async () => {
  const client = offline()
  for (const purity of [true, false])
    for (const carry_adjusted of [true, false]) {
      const result = await client.request(
        '/api/spreads',
        { pair: 'GOLDM-GOLDTEN', purity, carry_adjusted },
        (v) => {
          assert.ok(v.series)
          return v
        },
      )
      assert.equal(result.data.configuration.use_purity_adjustment, purity)
      assert.equal(result.data.configuration.carry_adjusted, carry_adjusted)
      assert.ok(
        result.data.series.every(
          (s) => s.latest.analytics_only && !s.latest.executable_pair,
        ),
      )
    }
})
for (const status of [422, 500])
  test(`HTTP ${status} is never replaced with snapshots`, async () => {
    let requested = 0
    const client = createApiClient({
      fetcher: async () => {
        requested++
        return new Response('{}', { status })
      },
    })
    await assert.rejects(
      client.meta(),
      (e) => isKind('http')(e) && e.status === status,
    )
    assert.equal(requested, 1)
  })
for (const body of [
  'not JSON',
  '{}',
  JSON.stringify({ ...meta, trading_session_count: '14' }),
])
  test(`malformed API body ${body.slice(0, 12)} has no fallback`, async () => {
    let requested = 0
    const client = createApiClient({
      fetcher: async () => {
        requested++
        return new Response(body)
      },
    })
    await assert.rejects(client.meta(), isKind('invalid-response'))
    assert.equal(requested, 1)
  })
test('successful API source is distinct from historical date', async () => {
  const client = createApiClient({
    fetcher: async () => new Response(JSON.stringify(meta)),
  })
  const result = await client.meta()
  assert.equal(result.source, 'API')
  assert.equal(result.data.data_as_of, '2026-10-01')
})
test('timeout falls back once to the exact verified snapshot', async () => {
  const fallback = offlineFetcher()
  const client = createApiClient({
    baseUrl: 'http://api',
    snapshotBaseUrl: '/snapshots/',
    timeoutMs: 10,
    fetcher: (url, options) => {
      if (String(url).startsWith('http://api'))
        return new Promise((_, reject) =>
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Timeout', 'AbortError')),
            { once: true },
          ),
        )
      return fallback(url, options)
    },
  })
  assert.equal((await client.meta()).source, 'Offline snapshot')
})
test('external cancellation never falls back', async () => {
  let requested = 0
  const controller = new AbortController()
  const client = createApiClient({
    fetcher: (_, options) => {
      requested++
      return new Promise((_, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        ),
      )
    },
  })
  const promise = client.meta(controller.signal)
  controller.abort()
  await assert.rejects(promise, isKind('cancelled'))
  assert.equal(requested, 1)
})
for (const change of [
  (m) => ({ ...m, snapshot_schema_version: 99 }),
  (m) => ({
    ...m,
    files: m.files.map((e, i) => (i ? e : { ...e, path: '../private.json' })),
  }),
  (m) => ({ ...m, supported_offline_configurations: [] }),
])
  test('invalid manifest rejected before any snapshot fetch', async () => {
    const client = offline((name, bytes) =>
      name === 'manifest.json'
        ? Buffer.from(JSON.stringify(change(manifest)))
        : bytes,
    )
    await assert.rejects(client.meta(), isKind('manifest'))
  })
test('corrupt snapshot checksum is rejected', async () => {
  const client = offline((name, bytes) =>
    name === 'manifest.json' ? bytes : Buffer.from('{}'),
  )
  await assert.rejects(client.meta(), isKind('snapshot'))
})

test('HTML app shells returned with HTTP 200 never become successful offline data', async () => {
  const html = Buffer.from(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  )
  for (const broken of ['manifest.json', defaultMeta.path]) {
    const client = offline((name, bytes) => (name === broken ? html : bytes))
    await assert.rejects(
      client.meta(),
      isKind(broken === 'manifest.json' ? 'manifest' : 'snapshot'),
    )
  }
})

test('API recovery replaces an offline source on the next request', async () => {
  let recovered = false
  const fallback = offlineFetcher()
  const client = createApiClient({
    baseUrl: 'http://api',
    snapshotBaseUrl: '/snapshots/',
    fetcher: (url, options) =>
      recovered && String(url).startsWith('http://api')
        ? Promise.resolve(new Response(JSON.stringify(meta)))
        : fallback(url, options),
  })
  assert.equal((await client.meta()).source, 'Offline snapshot')
  recovered = true
  assert.equal((await client.meta()).source, 'API')
})
test('missing manifest and snapshot report typed clear failures', async () => {
  const fallback = offlineFetcher()
  for (const broken of ['manifest.json', defaultMeta.path]) {
    const client = createApiClient({
      baseUrl: 'http://api',
      snapshotBaseUrl: '/snapshots/',
      fetcher: (url, options) =>
        String(url) === `/snapshots/${broken}`
          ? Promise.resolve(new Response('missing', { status: 404 }))
          : fallback(url, options),
    })
    await assert.rejects(
      client.meta(),
      isKind(broken === 'manifest.json' ? 'manifest' : 'snapshot'),
    )
  }
})
test('canonical nulls, booleans and date formats remain exact', () => {
  assert.deepEqual(canonicalParameters('/api/prices'), {
    product: null,
    purity: false,
  })
  assert.equal(
    canonicalParameters('/api/spreads', {
      pair: 'GOLDM-GOLDTEN',
      carry_adjusted: false,
    }).carry_adjusted,
    false,
  )
  assert.throws(
    () => canonicalParameters('/api/overview', { purity: 'true' }),
    isKind('parameters'),
  )
  assert.throws(
    () =>
      canonicalParameters('/api/curve', {
        product: 'GOLDTEN',
        date: '2026-02-30',
      }),
    isKind('parameters'),
  )
  assert.throws(
    () => canonicalParameters('/api/meta', { fake: true }),
    isKind('parameters'),
  )
})
test('chart keeps gaps and never mutates original untraded/null/zero data', () => {
  const series = [
    {
      product: 'GOLDTEN',
      expiry_date: '2026-10-30',
      history: [
        { trade_date: '2026-10-01', has_trade: true, close_p10_999: 100 },
        { trade_date: '2026-10-02', has_trade: false, close_p10_999: 200 },
        { trade_date: '2026-10-05', has_trade: true, close_p10_999: null },
        { trade_date: '2026-10-06', has_trade: true, close_p10_999: 0 },
      ],
    },
  ]
  const original = structuredClone(series)
  assert.deepEqual(
    referenceChartRows(series).map((row) => row.price0),
    [100, null, null, 0],
  )
  assert.deepEqual(series, original)
})

const { selectExpiry, spreadChartRows, currentResource } = await import(
  pathToFileURL(join(folder, 'relativeValue.mjs')).href
)
const { parseSpreads } = await import(
  pathToFileURL(join(folder, 'schemas.mjs')).href
)
test('spread bands require finite mean and standard deviation, preserve gaps and expiry groups', () => {
  const row = {
    trade_date: '2026-10-01',
    spread_pct: null,
    roll_mean: 2,
    roll_std: 0.5,
  }
  const group = {
    expiry_a: '2026-10-30',
    rows: [row, { ...row, roll_std: null }, { ...row, roll_mean: NaN }],
  }
  const result = spreadChartRows(group)
  assert.deepEqual(
    result.map((r) => r.band),
    [[1, 3], null, null],
  )
  assert.equal(result[0].spread_pct, null)
  assert.deepEqual(spreadChartRows({ expiry_a: '2026-11-30', rows: [] }), [])
  assert.equal(group.rows[0], row)
})
test('expiry selection uses historical as-of plus three calendar days and preserves a valid choice', () => {
  const series = ['2026-10-02', '2026-11-30', '2026-10-05'].map((expiry_a) => ({
    expiry_a,
  }))
  assert.equal(selectExpiry(series, '2026-10-01'), '2026-10-05')
  assert.equal(selectExpiry(series, '2026-10-01', '2026-11-30'), '2026-11-30')
  assert.equal(selectExpiry(series, '2027-01-01'), '2026-11-30')
  assert.equal(selectExpiry([], null), undefined)
})
test('changing request identity hides stale results synchronously', () => {
  const first = () => {}
  const second = () => {}
  const data = { pair: 'old' }
  assert.equal(currentResource(first, second, data), undefined)
  assert.equal(currentResource(first, first, data), data)
})
test('typed spreads validate all supported default purity and carry snapshots', async () => {
  for (const entry of manifest.files.filter(
    (e) => e.endpoint === '/api/spreads',
  )) {
    const { pair, purity, carry_adjusted } = entry.parameters
    const result = await offline().spreads({ pair, purity, carry_adjusted })
    assert.equal(result.source, 'Offline snapshot')
    assert.equal(result.data.configuration.pair, pair)
    assert.equal(result.data.configuration.use_purity_adjustment, purity)
    assert.equal(result.data.configuration.carry_adjusted, carry_adjusted)
    assert.deepEqual(parseSpreads(result.data), result.data)
  }
  await assert.rejects(
    offline().spreads({ pair: 'GOLDTEN-GOLDPETAL', window: 11 }),
    isKind('offline-unavailable'),
  )
})

const {
  curveChartRows,
  availableCurveDates,
  selectContractExpiry,
  rolldownChartRows,
  expiryDiagnostics,
  latestRolldown,
  reconciliation,
} = await import(pathToFileURL(join(folder, 'termStructure.mjs')).href)
const { parseCurve, parseRolldown } = await import(
  pathToFileURL(join(folder, 'schemas.mjs')).href
)
const goldtenCurveEntry = manifest.files.find(
  (e) =>
    e.endpoint === '/api/curve' &&
    e.parameters.product === 'GOLDTEN' &&
    !e.parameters.purity,
)
const goldtenRollEntry = manifest.files.find(
  (e) =>
    e.endpoint === '/api/rolldown' &&
    e.parameters.product === 'GOLDTEN' &&
    !e.parameters.purity,
)
const goldtenCurve = JSON.parse(
  await readFile(new URL(goldtenCurveEntry.path, root), 'utf8'),
)
const goldtenRoll = JSON.parse(
  await readFile(new URL(goldtenRollEntry.path, root), 'utf8'),
)
test('numeric curve spacing retains missing/untraded observations as traded-line gaps', () => {
  const p = goldtenCurve.points[0]
  const points = [
    {
      ...p,
      expiry_date: '2026-11-30',
      days_to_expiry: 60,
      has_trade: false,
      close_p10_999: 123,
    },
    { ...p, days_to_expiry: 9, has_trade: true },
    { ...p, days_to_expiry: 100, close_p10_999: null },
    { ...p, days_to_expiry: 10, has_trade: true },
  ]
  const rows = curveChartRows(points)
  assert.deepEqual(
    rows.map((r) => r.days_to_expiry),
    [9, 10, 60, 100],
  )
  assert.equal(rows[2].traded_price, null)
  assert.equal(rows[2].untraded_price, 123)
  assert.equal(rows[3].traded_price, null)
  assert.equal(rows[3].untraded_price, null)
  assert.equal(points[0].days_to_expiry, 60)
})
test('invalid decomposition preserves calculable raw change but never invents residuals', () => {
  const source = goldtenRoll.series[0].rows[0]
  const result = rolldownChartRows({
    expiry_date: source.expiry_date,
    rows: [
      {
        ...source,
        raw_change: null,
        estimated_roll_down: null,
        residual_change: null,
      },
      {
        ...source,
        trade_date: '2026-10-01',
        decomposition_valid: false,
        raw_change: 0,
        estimated_roll_down: 99,
        residual_change: 99,
      },
    ],
  })
  assert.equal(result[0].raw_change, null)
  assert.equal(result[1].raw_change, 0)
  assert.equal(result[1].estimated_roll_down, null)
  assert.equal(result[1].residual_change, null)
})
test('selected-expiry diagnostic counts retain arbitrary reasons and latest invalid observations', () => {
  const series = goldtenRoll.series.find((s) => s.expiry_date === '2026-09-30')
  const counts = expiryDiagnostics(series)
  assert.deepEqual(counts, {
    total: 13,
    valid: 12,
    invalid: 1,
    reasons: { missing_observation: 1 },
  })
  assert.equal(
    latestRolldown({ ...series, rows: [...series.rows].reverse() }).reason,
    'missing_observation',
  )
  const custom = {
    ...series,
    rows: [
      {
        ...series.rows[0],
        decomposition_valid: false,
        reason: 'future_reason',
      },
      {
        ...series.rows[1],
        decomposition_valid: false,
        reason: 'future_reason',
      },
    ],
  }
  assert.equal(expiryDiagnostics(custom).reasons.future_reason, 2)
  assert.equal(reconciliation(latestRolldown(series)), null)
})
test('product dates and expiry defaults use real historical observations', () => {
  const dates = availableCurveDates(goldtenCurve, goldtenRoll)
  assert.equal(dates.length, 14)
  assert.equal(dates[0], '2026-09-14')
  assert.equal(dates.at(-1), '2026-10-01')
  assert.ok(!dates.includes('2026-09-19'))
  const expiries = goldtenRoll.series.map((s) => s.expiry_date)
  assert.equal(
    selectContractExpiry(expiries, goldtenRoll.data_as_of),
    '2026-10-30',
  )
  assert.equal(
    selectContractExpiry(expiries, goldtenRoll.data_as_of, '2026-09-30'),
    '2026-09-30',
  )
  assert.equal(selectContractExpiry(expiries, '2027-12-01'), '2027-03-31')
  assert.equal(selectContractExpiry([], null), undefined)
  assert.deepEqual(availableCurveDates(undefined, undefined), [])
})
test('real October decomposition reconciles at full precision without adjusting API values', () => {
  const series = goldtenRoll.series.find((s) => s.expiry_date === '2026-10-30')
  const row = latestRolldown(series)
  assert.equal(row.trade_date, '2026-10-01')
  assert.equal(row.raw_change, 1114)
  assert.ok(Math.abs(row.estimated_roll_down - -42.61290322580645) < 1e-10)
  assert.ok(Math.abs(row.residual_change - 1156.6129032258063) < 1e-10)
  assert.equal(reconciliation(row).reconciles, true)
  assert.equal(reconciliation({ ...row, residual_change: 0 }).reconciles, false)
})
test('all curve and roll-down product/purity snapshots validate with exact configurations', async () => {
  const client = offline()
  for (const e of manifest.files.filter((e) =>
    ['/api/curve', '/api/rolldown'].includes(e.endpoint),
  )) {
    const { product, purity } = e.parameters
    const response =
      e.endpoint === '/api/curve'
        ? await client.curve({ product, purity })
        : await client.rolldown({ product, purity })
    assert.equal(response.source, 'Offline snapshot')
    assert.equal(response.data.configuration.product, product)
    assert.equal(response.data.configuration.use_purity_adjustment, purity)
    assert.deepEqual(
      e.endpoint === '/api/curve'
        ? parseCurve(response.data)
        : parseRolldown(response.data),
      response.data,
    )
  }
})
test('historical dates cannot receive latest saved curves, even when date equals saved latest', async () => {
  const client = offline()
  for (const date of ['2026-09-30', '2026-10-01'])
    await assert.rejects(
      client.curve({ product: 'GOLDTEN', date }),
      isKind('offline-unavailable'),
    )
})
test('mismatched API date or product is an error, not a silently relabelled curve', async () => {
  const client = createApiClient({
    baseUrl: 'http://api',
    fetcher: async () => Response.json(goldtenCurve),
  })
  await assert.rejects(
    client.curve({ product: 'GOLDTEN', date: '2026-09-30' }),
    isKind('invalid-response'),
  )
  await assert.rejects(
    client.curve({ product: 'GOLDM' }),
    isKind('invalid-response'),
  )
  await assert.rejects(
    client.curve({ product: 'GOLDTEN', purity: true }),
    isKind('invalid-response'),
  )
})
test('curve and roll-down keep HTTP errors, malformed and empty results honest', async () => {
  for (const status of [422, 500]) {
    const client = createApiClient({
      fetcher: async () => new Response('{}', { status }),
    })
    await assert.rejects(client.curve({ product: 'GOLDTEN' }), isKind('http'))
    await assert.rejects(
      client.rolldown({ product: 'GOLDTEN' }),
      isKind('http'),
    )
  }
  const malformed = createApiClient({ fetcher: async () => Response.json({}) })
  await assert.rejects(
    malformed.rolldown({ product: 'GOLDTEN' }),
    isKind('invalid-response'),
  )
  const empty = {
    ...goldtenCurve,
    selected_date: null,
    points: [],
    data_available: false,
    message: 'No matching observations',
  }
  const client = createApiClient({ fetcher: async () => Response.json(empty) })
  assert.deepEqual((await client.curve({ product: 'GOLDTEN' })).data.points, [])
  const emptyRoll = {
    ...goldtenRoll,
    series: [],
    valid_count: 0,
    invalid_count: 0,
    data_available: false,
    message: 'No matching observations',
  }
  const emptyRollClient = createApiClient({
    fetcher: async () => Response.json(emptyRoll),
  })
  assert.deepEqual(
    (await emptyRollClient.rolldown({ product: 'GOLDTEN' })).data.series,
    [],
  )
})

test('cancelled old product responses cannot replace a newer selection even if fetch ignores abort', async () => {
  const goldmEntry = manifest.files.find(
    (e) =>
      e.endpoint === '/api/curve' &&
      e.parameters.product === 'GOLDM' &&
      !e.parameters.purity,
  )
  const goldm = JSON.parse(
    await readFile(new URL(goldmEntry.path, root), 'utf8'),
  )
  const pending = []
  const client = createApiClient({
    fetcher: () => new Promise((resolve) => pending.push(resolve)),
  })
  const oldController = new AbortController()
  const old = client.curve({ product: 'GOLDTEN' }, oldController.signal)
  const rejected = assert.rejects(old, isKind('cancelled'))
  const current = client.curve({ product: 'GOLDM' })
  oldController.abort()
  pending[1](Response.json(goldm))
  assert.equal((await current).data.configuration.product, 'GOLDM')
  pending[0](Response.json(goldtenCurve))
  await rejected
  const oldLoad = () => {}
  const newLoad = () => {}
  assert.equal(
    currentResource(oldLoad, newLoad, { data: goldtenCurve }),
    undefined,
  )
})

const {
  defaultDraft,
  validateDraft,
  draftParameters,
  hasDraftChanges,
  savedDefaults,
  selectBacktestExpiry,
  completedMetrics,
  costToleranceMessage,
  equityChartRows,
  outstandingCategories,
  legDirection,
} = await import(pathToFileURL(join(folder, 'backtest.mjs')).href)
const { parseBacktest } = await import(
  pathToFileURL(join(folder, 'schemas.mjs')).href
)
const defaultBacktestEntry = manifest.files.find(
  (e) =>
    e.endpoint === '/api/backtest' &&
    e.parameters.pair === 'GOLDTEN-GOLDPETAL' &&
    !e.parameters.purity,
)
const defaultBacktest = JSON.parse(
  await readFile(new URL(defaultBacktestEntry.path, root), 'utf8'),
)
const guineaBacktestEntry = manifest.files.find(
  (e) =>
    e.endpoint === '/api/backtest' &&
    e.parameters.pair === 'GOLDTEN-GOLDGUINEA' &&
    !e.parameters.purity,
)
const guineaBacktest = JSON.parse(
  await readFile(new URL(guineaBacktestEntry.path, root), 'utf8'),
)
const octoberBacktest = defaultBacktest.reports.find(
  (r) => r.expiry === '2026-10-30',
)
test('backtest draft edits cannot relabel applied parameters and saved defaults preserve pair/purity', () => {
  const applied = { ...defaultDraft }
  const draft = { ...applied, z_entry: 2, cost_bps_per_leg_per_side: 20 }
  assert.equal(hasDraftChanges(draft, applied), true)
  assert.equal(applied.z_entry, 1)
  assert.equal(applied.cost_bps_per_leg_per_side, 5)
  assert.equal(draftParameters(draft).z_entry, 2)
  const restored = savedDefaults({
    ...draft,
    pair: 'GOLDTEN-GOLDGUINEA',
    purity: false,
  })
  assert.deepEqual(restored, {
    ...defaultDraft,
    pair: 'GOLDTEN-GOLDGUINEA',
    purity: false,
  })
  assert.equal(hasDraftChanges(restored, { ...restored }), false)
})
test('backtest validates z_exit strictly below z_entry and all supported ranges/steps', () => {
  assert.equal(validateDraft({ ...defaultDraft }), undefined)
  assert.match(
    validateDraft({ ...defaultDraft, z_entry: 0.5, z_exit: 0.5 }),
    /less than/,
  )
  assert.match(
    validateDraft({ ...defaultDraft, z_entry: 0.5, z_exit: 1 }),
    /less than/,
  )
  assert.equal(
    validateDraft({
      ...defaultDraft,
      z_exit: 0,
      cost_bps_per_leg_per_side: 0,
      min_volume_grams: 0,
      max_hold_sessions: 1,
    }),
    undefined,
  )
  assert.match(validateDraft({ ...defaultDraft, z_entry: 0.6 }), /steps/)
  assert.match(validateDraft({ ...defaultDraft, z_entry: NaN }), /z_entry/)
  assert.match(
    validateDraft({ ...defaultDraft, pair: 'GOLDM-GOLDTEN' }),
    /supported/,
  )
})
test('backtest expiry selection stays independent and uses historical date', () => {
  assert.equal(
    selectBacktestExpiry(defaultBacktest.reports, '2026-10-01'),
    '2026-10-30',
  )
  assert.equal(
    selectBacktestExpiry(defaultBacktest.reports, '2026-10-01', '2026-09-30'),
    '2026-09-30',
  )
  assert.equal(
    selectBacktestExpiry(defaultBacktest.reports, '2028-01-01'),
    '2027-03-31',
  )
  assert.equal(selectBacktestExpiry([], null), undefined)
  assert.ok(
    Math.abs(
      defaultBacktest.reports.find((r) => r.expiry === '2026-09-30').metrics
        .realized_net_pnl + 3089.75,
    ) < 0.01,
  )
})
test('zero completed trades leave win rate and holding unavailable; valuation gaps remain null', () => {
  const metrics = completedMetrics(octoberBacktest)
  assert.equal(metrics.winRate, null)
  assert.equal(metrics.averageHolding, null)
  assert.equal(metrics.reason, 'no_completed_trades')
  assert.equal(
    completedMetrics({
      ...octoberBacktest,
      metrics: {
        ...octoberBacktest.metrics,
        win_rate: 0,
        average_holding_sessions: 0,
      },
    }).winRate,
    null,
  )
  const row = octoberBacktest.equity_curve[0]
  const rows = equityChartRows({
    ...octoberBacktest,
    equity_curve: [
      { ...row, cumulative_gross_pnl: null, cumulative_net_pnl: null },
      {
        ...row,
        valuation_quality: 'unavailable',
        cumulative_gross_pnl: 12,
        cumulative_net_pnl: 10,
      },
      { ...row, cumulative_gross_pnl: 0, cumulative_net_pnl: 0 },
    ],
  })
  assert.deepEqual(
    rows.map((r) => r.cumulative_net_pnl),
    [null, null, 0],
  )
  assert.equal(rows[1].cumulative_gross_pnl, null)
})
test('open and unresolved positions retain distinct categories, identities and quality', () => {
  const unresolved = guineaBacktest.reports.find(
    (r) => r.expiry === '2026-09-30',
  )
  const opened = guineaBacktest.reports.find((r) => r.expiry === '2026-10-30')
  assert.equal(outstandingCategories(unresolved).open.length, 0)
  assert.equal(
    outstandingCategories(unresolved).unresolved[0].status,
    'unresolved_expiry',
  )
  assert.equal(
    outstandingCategories(unresolved).unresolved[0].mark_quality_a,
    'stale_expired',
  )
  assert.equal(outstandingCategories(opened).open[0].status, 'open')
  assert.equal(outstandingCategories(opened).unresolved.length, 0)
  assert.equal(
    legDirection('long_a_short_b', 'GOLDTEN-GOLDGUINEA'),
    'Long GOLDTEN / short GOLDGUINEA',
  )
})
test('cost tolerance preserves no-trade/nonpositive/range-capped and unknown reasons', () => {
  const t = octoberBacktest.cost_tolerance
  assert.match(costToleranceMessage(t), /no_completed_trades/)
  assert.match(
    costToleranceMessage({ ...t, reason: 'nonpositive_gross_pnl' }),
    /including zero cost/,
  )
  assert.equal(
    costToleranceMessage({
      ...t,
      reason: '',
      range_capped: true,
      highest_profitable_tested_bps: 50,
    }),
    'Still positive at 50 bps; tolerance beyond tested range is unknown.',
  )
  assert.match(
    costToleranceMessage({ ...t, reason: 'invalid_trade_data' }),
    /invalid_trade_data/,
  )
  assert.match(
    costToleranceMessage({
      ...t,
      reason: '',
      highest_profitable_tested_bps: 0,
    }),
    /^0 bps/,
  )
})
test('all six default backtest pair/purity snapshots validate without dropping reports/positions', async () => {
  for (const e of manifest.files.filter(
    (e) => e.endpoint === '/api/backtest',
  )) {
    const { pair, purity } = e.parameters
    const result = await offline().backtest({ pair, purity })
    assert.equal(result.source, 'Offline snapshot')
    assert.equal(result.data.configuration.use_purity_adjustment, purity)
    assert.deepEqual(parseBacktest(result.data), result.data)
    assert.equal(result.data.reports.length, 7)
  }
  for (const custom of [
    { z_entry: 2 },
    { z_exit: 0 },
    { cost_bps_per_leg_per_side: 6 },
    { min_volume_grams: 2500 },
    { max_hold_sessions: 6 },
  ])
    await assert.rejects(
      offline().backtest({ pair: 'GOLDTEN-GOLDPETAL', ...custom }),
      isKind('offline-unavailable'),
    )
})
test('backtest schemas reject swapped outstanding categories, wrong applied settings and HTTP errors', async () => {
  const bad = structuredClone(guineaBacktest)
  bad.reports.find((r) => r.expiry === '2026-09-30').open_positions =
    bad.reports.find((r) => r.expiry === '2026-09-30').unresolved_positions
  assert.throws(() => parseBacktest(bad))
  const client = createApiClient({
    fetcher: async () => Response.json(defaultBacktest),
  })
  await assert.rejects(
    client.backtest({ pair: 'GOLDTEN-GOLDPETAL', z_entry: 2 }),
    isKind('invalid-response'),
  )
  for (const status of [422, 500])
    await assert.rejects(
      createApiClient({
        fetcher: async () => new Response('{}', { status }),
      }).backtest({ pair: 'GOLDTEN-GOLDPETAL' }),
      isKind('http'),
    )
  const empty = {
    ...defaultBacktest,
    reports: [],
    data_available: false,
    message: 'No matching observations',
  }
  assert.deepEqual(
    (
      await createApiClient({
        fetcher: async () => Response.json(empty),
      }).backtest({ pair: 'GOLDTEN-GOLDPETAL' })
    ).data.reports,
    [],
  )
})
test('late prior backtest submissions cannot replace a newer request even if fetch ignores abort', async () => {
  const pending = []
  const client = createApiClient({
    fetcher: () => new Promise((resolve) => pending.push(resolve)),
  })
  const controller = new AbortController()
  const old = client.backtest({ pair: 'GOLDTEN-GOLDPETAL' }, controller.signal)
  const rejected = assert.rejects(old, isKind('cancelled'))
  const current = client.backtest({ pair: 'GOLDTEN-GOLDGUINEA' })
  controller.abort()
  pending[1](Response.json(guineaBacktest))
  assert.equal((await current).data.configuration.pair, 'GOLDTEN-GOLDGUINEA')
  pending[0](Response.json(defaultBacktest))
  await rejected
})

const {
  diagnosticState,
  healthCounts,
  returnedObservations,
  historicalMetadata,
} = await import(pathToFileURL(join(folder, 'dataHealth.mjs')).href)
const healthEntry = manifest.files.find(
  (e) => e.endpoint === '/api/data-health',
)
const healthFixture = JSON.parse(
  await readFile(new URL(healthEntry.path, root), 'utf8'),
)
test('unavailable health diagnostics differ from an available zero-issue check', () => {
  assert.equal(diagnosticState(healthFixture.date_mismatch_files).state, 'zero')
  const unavailable = diagnosticState({
    ...healthFixture.date_mismatch_files,
    available: false,
    unavailable_reason: 'No recorded table.',
  })
  assert.deepEqual(unavailable, {
    state: 'unavailable',
    text: 'No recorded table.',
  })
  assert.equal(
    healthCounts({ ...healthFixture, file_records_available: false })
      .successful,
    null,
  )
})
test('health counts keep overlapping zero-volume/no-trade/thin-volume categories separate', () => {
  assert.deepEqual(healthCounts(healthFixture), {
    successful: 14,
    rejected: 1,
    zeroVolume: 1,
    noTrade: 1,
    thinVolume: 30,
  })
})
test('truncated returned-list filtering cannot replace global counts', () => {
  const page = healthFixture.thin_volume_observations
  assert.match(
    diagnosticState(page).text,
    /30 total matching; 20 returned; truncated/,
  )
  const filtered = returnedObservations(page, 'GOLDM', true)
  assert.ok(filtered.every((row) => row.product === 'GOLDM'))
  assert.equal(page.total_count, 30)
  assert.equal(page.returned_count, 20)
  assert.ok(filtered[0].trade_date >= filtered.at(-1).trade_date)
  assert.equal(page.items[0].trade_date, '2026-09-14')
})
test('absent metadata cannot invent historical dates or session counts', () => {
  assert.equal(historicalMetadata(undefined), null)
  const empty = historicalMetadata({
    ...meta,
    data_as_of: null,
    first_trade_date: null,
    last_trade_date: null,
    trading_session_count: 0,
  })
  assert.equal(empty.asOf, null)
  assert.equal(empty.first, null)
  assert.equal(empty.sessions, 0)
})
test('methodology catalog validates actual manifest configs and export metadata', async () => {
  const result = await offline().snapshotCatalog()
  assert.equal(result.data.files.length, manifest.files.length)
  assert.equal(result.data.generated_at_utc, manifest.generated_at_utc)
  assert.equal(result.data.data_as_of, manifest.data_as_of)
  await assert.rejects(
    offline((name, bytes) =>
      name === 'manifest.json' ? Buffer.from('{}') : bytes,
    ).snapshotCatalog(),
    isKind('manifest'),
  )
})

const { exitSignalZ } = await import(
  pathToFileURL(join(folder, 'backtest.mjs')).href
)
test('executed exit event supplies signal-date z separately from execution-date z', () => {
  const report = guineaBacktest.reports.find((r) => r.expiry === '2026-10-30')
  const trade = report.completed_trades[0]
  assert.equal(exitSignalZ(trade, report.order_events), 0.23016351312045558)
  assert.equal(trade.exit_execution_z, 2.231705698126562)
  const exit = report.order_events.find(
    (e) => e.kind === 'exit' && e.status === 'executed',
  )
  const unrelated = [
    { ...exit, pair: 'GOLDTEN-GOLDPETAL' },
    { ...exit, expiry: '2026-11-30' },
    { ...exit, side: 'short_a_long_b' },
    { ...exit, event_date: '2026-09-26' },
    { ...exit, status: 'generated' },
  ]
  assert.equal(
    exitSignalZ(trade, [...unrelated, ...report.order_events]),
    exit.signal_z,
  )
  assert.equal(exitSignalZ(trade, unrelated), null)
  assert.equal(
    exitSignalZ(
      { ...trade, position_id: 'unrelated-entry' },
      report.order_events,
    ),
    null,
  )
  assert.equal(
    exitSignalZ(
      trade,
      report.order_events.map((e) =>
        e === exit ? { ...e, signal_z: null } : e,
      ),
    ),
    null,
  )
  assert.equal(
    exitSignalZ(trade, [
      ...report.order_events,
      { ...exit, order_id: `${trade.pair}:${trade.expiry}:999` },
    ]),
    null,
  )
})

const { commonCarryComparison, landingBacktestReport } = await import(
  pathToFileURL(join(folder, 'landing.mjs')).href
)
const carryPayload = async (carry) =>
  JSON.parse(
    await readFile(
      new URL(
        manifest.files.find(
          (e) =>
            e.endpoint === '/api/spreads' &&
            e.parameters.pair === 'GOLDM-GOLDTEN' &&
            !e.parameters.purity &&
            e.parameters.carry_adjusted === carry,
        ).path,
        root,
      ),
      'utf8',
    ),
  )
const carryOn = await carryPayload(true),
  carryOff = await carryPayload(false)
test('landing maturity comparison selects latest common date before nearest eligible expiry', () => {
  const comparison = commonCarryComparison(carryOn, carryOff)
  assert.equal(comparison.expiry, '2026-11-05')
  assert.equal(comparison.date, '2026-10-01')
  assert.equal(comparison.on.trade_date, comparison.off.trade_date)
  assert.equal(comparison.on.expiry_a, comparison.off.expiry_a)
  assert.deepEqual(comparison.on.expiry_b_used, ['2026-10-30', '2026-11-30'])
  assert.equal(comparison.on.a_p10_999, comparison.off.a_p10_999)
  const earlier = {
    ...carryOn,
    series: carryOn.series.map((s) => ({
      ...s,
      rows: s.rows.filter((r) => r.trade_date < '2026-10-01'),
    })),
  }
  const fallback = commonCarryComparison(earlier, carryOff)
  assert.equal(fallback.date, '2026-09-30')
  assert.equal(fallback.expiry, '2026-10-05')
  assert.equal(fallback.datasetThrough, '2026-10-01')

  assert.equal(
    commonCarryComparison(carryOn, { ...carryOff, data_as_of: '2026-09-30' })
      .date,
    '2026-10-01',
  )
  assert.equal(
    commonCarryComparison(carryOn, { ...carryOff, series: [] }),
    null,
  )
  assert.equal(commonCarryComparison(undefined, carryOff), null)
  const invalid = {
    ...carryOn,
    series: carryOn.series.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({ ...r, b_p10_999: null })),
    })),
  }
  assert.equal(commonCarryComparison(invalid, carryOff), null)
  const noSharedDate = {
    ...carryOff,
    series: carryOff.series.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({ ...r, trade_date: '2026-10-02' })),
    })),
  }
  assert.equal(commonCarryComparison(carryOn, noSharedDate), null)
  const wrongA = {
    ...carryOff,
    series: carryOff.series.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({
        ...r,
        a_p10_999: r.a_p10_999 === null ? null : r.a_p10_999 + 1,
      })),
    })),
  }
  assert.equal(commonCarryComparison(carryOn, wrongA), null)
})
test('landing honest report follows historical default expiry, never best performance', () => {
  assert.equal(landingBacktestReport(defaultBacktest).expiry, '2026-10-30')
  assert.equal(
    landingBacktestReport({
      ...defaultBacktest,
      reports: [...defaultBacktest.reports].reverse(),
    }).expiry,
    '2026-10-30',
  )
  assert.equal(
    landingBacktestReport({ ...defaultBacktest, reports: [] }),
    undefined,
  )
  assert.equal(landingBacktestReport(undefined), undefined)
})

test('integer-lot requests never receive fractional offline snapshots', async () => {
  const client = offline()
  await assert.rejects(
    client.backtest({ pair: 'GOLDTEN-GOLDPETAL', sizing_mode: 'integer_lots' }),
    isKind('offline-unavailable'),
  )
  const result = await client.backtest({ pair: 'GOLDTEN-GOLDPETAL' })
  assert.equal(result.data.configuration.sizing_mode, 'fractional')
  assert.equal(result.source, 'Offline snapshot')
})

test('maturity-matching summary compares only the same actual observation and basis', async () => {
  const { maturityMatchingChange } = await import(
    pathToFileURL(join(folder, 'relativeValue.mjs')).href
  )
  const on = carryOn.series.find((s) => s.expiry_a === '2026-11-05').latest
  const off = carryOff.series.find((s) => s.expiry_a === '2026-11-05').latest
  assert.ok(
    Math.abs(
      maturityMatchingChange(on, off, true) - (on.spread_abs - off.spread_abs),
    ) < 1e-9,
  )
  assert.equal(
    maturityMatchingChange(off, on, false),
    maturityMatchingChange(on, off, true),
  )
  for (const changed of [
    { ...off, trade_date: '2026-09-30' },
    { ...off, expiry_a: '2026-10-05' },
    { ...off, a_p10_999: off.a_p10_999 + 1 },
    { ...off, spread_abs: null },
  ]) {
    assert.equal(maturityMatchingChange(on, changed, true), null)
  }
})

test('purity defaults are off in requests, controls and saved reports', async () => {
  assert.equal(defaultDraft.purity, false)
  for (const endpoint of [
    '/api/overview',
    '/api/prices',
    '/api/spreads',
    '/api/curve',
    '/api/rolldown',
    '/api/backtest',
  ]) {
    assert.equal(canonicalParameters(endpoint).purity, false)
  }
  assert.equal(meta.normalization.default_purity_adjustment, false)
})
