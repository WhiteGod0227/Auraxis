import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

// Drive an already-running local Chrome through its built-in DevTools protocol.
// No browser libraries, downloads or changes to backend process state.
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
let failPrices = false
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
    const parameters = { requestId: message.params.requestId }
    const method = failPrices ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest'
    if (failPrices)
      Object.assign(parameters, {
        responseCode: 500,
        responseHeaders: [
          {
            name: 'Access-Control-Allow-Origin',
            value: 'http://localhost:5180',
          },
        ],
        body: btoa('{}'),
      })
    send(method, parameters).catch((error) => exceptions.push(error.message))
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
    if (await evaluate(expression)) return
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
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: 'http://localhost:5180/app' })
  await until(
    "document.querySelectorAll('.product-card').length === 4 && document.querySelectorAll('.recharts-legend-item').length === 4",
  )
  report.api = await evaluate(
    `({ cards: [...document.querySelectorAll('.product-card')].map(e => e.innerText), labels: [...document.querySelectorAll('.recharts-legend-item-text')].map(e => e.textContent), expiries: document.querySelectorAll('.expiry-scroll tbody tr').length, sources: [...document.querySelectorAll('.source-badge')].map(e => e.textContent), overflow: document.documentElement.scrollWidth > innerWidth })`,
  )
  assert.equal(report.api.expiries, 24)
  assert.ok(report.api.sources.every((s) => s === 'API'))
  assert.equal(report.api.overflow, false)
  const agreement = await evaluate(`(async () => {
    const body = await (await fetch('http://localhost:8010/api/overview')).json();
    const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
    return body.references.every((r,i) => document.querySelectorAll('.product-price')[i].textContent === formatter.format(r.close_p10_999));
  })()`)
  assert.equal(agreement, true)
  const plot = await evaluate(
    "(() => {const r=document.querySelector('.chart-container').getBoundingClientRect(); return {x:r.x+r.width*.7,y:r.y+r.height*.35}})()",
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...plot })
  await until(
    "document.querySelector('.recharts-tooltip-wrapper')?.innerText.includes('2026')",
  )
  report.chartTooltip = await evaluate(
    "document.querySelector('.recharts-tooltip-wrapper').innerText",
  )
  assert.ok(report.chartTooltip.includes('GOLDTEN'))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await screenshot('overview-desktop.png')
  await evaluate("document.querySelector('.sidebar nav a').focus()")
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
  report.keyboard = await evaluate(
    "({label: document.activeElement.getAttribute('aria-label'), outline: getComputedStyle(document.activeElement).outlineStyle})",
  )
  assert.ok(report.keyboard.label.includes('Relative Value'))
  assert.equal(report.keyboard.outline, 'solid')
  await evaluate("document.querySelector('.collapse-button').click()")
  await until(
    "Math.round(document.querySelector('.sidebar').getBoundingClientRect().width) === 80",
  )
  report.collapsed = await evaluate(
    "document.querySelector('.sidebar').getBoundingClientRect().width",
  )
  assert.equal(report.collapsed, 80)
  await evaluate("document.querySelector('.collapse-button').click()")
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await wait(300)
  report.mobile = await evaluate(
    "({ overflow: document.documentElement.scrollWidth > innerWidth, cards: document.querySelectorAll('.product-card').length, toggle: getComputedStyle(document.querySelector('.mobile-toggle')).display })",
  )
  assert.equal(report.mobile.overflow, false)
  assert.equal(report.mobile.toggle, 'block')
  await screenshot('overview-mobile.png')
  await evaluate("document.querySelector('.mobile-toggle').click()")
  await until(
    "document.querySelector('.sidebar').classList.contains('mobile-open')",
  )
  await evaluate(
    `document.querySelector('.sidebar nav a[href="/app/data-health"]').click()`,
  )
  await until("document.querySelector('.dh-summary') !== null")
  report.dataHealthNavigation = await evaluate('location.pathname')
  await send('Page.navigate', { url: 'http://localhost:5180/app' })
  await until("document.querySelectorAll('.product-card').length === 4")
  failPrices = true
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/prices*' }],
  })
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelectorAll('.product-card').length === 4 && document.body.innerText.includes('Price histories could not refresh')",
  )
  report.partialFailure = await evaluate(
    "({cards:document.querySelectorAll('.product-card').length,expiries:document.querySelectorAll('.expiry-scroll tbody tr').length,error:document.querySelector('.error-notice').innerText})",
  )
  assert.equal(report.partialFailure.cards, 4)
  assert.equal(report.partialFailure.expiries, 24)
  assert.ok(report.partialFailure.error.includes('HTTP 500'))
  failPrices = false
  await send('Fetch.disable')
  await send('Network.setBlockedURLs', {
    urls: ['http://localhost:8010/api/prices*'],
  })
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelectorAll('.product-card').length === 4 && document.querySelector('.chart-panel .source-badge')?.textContent === 'Offline snapshot'",
  )
  report.mixedSources = await evaluate(
    "[...document.querySelectorAll('.source-badge')].map(e=>e.textContent)",
  )
  assert.equal(
    report.mixedSources.filter((s) => s === 'Offline snapshot').length,
    1,
  )
  assert.ok(report.mixedSources.includes('API'))
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelectorAll('.product-card').length === 4 && [...document.querySelectorAll('.source-badge')].every(e => e.textContent === 'Offline snapshot')",
  )
  report.offline = await evaluate(
    "({cards: [...document.querySelectorAll('.product-price')].map(e=>e.textContent), sources: [...document.querySelectorAll('.source-badge')].map(e=>e.textContent), date: document.querySelector('.topbar-meta').innerText})",
  )
  await screenshot('overview-offline.png')
  report.client = await evaluate(`(async () => {
    const {createApiClient} = await import('/src/lib/api.ts');
    const client=createApiClient();
    let unavailable; try {await client.overview({purity:false})} catch(e) {unavailable=e.kind}
    const errors=[];
    for(const status of [422,500]) {
      let count=0;
      const mocked=createApiClient({fetcher:async()=>{count++;return new Response('{}',{status})}});
      try {await mocked.meta()} catch(e) {errors.push({status:e.status,kind:e.kind,count})}
    }
    return {unavailable,errors};
  })()`)
  assert.equal(report.client.unavailable, 'offline-unavailable')
  assert.deepEqual(report.client.errors, [
    { status: 422, kind: 'http', count: 1 },
    { status: 500, kind: 'http', count: 1 },
  ])
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Page.reload', { ignoreCache: true })
  await until(
    "document.querySelectorAll('.product-card').length === 4 && document.querySelector('.source-badge').textContent === 'API'",
  )
  report.runtimeExceptions = exceptions
  assert.equal(exceptions.length, 0)
  await writeFile(
    resolve(output, 'browser-verification.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await send('Fetch.disable')
  await send('Network.setBlockedURLs', { urls: [] })
  socket.close()
}
