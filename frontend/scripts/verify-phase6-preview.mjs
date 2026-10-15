import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

// Drive an already-running local Chrome through its built-in DevTools protocol.
// No browser libraries, downloads or changes to backend process state.
const uiBase = process.env.AURAXIS_UI_URL ?? 'http://localhost:5180'
const output = resolve('node_modules/.cache/auraxis-verification')
await mkdir(output, { recursive: true })
const targets = await (await fetch('http://localhost:9222/json/list')).json()
const target = targets.find((t) => t.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) =>
  socket.addEventListener('open', resolve, { once: true }),
)
let nextId = 0
const pending = new Map()
const exceptions = []
const cancelledInterceptions = []
function interceptionError(error) {
  if (error.message.includes('Invalid InterceptionId'))
    cancelledInterceptions.push(error.message)
  else exceptions.push(error.message)
}
let mode = 'normal'
const held = []
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) {
    const item = pending.get(message.id)
    if (item) {
      pending.delete(message.id)
      if (message.error) item.reject(new Error(message.error.message))
      else item.resolve(message.result)
    }
  }
  if (message.method === 'Fetch.requestPaused') {
    const requestId = message.params.requestId
    if (mode === 'hold') {
      held.push(requestId)
      return
    }
    if (mode === 'normal')
      send('Fetch.continueRequest', { requestId }).catch(interceptionError)
    else
      (async () => {
        const body =
          mode === 'empty' ? await emptyPayload(message.params.request.url) : {}
        await send('Fetch.fulfillRequest', {
          requestId,
          responseCode: mode === 'error' ? 500 : 200,
          responseHeaders: [
            { name: 'Access-Control-Allow-Origin', value: uiBase },
            { name: 'Content-Type', value: 'application/json' },
          ],
          body: btoa(JSON.stringify(body)),
        })
      })().catch(interceptionError)
  }
  if (message.method === 'Runtime.exceptionThrown')
    exceptions.push(message.params.exceptionDetails.text)
})
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    )
  return result.result.value
}
async function until(expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return
    await wait(150)
  }
  throw new Error('Timed out: ' + expression)
}
async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  await writeFile(
    resolve(output, name),
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
  )
}
async function emptyPayload(url) {
  const d = await (await fetch(url)).json()
  const endpoint = new URL(url).pathname
  const empty = {
    ...d,
    data_as_of: null,
    data_available: false,
    message: 'No stored observations available.',
  }
  if (d.data_window)
    empty.data_window = { first_trade_date: null, last_trade_date: null }
  if (endpoint === '/api/meta')
    Object.assign(empty, {
      first_trade_date: null,
      last_trade_date: null,
      trading_session_count: 0,
      available_products: [],
      contract_counts_by_product: Object.fromEntries(
        d.supported_products.map((p) => [p, 0]),
      ),
    })
  if (endpoint === '/api/overview')
    Object.assign(empty, { references: [], upcoming_expiries: [] })
  if (endpoint === '/api/prices') empty.series = []
  if (endpoint === '/api/spreads') empty.series = []
  if (endpoint === '/api/curve')
    Object.assign(empty, { selected_date: null, points: [] })
  if (endpoint === '/api/rolldown')
    Object.assign(empty, { series: [], valid_count: 0, invalid_count: 0 })
  if (endpoint === '/api/backtest') empty.reports = []
  if (endpoint === '/api/data-health') {
    for (const key of [
      'recorded_file_count',
      'database_session_count',
      'database_observation_count',
    ])
      empty[key] = 0
    empty.file_status_counts = {}
    for (const key of [
      'zero_volume_counts_by_product',
      'no_trade_counts_by_product',
      'thin_volume_counts_by_product',
    ])
      empty[key] = Object.fromEntries(Object.keys(d[key]).map((p) => [p, 0]))
    for (const key of [
      'recorded_files',
      'rejected_files',
      'date_mismatch_files',
      'no_trade_observations',
      'thin_volume_observations',
    ])
      empty[key] = {
        ...d[key],
        total_count: 0,
        returned_count: 0,
        truncated: false,
        items: [],
      }
  }
  return empty
}
const report = { preview: uiBase, pages: [] }
const pages = [
  [
    '/',
    "document.querySelector('.landing-report') && document.querySelector('.landing-carry-values')",
    'Maturity comparison unavailable',
  ],
  [
    '/app',
    "document.querySelectorAll('.product-card').length===4",
    'No stored observations',
  ],
  [
    '/app/relative-value',
    "document.querySelectorAll('.rv-reading').length===8",
    'No stored observations',
  ],
  [
    '/app/term-structure',
    "document.querySelector('.ts-latest') && document.querySelector('.ts-curve-table tbody tr')",
    'No stored observations',
  ],
  [
    '/app/backtest',
    "document.querySelectorAll('.bt-kpis .rv-reading').length===7",
    'No stored observations',
  ],
  [
    '/app/data-health',
    "document.querySelector('.dh-summary')",
    'Zero matching observations',
  ],
  [
    '/app/methodology',
    "document.querySelector('.method-simulation-defaults')",
    '0 stored trading sessions',
  ],
]
async function goto(path) {
  await send('Page.navigate', { url: uiBase + path })
}
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  // Verify the actual built manifest and every immutable file path over HTTP.
  const manifest = await (
    await fetch(uiBase + '/snapshots/manifest.json')
  ).json()
  for (const entry of manifest.files) {
    const response = await fetch(uiBase + '/snapshots/' + entry.path)
    assert.equal(response.status, 200)
    const bytes = await response.arrayBuffer()
    assert.equal(bytes.byteLength, entry.size_bytes)
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    assert.equal(hash, entry.sha256)
    JSON.parse(new TextDecoder().decode(bytes))
  }
  report.snapshotFiles = manifest.files.length
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/*' }],
  })
  for (const [path, ready, emptyText] of pages) {
    mode = 'hold'
    await goto(path)
    await until(
      "Boolean(document.querySelector('.skeleton')||document.querySelector('[role=status]')||document.body.innerText.includes('Loading'))",
    )
    mode = 'normal'
    await Promise.all(
      held
        .splice(0)
        .map((requestId) => send('Fetch.continueRequest', { requestId })),
    )
    await until(ready)
    const row = { path, loading: true, online: true }
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false,
    )
    mode = 'empty'
    await send('Page.reload', { ignoreCache: true })
    await until(
      `document.body.innerText.includes(${JSON.stringify(emptyText)})`,
    )
    row.empty = true
    mode = 'error'
    await send('Page.reload', { ignoreCache: true })
    await until("document.body.innerText.includes('HTTP 500')")
    row.error = true
    mode = 'normal'
    await send('Page.reload', { ignoreCache: true })
    await until(ready)
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await wait(150)
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false,
    )
    row.mobile = true
    await evaluate("document.querySelector('a[href]')?.focus()")
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })
    assert.notEqual(
      await evaluate('getComputedStyle(document.activeElement).outlineStyle'),
      'none',
    )
    row.keyboard = true
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    })
    report.pages.push(row)
  }
  await send('Fetch.disable')
  mode = 'normal'
  await goto('/')
  await until(pages[0][1])
  await screenshot('phase6-final-landing-desktop.png')
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(
    resolve(output, 'phase6-final-landing-viewport.png'),
    Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
  )
  await goto('/app')
  await until(pages[1][1])
  await screenshot('phase6-final-overview-desktop.png')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await goto('/')
  await until(pages[0][1])
  await screenshot('phase6-final-landing-mobile.png')
  assert.deepEqual(exceptions, [])
  report.cancelledInterceptions = cancelledInterceptions
  report.runtimeExceptions = exceptions
  await writeFile(
    resolve(output, 'phase6-preview-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  mode = 'normal'
  await send('Fetch.disable')
  socket.close()
}
