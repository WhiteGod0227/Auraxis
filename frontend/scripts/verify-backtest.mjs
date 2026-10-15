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
    m.params.request.url.includes('/api/backtest')
  )
    requests.push(m.params.request.url)
})
async function control(label, value) {
  await evaluate(
    `(() => {const el=document.querySelector('select[aria-label="${label}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  )
}
async function input(label, value) {
  await evaluate(
    `(() => {const el=document.querySelector('input[type="number"][aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  )
}
async function submit(waitForResult = true) {
  await evaluate(
    "document.querySelector('.bt-draft button[type=submit]').click()",
  )
  if (waitForResult) await loaded()
}
async function loaded() {
  await until(
    "document.querySelectorAll('.bt-kpis .rv-reading').length===7 && document.querySelector('.bt-open') && !document.querySelector('.backtest-page .skeleton')",
  )
}
async function toggle() {
  await evaluate(
    "document.querySelector('.bt-controls input[type=checkbox]').click()",
  )
  await submit()
}
async function state() {
  return evaluate(
    "({expiry:document.querySelector('select[aria-label=\"Backtest expiry\"]')?.value,applied:document.querySelector('.bt-applied')?.innerText,kpis:Array.from(document.querySelectorAll('.bt-kpis .rv-reading')).map(e=>e.innerText),verdict:document.querySelector('.bt-api-verdict')?.innerText,open:document.querySelector('.bt-open')?.innerText,unresolved:document.querySelector('.bt-unresolved')?.innerText,cost:document.querySelector('.bt-cost')?.innerText})",
  )
}
async function captureSection(selector, name) {
  const clip = await evaluate(
    `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`,
  )
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip,
  })
  await writeFile(
    resolve(output, name),
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
  )
}
async function hover(selector) {
  await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
  )
  await wait(200)
  const p = await evaluate(
    `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width*.65,y:r.y+r.height*.45}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p })
  await until("document.querySelector('.ts-tooltip') !== null")
  return evaluate("document.querySelector('.ts-tooltip').innerText")
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
  await send('Page.navigate', { url: `${uiBase}/app/backtest` })
  await loaded()
  await until(
    "document.querySelectorAll('.backtest-page .recharts-wrapper').length===2",
  )
  report.default = await state()
  assert.equal(report.default.expiry, '2026-10-30')
  assert.ok(report.default.kpis[0].includes('0.00'))
  assert.ok(report.default.kpis[1].includes('991.70'))
  assert.ok(report.default.kpis[5].includes('Unavailable'))
  assert.ok(report.default.open.includes('Open positions (1)'))
  const apiDefault = await (
    await fetch('http://localhost:8010/api/backtest?pair=GOLDTEN-GOLDPETAL')
  ).json()
  report.defaultMetrics = apiDefault.reports.find(
    (r) => r.expiry === '2026-10-30',
  ).metrics
  await captureSection('.bt-summary', 'backtest-desktop-summary.png')
  report.equityTooltip = await hover('.bt-equity-chart .recharts-wrapper')
  assert.ok(report.equityTooltip.includes('Gross P&L:'))
  assert.ok(report.equityTooltip.includes('Mark quality:'))
  await screenshot('backtest-desktop.png')
  let count = requests.length
  await input('z_entry', 1.5)
  await wait(250)
  assert.equal(requests.length, count)
  assert.ok((await state()).applied.includes('z_entry 1;'))
  assert.ok(
    await evaluate(
      "document.querySelector('.bt-draft').innerText.includes('Edited - not applied')",
    ),
  )
  report.draftSeparate = true
  await submit()
  assert.ok(requests.at(-1).includes('z_entry=1.5'))
  assert.ok((await state()).applied.includes('z_entry 1.5;'))
  report.customSubmission = true
  count = requests.length
  await input('z_entry', 0.5)
  await input('z_exit', 0.5)
  await submit(false)
  await until(
    "document.querySelector('#bt-validation')?.innerText.includes('less than')",
  )
  assert.equal(requests.length, count)
  report.invalidZExit = true
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reset to defaults').click()",
  )
  await submit()
  await control('Backtest expiry', '2026-09-30')
  assert.equal(requests.length, count + 1)
  report.septemberPetal = await state()
  assert.ok(report.septemberPetal.kpis[0].includes('3,089.75'))
  assert.ok(
    await evaluate("document.querySelector('.bt-completed tbody tr')!==null"),
  )
  await evaluate(
    "document.querySelector('.bt-completed details summary').click()",
  )
  assert.ok(
    await evaluate(
      "document.querySelector('.bt-completed details').innerText.includes('fractional 10g units')",
    ),
  )
  for (const pair of ['GOLDTEN-GOLDGUINEA', 'GOLDGUINEA-GOLDPETAL']) {
    await control('Backtest pair', pair)
    await submit()
    await control('Backtest expiry', '2026-10-30')
    const actual = await state()
    report[pair] = actual
    assert.ok(actual.applied.includes(pair))
    if (pair === 'GOLDTEN-GOLDGUINEA') {
      assert.ok(actual.kpis[0].includes('1,113.96'))
      const exitZCells = await evaluate(
        "Array.from(document.querySelector('.bt-completed tbody tr').cells).map(c=>c.innerText)",
      )
      assert.equal(exitZCells[7], '0.23')
      assert.equal(exitZCells[8], '2.23')
      report.exitZRegression = {
        signal: exitZCells[7],
        execution: exitZCells[8],
      }

      assert.ok(actual.kpis[1].includes('2,180.39'))
      assert.ok(actual.cost.includes('2 bps per leg per side'))
      report.costTooltip = await hover('.bt-cost-chart .recharts-wrapper')
      assert.ok(report.costTooltip.includes('bps per leg per side'))
      assert.ok(report.costTooltip.includes('Completed-trade net P&L:'))
    } else assert.ok(actual.kpis[0].includes('2,207.57'))
  }
  await control('Backtest pair', 'GOLDTEN-GOLDGUINEA')
  await submit()
  await control('Backtest expiry', '2026-09-30')
  report.unresolvedExample = await state()
  assert.ok(
    report.unresolvedExample.unresolved.includes(
      'Unresolved-expiry positions (1)',
    ),
  )
  assert.ok(report.unresolvedExample.unresolved.includes('stale_expired'))
  assert.ok(report.unresolvedExample.open.includes('Open positions (0)'))
  assert.ok(
    await evaluate(
      "document.querySelector('.bt-orders').innerText.includes('2 attempts')",
    ),
  )
  report.unresolvedDistinct = true
  await control('Backtest expiry', '2027-03-31')
  report.zeroTradeExample = await state()
  assert.ok(report.zeroTradeExample.kpis[5].includes('Unavailable'))
  assert.ok(report.zeroTradeExample.cost.includes('no_completed_trades'))
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  for (const pair of [
    'GOLDTEN-GOLDPETAL',
    'GOLDTEN-GOLDGUINEA',
    'GOLDGUINEA-GOLDPETAL',
  ]) {
    await control('Backtest pair', pair)
    await submit()
    await until(
      "document.querySelector('.bt-applied .source-badge')?.innerText==='Offline snapshot'",
    )
    await toggle()
    assert.ok((await state()).applied.includes('purity false'))
    await toggle()
    assert.ok((await state()).applied.includes('purity true'))
  }
  report.offlinePairsBothPurities = true
  await input('cost_bps_per_leg_per_side', 6)
  await submit(false)
  await until(
    "document.body.innerText.includes('This configuration is unavailable offline.')",
  )
  assert.equal(
    await evaluate("document.querySelectorAll('.bt-kpis .rv-reading').length"),
    0,
  )
  assert.equal(
    await evaluate(
      'document.querySelector(\'input[aria-label="cost_bps_per_leg_per_side"]\').value',
    ),
    '6',
  )
  report.customOfflineUnavailable = true
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Load saved defaults').click()",
  )
  await loaded()
  assert.equal(
    await evaluate(
      'document.querySelector(\'input[aria-label="cost_bps_per_leg_per_side"]\').value',
    ),
    '5',
  )
  assert.ok((await state()).applied.includes('cost_bps_per_leg_per_side 5;'))
  report.savedDefaultsRestore = true
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*localhost:8010/api/backtest*' }],
  })
  for (const status of [422, 500]) {
    failures = { '/api/backtest': { status } }
    await submit(false)
    await until(
      `document.querySelector('.backtest-page [role="alert"]')?.innerText.includes('HTTP ${status}')`,
    )
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.bt-kpis .rv-reading').length",
      ),
      0,
    )
  }
  report.httpErrorsNotOffline = true
  failures = { '/api/backtest': { status: 200, body: {} } }
  await submit(false)
  await until(
    "document.querySelector('.backtest-page [role=alert]')?.innerText.includes('malformed or incompatible')",
  )
  report.malformedNotOffline = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry simulation').click()",
  )
  await loaded()
  await send('Fetch.disable')
  await control('Backtest pair', 'GOLDTEN-GOLDPETAL')
  await submit()
  await control('Backtest expiry', '2026-10-30')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await evaluate('window.scrollTo(0,0)')
  await wait(300)
  assert.equal(
    await evaluate('document.documentElement.scrollWidth>innerWidth'),
    false,
  )
  await screenshot('backtest-mobile.png')
  await evaluate(
    'document.querySelector(\'select[aria-label="Backtest pair"]\').focus()',
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
  report.keyboard = await evaluate(
    '({type:document.activeElement.type,outline:getComputedStyle(document.activeElement).outlineStyle})',
  )
  assert.equal(report.keyboard.type, 'checkbox')
  assert.notEqual(report.keyboard.outline, 'none')
  for (const [url, condition] of [
    ['/app', "document.querySelectorAll('.product-card').length===4"],
    [
      '/app/relative-value',
      "document.querySelectorAll('.rv-reading').length===8",
    ],
    [
      '/app/term-structure',
      "document.querySelector('.ts-latest') && document.querySelector('.ts-curve-table tbody tr')",
    ],
  ]) {
    await send('Page.navigate', { url: uiBase + url })
    await until(condition)
  }
  report.existingPagesPreserved = true
  assert.deepEqual(exceptions, [])
  report.runtimeExceptions = exceptions
  report.requests = requests
  await writeFile(
    resolve(output, 'backtest-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        defaultExpiry: report.default.expiry,
        defaultMetrics: report.defaultMetrics,
        offline: report.offlinePairsBothPurities,
        customOffline: report.customOfflineUnavailable,
        restoredDefaults: report.savedDefaultsRestore,
        unresolved: report.unresolvedDistinct,
        keyboard: report.keyboard,
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
