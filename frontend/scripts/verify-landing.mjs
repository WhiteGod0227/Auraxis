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
const requests = []
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (
    m.method === 'Network.requestWillBeSent' &&
    m.params.request.url.includes('localhost:8010/api/')
  )
    requests.push(m.params.request.url)
})
async function goto(path = '/') {
  await send('Page.navigate', { url: uiBase + path })
}
async function loaded() {
  await until(
    "document.querySelector('.landing-carry-values') && document.querySelector('.landing-report') && document.querySelectorAll('.landing-preview .recharts-legend-item').length===4",
  )
}
async function state() {
  return evaluate(
    "({carry:document.querySelector('.landing-carry-values')?.innerText,values:Array.from(document.querySelectorAll('.landing-carry-values .rv-reading strong')).map(e=>e.innerText),report:document.querySelector('.landing-report')?.innerText,verdict:document.querySelector('.landing-api-verdict')?.innerText,history:document.querySelector('.landing-history')?.innerText,labels:Array.from(document.querySelectorAll('.landing-preview .recharts-legend-item')).map(e=>e.innerText),sources:Array.from(document.querySelectorAll('.landing .source-badge')).map(e=>e.innerText)})",
  )
}
async function clickText(text) {
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(e=>e.textContent===${JSON.stringify(text)}).click()`,
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
  await goto()
  await loaded()
  report.online = await state()
  assert.ok(report.online.history.includes('01 Oct 2026'))
  assert.ok(report.online.history.includes('14'))
  assert.ok(report.online.carry.includes('05 Nov 2026'))
  assert.ok(report.online.carry.includes('01 Oct 2026'))
  assert.ok(report.online.values[2].includes('52.36'))
  assert.ok(report.online.labels.every((label) => label.includes('2026-10')))
  const api = await (
    await fetch('http://localhost:8010/api/backtest?pair=GOLDTEN-GOLDPETAL')
  ).json()
  const expiry = api.reports.find((r) => r.expiry === '2026-10-30')
  assert.equal(report.online.verdict, expiry.verdict)
  report.actualVerdict = expiry.verdict
  await screenshot('landing-desktop.png')
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(
    resolve(output, 'landing-desktop-viewport.png'),
    Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
  )
  let count = requests.length
  await wait(500)
  assert.equal(requests.length, count)
  report.noRefetchLoop = true
  await clickText('Carry off')
  report.carryOff = await state()
  assert.ok(report.carryOff.values[2].includes('218.22'))
  assert.ok(report.carryOff.carry.includes('30 Oct 2026 (-6 days)'))
  assert.equal(requests.length, count)
  await clickText('Carry on')
  assert.ok((await state()).carry.includes('30 Nov 2026 (+25 days)'))
  report.carryToggleActualRows = true
  const ctas = await evaluate(
    "Array.from(document.querySelectorAll('.landing a[href^=\"/app\"]')).map(e=>({href:e.getAttribute('href'),text:e.innerText}))",
  )
  for (const href of [...new Set(ctas.map((a) => a.href))]) {
    await evaluate(
      `document.querySelector('.landing a[href="${href}"]').click()`,
    )
    await until(`location.pathname===${JSON.stringify(href)}`)
    assert.ok(await evaluate("document.querySelector('.dashboard') !== null"))
    await evaluate("document.querySelector('.dashboard-home').click()")
    await until("location.pathname==='/'")
    await loaded()
  }
  report.allCtasAndHome = true
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  await send('Page.reload', { ignoreCache: true })
  await loaded()
  await until(
    "Array.from(document.querySelectorAll('.landing .source-badge')).every(e=>e.innerText==='Offline snapshot')",
  )
  report.offline = await state()
  assert.deepEqual(report.offline.values, report.online.values)
  assert.ok(
    await evaluate(
      "Array.from(document.querySelectorAll('.landing-carry-source')).every(e=>e.innerText.includes('Offline snapshot'))",
    ),
  )
  await send('Network.setBlockedURLs', {
    urls: ['http://localhost:8010/api/spreads*carry_adjusted=false*'],
  })
  await send('Page.reload', { ignoreCache: true })
  await loaded()
  await until(
    "document.querySelectorAll('.landing-carry-source')[1]?.innerText.includes('Offline snapshot')",
  )
  report.mixedSources = await evaluate(
    "Array.from(document.querySelectorAll('.landing-carry-source')).map(e=>e.innerText)",
  )
  assert.ok(report.mixedSources[0].includes('API'))
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/*' }],
  })
  failures = { '/api/prices': { status: 500 } }
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelector('.landing-preview')?.innerText.includes('HTTP 500') && document.querySelector('.landing-report') && document.querySelector('.landing-carry-values')",
  )
  assert.ok(
    await evaluate(
      'document.querySelector(\'.landing-hero a[href="/app"]\')!==null',
    ),
  )
  report.partialPriceFailure = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Retry price preview').click()",
  )
  await loaded()
  const empty = await (
    await fetch(
      'http://localhost:8010/api/spreads?pair=GOLDM-GOLDTEN&carry_adjusted=true',
    )
  ).json()
  empty.series = []
  failures = { '/api/spreads': { status: 200, body: empty } }
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelector('.landing-carry')?.innerText.includes('Maturity comparison unavailable') && document.querySelector('.landing-report')",
  )
  assert.equal(
    await evaluate("document.querySelector('.landing-carry-values')!==null"),
    false,
  )
  report.noCommonComparison = true
  failures = {
    '/api/meta': { status: 500 },
    '/api/prices': { status: 500 },
    '/api/spreads': { status: 500 },
    '/api/backtest': { status: 500 },
  }
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelector('.landing-history')?.innerText.includes('Metadata unavailable') && document.querySelector('.landing-honest')?.innerText.includes('Simulation report unavailable')",
  )
  assert.ok(
    await evaluate(
      "document.querySelector('.landing-hero h1')?.innerText.includes('Is the gap real?')",
    ),
  )
  report.staticWithErrors = true
  failures = {}
  await send('Fetch.disable')
  await send('Page.reload', { ignoreCache: true })
  await loaded()
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
  await screenshot('landing-mobile.png')
  const mobile = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  })
  await writeFile(
    resolve(output, 'landing-mobile-viewport.png'),
    Uint8Array.from(atob(mobile.data), (c) => c.charCodeAt(0)),
  )
  await evaluate("document.querySelector('.landing-menu-toggle').click()")
  assert.ok(
    await evaluate(
      "document.querySelector('#landing-links').classList.contains('open')",
    ),
  )
  await evaluate(
    'document.querySelector(\'#landing-links a[href="#problem"]\').click()',
  )
  assert.equal(await evaluate('location.hash'), '#problem')
  assert.equal(
    await evaluate(
      "document.querySelector('#landing-links').classList.contains('open')",
    ),
    false,
  )
  await evaluate("document.querySelector('.landing-menu-toggle').focus()")
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
  report.keyboardAndMobileNav = true
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.landing-feature')).transitionDuration",
    ),
    '0s',
  )
  report.reducedMotion = true
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
    ['/app/data-health', "document.querySelector('.dh-summary')"],
    [
      '/app/methodology',
      "document.querySelector('.method-simulation-defaults')",
    ],
  ]) {
    await goto(path)
    await until(condition)
  }
  for (const path of ['/app/calendar', '/app/alerts']) {
    await goto(path)
    await until(
      "document.body.innerText.includes('unavailable in the research prototype')",
    )
  }
  report.sixPagesAndOldUrls = true
  assert.deepEqual(exceptions, [])
  report.runtimeExceptions = exceptions
  report.requests = requests
  await writeFile(
    resolve(output, 'landing-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        online: report.online,
        carryOff: report.carryOff,
        offline: report.offline.sources,
        partialFailures: report.partialPriceFailure,
        noCommon: report.noCommonComparison,
        keyboard: report.keyboardAndMobileNav,
        reducedMotion: report.reducedMotion,
        allRoutes: report.sixPagesAndOldUrls,
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
