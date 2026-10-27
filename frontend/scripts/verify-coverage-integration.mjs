// Actual local HTTP -> production client validation -> calendar/details rendering.
// This is not a desktop/mobile browser or keyboard-focus test.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const urls = {}
for (const name of ['format', 'coverage', 'schemas', 'api']) {
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
const { createApiClient } = await import(urls.api)
const { chooseCoverageDate } = await import(urls.coverage)
const baseUrl = 'http://localhost:8010'
const preview = 'http://localhost:5173'
const snapshotBaseUrl = preview + '/snapshots/'
const online = createApiClient({ baseUrl })
const offline = createApiClient({
  baseUrl,
  snapshotBaseUrl,
  fetcher: (url, options) => {
    if (String(url).startsWith(baseUrl))
      throw new TypeError('Verification-only API transport outage')
    return fetch(url, options)
  },
})
const manifest = await (await fetch(snapshotBaseUrl + 'manifest.json')).json()
const entries = manifest.files.filter(
  (entry) => entry.endpoint === '/api/coverage',
)
assert.ok(entries.length, 'No authorized coverage snapshots are available')
for (const entry of entries) {
  const live = await online.coverage(entry.parameters)
  const saved = await offline.coverage(entry.parameters)
  assert.equal(live.source, 'API')
  assert.equal(saved.source, 'Offline snapshot')
  assert.deepEqual(saved.data, live.data)
  const selected = chooseCoverageDate(live.data, null)
  const day = live.data.days.find((row) => row.date === selected)
  assert.ok(day)
  const calendar = renderToStaticMarkup(
    createElement(components.CoverageCalendar, {
      days: live.data.days,
      selected,
      onSelect() {},
    }),
  )
  const detail = renderToStaticMarkup(
    createElement(components.CoverageDetails, {
      day,
      product: live.data.configuration.product,
      filesAvailable: live.data.file_records_available,
    }),
  )
  assert.match(calendar, /aria-pressed="true"/)
  assert.match(detail, /Expected contract coverage unavailable/)
  for (const observation of day.observations) {
    assert.ok(detail.includes(observation.product))
  }
  if (entry.parameters.product === null)
    console.log(
      JSON.stringify({
        range: live.data.configuration,
        counts: live.data.counts,
        loadedDays: live.data.days.filter((row) => row.observation_count)
          .length,
        undatedFiles: live.data.undated_ingestion_count,
      }),
    )
}
await assert.rejects(
  offline.coverage({ start: '1900-01-01', end: '1900-01-31' }),
  (error) => error.kind === 'offline-unavailable',
)
await assert.rejects(
  online.coverage({
    start: '2026-10-01',
    end: '2026-10-31',
    product: 'INVALID',
  }),
  (error) => error.kind === 'http' && error.status === 422,
)
const page = await fetch(preview + '/app/calendar')
assert.equal(page.status, 200)
const html = await page.text()
const asset = html.match(/src="([^"]+\.js)"/)[1]
const bundle = await (await fetch(preview + asset)).text()
assert.ok(bundle.includes('Data Coverage'))
assert.ok(bundle.includes('Explain this comparison'))
assert.ok(!bundle.includes('Account access is not enabled'))
const auth = await fetch(baseUrl + '/api/auth/me', {
  headers: { Origin: preview },
})
assert.equal(auth.status, 401) // No cookie: an honest guest, not a broken session.
const cors = await fetch(baseUrl + '/api/auth/login', {
  method: 'OPTIONS',
  headers: {
    Origin: preview,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
})
assert.equal(cors.status, 200)
assert.equal(cors.headers.get('access-control-allow-origin'), preview)
assert.equal(cors.headers.get('access-control-allow-credentials'), 'true')
console.log(
  `PASS: ${entries.length} live/offline coverage configurations; actual calendar/detail rendering; unsupported offline range; HTTP 422; current served build; guest auth/CORS. No authentication database mutations.`,
)
console.log(
  'Browser desktop/mobile interaction, native focus and navigation retention: NOT TESTED by this script.',
)
