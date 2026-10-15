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
let failures = {}
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
    const params = { requestId: message.params.requestId }
    const endpoint = new URL(message.params.request.url).pathname
    const failure = failures[endpoint]
    if (failure)
      send('Fetch.fulfillRequest', {
        ...params,
        responseCode: failure.status,
        responseHeaders: [
          {
            name: 'Access-Control-Allow-Origin',
            value: uiBase,
          },
          { name: 'Content-Type', value: 'application/json' },
        ],
        body: btoa(JSON.stringify(failure.body ?? {})),
      }).catch((e) => exceptions.push(e.message))
    else
      send('Fetch.continueRequest', params).catch((e) =>
        exceptions.push(e.message),
      )
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
const report = {}
async function healthLoaded() {
  await until(
    "document.querySelector('.dh-summary') && !document.querySelector('.data-health-page .skeleton')",
  )
}
async function goto(path) {
  await send('Page.navigate', { url: uiBase + path })
}
async function state() {
  return evaluate(
    "({summary:document.querySelector('.dh-summary')?.innerText,checks:document.querySelector('.dh-checks')?.innerText,lists:Array.from(document.querySelectorAll('.dh-observations')).map(e=>e.innerText),meta:document.querySelector('.dh-meta')?.innerText,body:document.body.innerText})",
  )
}
async function control(label, value) {
  await evaluate(
    `(() => {const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  )
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
  await goto('/app/data-health')
  await healthLoaded()
  report.health = await state()
  const real = await (
    await fetch('http://localhost:8010/api/data-health')
  ).json()
  report.actualCounts = {
    statuses: real.file_status_counts,
    sessions: real.database_session_count,
    observations: real.database_observation_count,
    zero: real.zero_volume_counts_by_product,
    noTrade: real.no_trade_counts_by_product,
    thin: real.thin_volume_counts_by_product,
  }
  assert.ok(report.health.summary.includes('Successful processing records'))
  assert.ok(report.health.summary.includes('14'))
  assert.ok(report.health.summary.includes('336'))
  assert.ok(report.health.summary.includes('Detailed causes are unavailable'))
  assert.ok(
    report.health.lists[1].includes(
      '30 total matching; 20 returned; truncated',
    ),
  )
  assert.ok(report.health.checks.includes('Unavailable'))
  assert.ok(report.health.body.includes('Zero matching processing records'))
  assert.equal(
    await evaluate("document.querySelectorAll('.nav-pending').length"),
    0,
  )
  await screenshot('data-health-desktop.png')
  await control('Returned-list product', 'GOLDM')
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('.dh-observations:last-of-type tbody tr')).some(r=>r.innerText.includes('GOLDGUINEA'))",
    ),
    false,
  )
  assert.ok((await state()).lists[1].includes('30 total matching; 20 returned'))
  await control('Returned-list date order', 'descending')
  report.localFilters = true
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  await send('Page.reload', { ignoreCache: true })
  await healthLoaded()
  await until(
    "document.querySelector('.dh-summary .source-badge')?.innerText==='Offline snapshot'",
  )
  report.offlineHealth = true
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/*' }],
  })
  failures = { '/api/data-health': { status: 500 } }
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.body.innerText.includes('HTTP 500') && document.querySelector('.dh-meta').innerText.includes('14')",
  )
  assert.equal(
    await evaluate("document.querySelector('.dh-summary')!==null"),
    false,
  )
  report.healthFailureMetaUsable = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry Data Health').click()",
  )
  await healthLoaded()
  failures = { '/api/meta': { status: 500 } }
  await send('Page.reload', { ignoreCache: true })
  await healthLoaded()
  await until(
    "document.querySelector('.dh-meta').innerText.includes('Metadata unavailable')",
  )
  report.metaFailureHealthUsable = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry metadata').click()",
  )
  await until(
    "document.querySelector('.dh-meta').innerText.includes('Sessions: 14')",
  )
  await send('Fetch.disable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await evaluate('window.scrollTo(0,0)')
  await wait(250)
  assert.equal(
    await evaluate('document.documentElement.scrollWidth>innerWidth'),
    false,
  )
  await screenshot('data-health-mobile.png')
  await evaluate(
    'document.querySelector(\'select[aria-label="Returned-list product"]\').focus()',
  )
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
  assert.equal(
    await evaluate("document.activeElement.getAttribute('aria-label')"),
    'Returned-list date order',
  )
  report.healthKeyboard = true
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await goto('/app/methodology')
  await until(
    "document.querySelector('.method-simulation-defaults') && document.querySelector('.method-spread-defaults') && document.body.innerText.includes('44 exact supported configurations')",
  )
  report.methodology = await evaluate(
    "document.querySelector('.methodology-page').innerText",
  )
  assert.ok(report.methodology.includes('ddof=1'))
  assert.ok(report.methodology.includes('half credit for ties'))
  assert.ok(report.methodology.includes('tie chooses the earlier expiry'))
  assert.ok(
    report.methodology.includes('window 10; min_periods 5; volume 2000 g'),
  )
  assert.ok(report.methodology.includes('40-session/10-completed-trade'))
  assert.ok(report.methodology.includes('across all products'))
  await screenshot('methodology-desktop.png')
  await evaluate(
    'document.querySelector(\'.method-navigation a[href="#method-normalization"]\').click()',
  )
  assert.equal(await evaluate('location.hash'), '#method-normalization')
  report.inPageNavigation = true
  await evaluate(
    "document.querySelector('#method-offline details summary').click()",
  )
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.method-catalog tbody tr').length",
    ),
    44,
  )
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/*' }],
  })
  failures = {
    '/api/meta': { status: 500 },
    '/api/spreads': { status: 500 },
    '/api/backtest': { status: 500 },
  }
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.body.innerText.includes('Current metadata unavailable') && document.body.innerText.includes('Current simulation endpoint defaults: unavailable')",
  )
  assert.ok(
    await evaluate(
      "document.querySelector('#method-statistics').innerText.includes('ddof=1')",
    ),
  )
  assert.ok(
    await evaluate(
      "document.querySelector('.method-current-window').innerText.includes('unavailable')",
    ),
  )
  assert.equal(
    await evaluate(
      "document.querySelector('.method-current-window').innerText.includes('2026')",
    ),
    false,
  )
  report.staticWithoutMetadata = true
  failures = {}
  await send('Fetch.disable')
  await send('Page.reload', { ignoreCache: true })
  await until("document.querySelector('.method-simulation-defaults')")
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await evaluate('window.scrollTo(0,0)')
  await wait(250)
  assert.equal(
    await evaluate('document.documentElement.scrollWidth>innerWidth'),
    false,
  )
  await screenshot('methodology-mobile.png')
  await evaluate("document.querySelector('.method-navigation a').focus()")
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
  report.methodKeyboard = true
  for (const [path, condition] of [
    ['/app', "document.querySelectorAll('.product-card').length===4"],
    [
      '/app/relative-value',
      "document.querySelectorAll('.rv-reading').length===8",
    ],
    ['/app/term-structure', "document.querySelector('.ts-latest')"],
    [
      '/app/backtest',
      "document.querySelectorAll('.bt-kpis .rv-reading').length===7",
    ],
  ]) {
    await goto(path)
    await until(condition)
  }
  report.existingPagesPreserved = true
  assert.deepEqual(exceptions, [])
  report.runtimeExceptions = exceptions
  await writeFile(
    resolve(output, 'health-methodology-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        counts: report.actualCounts,
        offline: report.offlineHealth,
        partialFailures:
          report.healthFailureMetaUsable && report.metaFailureHealthUsable,
        staticWithoutMetadata: report.staticWithoutMetadata,
        navigation: report.inPageNavigation,
        keyboard: report.healthKeyboard && report.methodKeyboard,
        regressions: report.existingPagesPreserved,
        runtimeExceptions: exceptions,
      },
      null,
      2,
    ),
  )
} finally {
  failures = {}
  await send('Fetch.disable')
  await send('Network.setBlockedURLs', { urls: [] })
  socket.close()
}
