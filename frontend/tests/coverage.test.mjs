import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const urls = {}
for (const name of ['format', 'coverage', 'relativeValue', 'schemas', 'api']) {
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
      (_, dependency) => `from '${urls[dependency]}'`,
    )
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const require = createRequire(import.meta.url)
const components = {}
for (const name of ['CoverageCalendar', 'CoverageDetails']) {
  const code = ts
    .transpileModule(
      await readFile(
        new URL(`../src/components/${name}.tsx`, import.meta.url),
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
      (_, dependency) => `from '${urls[dependency]}'`,
    )
    .replace(
      /from ["']react\/jsx-runtime["']/g,
      `from '${pathToFileURL(require.resolve('react/jsx-runtime')).href}'`,
    )
  components[name] = (
    await import(
      'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
    )
  ).default
}
const { parseCoverage } = await import(urls.schemas)
const { createApiClient, canonicalParameters } = await import(urls.api)
const { currentResource } = await import(urls.relativeValue)
const {
  monthRange,
  adjacentMonth,
  chooseCoverageDate,
  moveCoverageDate,
  calendarCells,
  coverageDayLabel,
} = await import(urls.coverage)

// Synthetic isolated response; no downloaded dataset or network required.
const zero = {
  observation_count: 0,
  distinct_contract_count: 0,
  no_trade_count: 0,
  zero_volume_count: 0,
  thin_volume_count: 0,
  invalid_close_count: 0,
}
const counts = {
  ...zero,
  observation_count: 1,
  distinct_contract_count: 1,
  zero_volume_count: 1,
  thin_volume_count: 1,
}
const file = {
  file_name: 'BhavCopyDateWise_02102026.csv',
  trade_date: '2026-10-02',
  status: 'error',
  rows_total: 0,
  rows_kept: 0,
  error_summary: 'CSV import failed.',
}
const payload = {
  data_as_of: '2026-10-01',
  data_available: true,
  message: null,
  configuration: { start: '2026-10-01', end: '2026-10-02', product: null },
  data_window: {
    first_trade_date: '2026-10-01',
    last_trade_date: '2026-10-01',
  },
  supported_products: ['GOLDTEN', 'GOLDPETAL'],
  counts,
  min_volume_grams: 2000,
  days: [
    {
      ...counts,
      date: '2026-10-01',
      products: [{ ...counts, product: 'GOLDTEN' }],
      observations: [
        {
          product: 'GOLDTEN',
          expiry_date: '2026-10-30',
          has_trade: true,
          volume_lots: 0,
          volume_grams: 0,
          open_interest_grams: 10,
          no_trade: false,
          zero_volume: true,
          thin_volume: true,
          invalid_close: false,
        },
      ],
      ingestion_count: 0,
      ingestions: [],
      ingestions_truncated: false,
    },
    {
      ...zero,
      date: '2026-10-02',
      products: [],
      observations: [],
      ingestion_count: 1,
      ingestions: [file],
      ingestions_truncated: false,
    },
  ],
  expected_coverage_available: false,
  expected_contract_count: null,
  missing_contract_count: null,
  expected_coverage_reason: 'Expected contract coverage unavailable.',
  official_calendar_available: false,
  file_records_available: true,
  ingestion_record_limit: 100,
  undated_ingestion_count: 1,
  undated_ingestions: [
    { ...file, file_name: 'BhavCopyDateWise_01102026.csv', trade_date: null },
  ],
  undated_ingestions_truncated: false,
  definitions: { no_trade_count: 'Stored has_trade is false.' },
  limitations: ['Not loaded does not mean exchange holiday.'],
}

test('month helpers handle leap years, year boundaries and exact inclusive calendar ranges', () => {
  assert.deepEqual(monthRange('2026-10'), {
    start: '2026-10-01',
    end: '2026-10-31',
  })
  assert.equal(monthRange('2028-02').end, '2028-02-29')
  assert.equal(monthRange('2026-02').end, '2026-02-28')
  assert.equal(monthRange('0001-02').end, '0001-02-28')
  assert.equal(monthRange('9999-12').end, '9999-12-31')
  assert.equal(adjacentMonth('2026-12', 1), '2027-01')
  assert.equal(adjacentMonth('0001-01', -1), null)
  assert.equal(adjacentMonth('9999-12', 1), null)
  assert.throws(() => monthRange('2026-13'))
  assert.throws(() => monthRange('0000-01'))
  assert.throws(() => monthRange(''))
})

test('selected dates retain valid preferences across filters and reject dates from another month', () => {
  assert.equal(chooseCoverageDate(payload, '2026-10-02'), '2026-10-02')
  assert.equal(chooseCoverageDate(payload, '2026-09-30'), '2026-10-01')
  const noRows = {
    ...payload,
    data_as_of: null,
    days: payload.days.map((day) => ({ ...day, observation_count: 0 })),
  }
  assert.equal(chooseCoverageDate(noRows, null), '2026-10-01')
  assert.equal(chooseCoverageDate({ ...payload, days: [] }, null), undefined)
})

test('keyboard date movement is bounded, supports arrows/week endpoints and leaves Tab alone', () => {
  const move = (date, key) =>
    moveCoverageDate(date, key, '2026-10-01', '2026-10-31')
  assert.equal(move('2026-10-01', 'ArrowLeft'), '2026-10-01')
  assert.equal(move('2026-10-01', 'ArrowDown'), '2026-10-08')
  assert.equal(move('2026-10-08', 'Home'), '2026-10-05')
  assert.equal(move('2026-10-08', 'End'), '2026-10-11')
  assert.equal(move('2026-10-31', 'ArrowRight'), '2026-10-31')
  assert.equal(move('2026-10-01', 'Tab'), null)
  assert.equal(calendarCells(payload.days).length, 5) // October starts Thursday.
})

test('validator accepts honest overlap/undated records and rejects malformed or guessed dates', () => {
  assert.deepEqual(parseCoverage(payload), payload)
  for (const mutate of [
    (value) => {
      value.expected_contract_count = 3
    },
    (value) => {
      value.official_calendar_available = true
    },
    (value) => {
      value.days[0].date = '2026-09-30'
    },
    (value) => {
      value.days[0].observation_count = 2
    },
    (value) => {
      value.days[0].observations[0].volume_grams = Infinity
    },
    (value) => {
      value.days[0].observations[0].product = 'GOLD'
    },
    (value) => {
      value.undated_ingestions[0].trade_date = '2026-10-01'
    },
    (value) => {
      value.days[1].ingestions[0].trade_date = '2026-10-01'
    },
  ]) {
    const invalid = structuredClone(payload)
    mutate(invalid)
    assert.throws(() => parseCoverage(invalid))
  }
})

test('canonical configurations keep month/product exact and reject missing/invalid ranges', () => {
  assert.deepEqual(
    canonicalParameters('/api/coverage', {
      start: '2026-10-01',
      end: '2026-10-31',
    }),
    { end: '2026-10-31', product: null, start: '2026-10-01' },
  )
  assert.notDeepEqual(
    canonicalParameters('/api/coverage', {
      start: '2026-10-01',
      end: '2026-10-31',
      product: 'GOLDTEN',
    }),
    canonicalParameters('/api/coverage', {
      start: '2026-10-01',
      end: '2026-10-31',
    }),
  )
  for (const query of [
    {},
    { start: '2026-10-01', end: '2026-10-00' },
    { start: '2026-09-01', end: '2026-10-02' },
    { start: '2026-10-31', end: '2026-10-01' },
  ])
    assert.throws(() => canonicalParameters('/api/coverage', query))
})

test('actual calendar/details render accessible selection and distinct zero-volume/no-trade categories', () => {
  const calendar = renderToStaticMarkup(
    createElement(components.CoverageCalendar, {
      days: payload.days,
      selected: '2026-10-01',
      onSelect() {},
    }),
  )
  assert.match(calendar, /aria-pressed="true"/)
  assert.match(calendar, /Not loaded/)
  assert.match(calendar, /Quality flags/)
  assert.match(coverageDayLabel(payload.days[0]), /No trade 0; zero volume 1/)
  const detail = renderToStaticMarkup(
    createElement(components.CoverageDetails, {
      day: payload.days[0],
      product: null,
      filesAvailable: true,
    }),
  )
  assert.match(detail, /Recorded trade/)
  assert.match(detail, /Zero volume; Thin volume/)
  assert.match(detail, /Expected contract coverage unavailable/)
})

test('late old requests cannot replace the current identity and responses must match range/product', async () => {
  const client = createApiClient({
    baseUrl: 'http://test',
    fetcher: async (url) => {
      const u = new URL(url)
      if (u.searchParams.get('product') === 'GOLDTEN')
        await new Promise((resolve) => setTimeout(resolve, 20))
      return Response.json({
        ...payload,
        configuration: {
          ...payload.configuration,
          product: u.searchParams.get('product'),
        },
      })
    },
  })
  const oldIdentity = () => {}
  const currentIdentity = () => {}
  const old = client.coverage({ ...payload.configuration, product: 'GOLDTEN' })
  const latest = await client.coverage(payload.configuration)
  assert.equal(latest.source, 'API')
  assert.equal(
    currentResource(oldIdentity, currentIdentity, await old),
    undefined,
  )
  const wrong = createApiClient({
    baseUrl: 'http://test',
    fetcher: async () => Response.json(payload),
  })
  await assert.rejects(
    wrong.coverage({ ...payload.configuration, product: 'GOLDTEN' }),
    (e) => e.kind === 'invalid-response',
  )
  await assert.rejects(
    wrong.coverage({ start: '2026-11-01', end: '2026-11-02' }),
    (e) => e.kind === 'invalid-response',
  )
})

test('HTTP errors and malformed bodies never silently use offline coverage', async () => {
  for (const [status, body] of [
    [422, {}],
    [500, {}],
    [200, {}],
  ]) {
    let calls = 0
    const client = createApiClient({
      baseUrl: 'http://test',
      fetcher: async () => {
        calls++
        return Response.json(body, { status })
      },
    })
    await assert.rejects(
      client.coverage(payload.configuration),
      (e) => e.kind === (status === 200 ? 'invalid-response' : 'http'),
    )
    assert.equal(calls, 1)
  }
})

test('new exact offline coverage snapshots and old manifests remain compatible without substituting settings', async () => {
  const meta = {
    data_as_of: payload.data_as_of,
    data_available: true,
    message: null,
    first_trade_date: payload.data_as_of,
    last_trade_date: payload.data_as_of,
    trading_session_count: 1,
    supported_products: payload.supported_products,
    available_products: ['GOLDTEN'],
    contract_counts_by_product: { GOLDTEN: 1 },
    prototype_window: true,
    normalization: {
      unit: 'Rs per 10 g',
      basis: '999 purity',
      base_grams: 10,
      base_purity: 999,
      quote_grams: { GOLDTEN: 10, GOLDPETAL: 1 },
      purity_assumptions: { GOLDTEN: 999, GOLDPETAL: 999 },
      purity_verification_status: 'unverified',
      default_purity_adjustment: false,
      comparison_basis_status: 'provisional',
      comparison_basis_warning: 'Research assumptions.',
    },
  }
  const contents = new Map()
  const manifest = {
    snapshot_schema_version: 1,
    generated_at_utc: '2026-10-22T00:00:00Z',
    data_as_of: payload.data_as_of,
    data_window: payload.data_window,
    files: [],
    supported_offline_configurations: [],
    purity_verification_status: 'unverified',
    limitations: ['Historical isolated fixture.'],
  }
  const monthly = structuredClone(payload)
  monthly.configuration.end = '2026-10-31'
  for (let date = 3; date <= 31; date++)
    monthly.days.push({
      ...zero,
      date: `2026-10-${String(date).padStart(2, '0')}`,
      products: [],
      observations: [],
      ingestion_count: 0,
      ingestions: [],
      ingestions_truncated: false,
    })
  for (const [endpoint, parameters, data, name] of [
    ['/api/meta', {}, meta, 'meta'],
    ['/api/coverage', monthly.configuration, monthly, 'coverage-all'],
    [
      '/api/coverage',
      { ...monthly.configuration, product: 'GOLDTEN' },
      {
        ...monthly,
        configuration: { ...monthly.configuration, product: 'GOLDTEN' },
      },
      'coverage-GOLDTEN',
    ],
  ]) {
    const bytes = Buffer.from(JSON.stringify(data))
    const applied = canonicalParameters(endpoint, parameters)
    const key = JSON.stringify({ endpoint, parameters: applied })
    const path = `versions/isolated-test/${name}.json`
    contents.set(path, bytes)
    manifest.files.push({
      endpoint,
      parameters: applied,
      request_key: key,
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length,
    })
    manifest.supported_offline_configurations.push(key)
  }
  const fetcher =
    (legacy = false) =>
    async (url) => {
      if (String(url).startsWith('http://test')) throw new TypeError('Offline')
      const file = String(url).replace('/snapshots/', '')
      if (legacy && file === 'manifest.json') {
        const old = {
          ...manifest,
          files: manifest.files.filter((e) => e.endpoint !== '/api/coverage'),
        }
        old.supported_offline_configurations = old.files.map(
          (e) => e.request_key,
        )
        return Response.json(old)
      }
      if (file === 'manifest.json') return Response.json(manifest)
      return new Response(contents.get(file), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
  const client = createApiClient({
    baseUrl: 'http://test',
    snapshotBaseUrl: '/snapshots/',
    fetcher: fetcher(),
  })
  const entries = manifest.files.filter((e) => e.endpoint === '/api/coverage')
  assert.ok(entries.length)
  for (const entry of entries) {
    const response = await client.coverage(entry.parameters)
    assert.equal(response.source, 'Offline snapshot')
    assert.deepEqual(response.data.configuration, entry.parameters)
  }
  await assert.rejects(
    client.coverage({ start: '1900-01-01', end: '1900-01-31' }),
    (e) => e.kind === 'offline-unavailable',
  )
  const legacy = createApiClient({
    baseUrl: 'http://test',
    snapshotBaseUrl: '/snapshots/',
    fetcher: fetcher(true),
  })
  assert.equal((await legacy.meta()).source, 'Offline snapshot')
  await assert.rejects(
    legacy.coverage(entries[0].parameters),
    (e) => e.kind === 'offline-unavailable',
  )
})
