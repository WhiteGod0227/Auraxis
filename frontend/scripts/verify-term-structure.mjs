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
    /\/api\/(curve|rolldown)/.test(m.params.request.url)
  )
    requests.push(m.params.request.url)
})
async function control(label, value) {
  await evaluate(
    `(() => {const el=document.querySelector('select[aria-label="${label}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  )
}
async function toggle(waitForResources = true) {
  await evaluate("document.querySelector('.ts-controls input').click()")
  if (waitForResources) await loaded()
}
async function loaded() {
  await until(
    "document.querySelector('.ts-curve-table tbody tr') && document.querySelector('.ts-latest') && !document.querySelector('.term-structure-page .skeleton')",
  )
}
async function state() {
  return evaluate(
    "({curveRows:document.querySelectorAll('.ts-curve-table tbody tr').length,curveDate:document.querySelector('select[aria-label=\"Curve date\"]').value,rollExpiry:document.querySelector('select[aria-label=\"Roll-down contract\"]').value,curveText:document.querySelector('.ts-curve-section').innerText,rollText:document.querySelector('.ts-roll-section').innerText})",
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
  const point = await evaluate(
    `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
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
  await send('Page.navigate', {
    url: `${uiBase}/app/term-structure`,
  })
  await loaded()
  await until("document.querySelectorAll('.recharts-wrapper').length===2")
  report.default = await state()
  assert.equal(report.default.curveRows, 6)
  assert.equal(report.default.rollExpiry, '2026-10-30')
  assert.ok(report.default.curveText.includes('01 Oct 2026'))
  assert.ok(
    report.default.rollText.includes('13 observations; 13 valid; 0 invalid'),
  )
  const apiCurve = await (
    await fetch('http://localhost:8010/api/curve?product=GOLDTEN')
  ).json()
  const apiRoll = await (
    await fetch('http://localhost:8010/api/rolldown?product=GOLDTEN')
  ).json()
  const october = apiRoll.series.find((s) => s.expiry_date === '2026-10-30')
  report.realLatest = october.rows.at(-1)
  assert.equal(report.realLatest.raw_change, 1114)
  assert.ok(
    Math.abs(report.realLatest.estimated_roll_down + 42.61290322580645) < 1e-10,
  )
  report.curveTooltip = await hover(
    '.ts-curve-chart .recharts-line-dots circle',
  )
  assert.ok(report.curveTooltip.includes('calendar days to expiry'))
  assert.ok(report.curveTooltip.includes('grams'))
  assert.ok(report.curveTooltip.includes('has_trade'))
  await captureSection('.ts-curve-section', 'term-structure-desktop-curve.png')
  report.rollTooltip = await hover('.ts-roll-chart .recharts-bar-rectangle')
  assert.ok(report.rollTooltip.includes('Previous:'))
  assert.ok(report.rollTooltip.includes('Next expiry:'))
  await captureSection(
    '.ts-roll-section',
    'term-structure-desktop-rolldown.png',
  )
  const beforePointSelection = requests.length
  await control('Curve contract', apiCurve.points[1].expiry_date)
  assert.equal(
    await evaluate(
      `document.querySelector('select[aria-label="Curve contract"]').value`,
    ),
    apiCurve.points[1].expiry_date,
  )
  assert.equal(requests.length, beforePointSelection)
  await control('Curve contract', apiCurve.points[0].expiry_date)
  for (const product of ['GOLDM', 'GOLDGUINEA', 'GOLDPETAL', 'GOLDTEN']) {
    await control('Product', product)
    await loaded()
    assert.ok((await state()).curveText.includes('Applied product: ' + product))
    if (product === 'GOLDGUINEA') {
      await control('Curve contract', '2027-03-31')
      assert.ok(
        await evaluate(
          `document.querySelector('.ts-selected-contract').innerText.includes('has_trade: false')`,
        ),
      )
      assert.ok(
        await evaluate(
          `document.querySelector('.ts-curve-chart circle[stroke="#9AA6B8"]') !== null`,
        ),
      )
      report.untradedHollowMarker = true
    }

    await toggle()
    assert.ok(
      requests.some(
        (url) =>
          url.includes('product=' + product) && url.includes('purity=false'),
      ),
    )
    await toggle()
  }
  await control('Curve date', '2026-09-30')
  await loaded()
  report.historical = await state()
  assert.equal(
    report.historical.curveRows,
    (
      await (
        await fetch(
          'http://localhost:8010/api/curve?product=GOLDTEN&date=2026-09-30',
        )
      ).json()
    ).points.length,
  )
  assert.ok(
    report.historical.curveText.includes('Curve observation: 30 Sept 2026'),
  )
  assert.ok(report.historical.rollText.includes('01 Oct 2026'))
  assert.ok(requests.at(-1).includes('date=2026-09-30'))
  let count = requests.filter((url) => url.includes('/rolldown')).length
  await control('Roll-down contract', '2026-09-30')
  report.invalid = await state()
  assert.ok(
    report.invalid.rollText.includes(
      'Decomposition unavailable: missing_observation',
    ),
  )
  assert.ok(
    report.invalid.rollText.includes('13 observations; 12 valid; 1 invalid'),
  )
  assert.equal(
    requests.filter((url) => url.includes('/rolldown')).length,
    count,
  )
  await control(
    'Roll-down contract',
    apiRoll.series.find((s) => s.rows.at(-1).reason === 'no_next_expiry')
      .expiry_date,
  )
  assert.ok((await state()).rollText.includes('no_next_expiry'))
  await control('Roll-down contract', '2026-10-30')
  await control('Curve date', '')
  await loaded()
  await send('Network.setBlockedURLs', {
    urls: ['http://localhost:8010/api/curve*'],
  })
  await toggle()
  await until(
    "document.querySelector('.ts-curve-section .source-badge')?.innerText==='Offline snapshot'",
  )
  report.mixed = await state()
  assert.ok(report.mixed.rollText.includes('API'))
  assert.ok(report.mixed.curveText.includes('Offline snapshot'))
  await control('Curve date', '2026-09-30')
  await until(
    "document.body.innerText.includes('This historical curve is unavailable offline.')",
  )
  report.historicalOffline = await state()
  assert.equal(report.historicalOffline.curveRows, 0)
  assert.equal(report.historicalOffline.curveDate, '2026-09-30')
  assert.ok(
    report.historicalOffline.rollText.includes('Latest returned observation'),
  )
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Show latest saved curve')).click()",
  )
  await loaded()
  assert.equal((await state()).curveDate, '')
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  for (const product of ['GOLDTEN', 'GOLDM', 'GOLDGUINEA', 'GOLDPETAL']) {
    await control('Product', product)
    await loaded()
    await toggle()
    assert.equal(
      await evaluate(
        "document.querySelector('.ts-curve-section .source-badge').innerText",
      ),
      'Offline snapshot',
    )
    assert.equal(
      await evaluate(
        "document.querySelector('.ts-roll-section .source-badge').innerText",
      ),
      'Offline snapshot',
    )
    await toggle()
  }
  report.offlineAllProductsBothPurities = true
  await send('Network.setBlockedURLs', { urls: [] })
  await control('Product', 'GOLDTEN')
  await loaded()
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*localhost:8010/api/curve*' },
      { urlPattern: '*localhost:8010/api/rolldown*' },
    ],
  })
  failures = { '/api/curve': { status: 500 } }
  await toggle(false)
  await until(
    "document.querySelector('.ts-curve-section').innerText.includes('HTTP 500') && document.querySelector('.ts-latest')",
  )
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.ts-curve-table tbody tr').length",
    ),
    0,
  )
  report.partialCurveFailure = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry curve').click()",
  )
  await loaded()
  failures = { '/api/rolldown': { status: 422 } }
  await toggle(false)
  await until(
    "document.querySelector('.ts-roll-section').innerText.includes('HTTP 422') && document.querySelector('.ts-curve-table tbody tr')",
  )
  assert.equal(
    await evaluate("document.querySelectorAll('.ts-latest').length"),
    0,
  )
  report.partialRollFailure = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry roll-down').click()",
  )
  await loaded()
  failures = { '/api/curve': { status: 200, body: {} } }
  await toggle(false)
  await until(
    "document.querySelector('.ts-curve-section').innerText.includes('malformed or incompatible')",
  )
  report.malformedNotOffline = true
  failures = {}
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry curve').click()",
  )
  await loaded()
  const empty = {
    ...apiCurve,
    configuration: { ...apiCurve.configuration, use_purity_adjustment: false },
    selected_date: null,
    points: [],
    data_available: false,
    message: 'No matching observations for the requested selection.',
  }
  failures = { '/api/curve': { status: 200, body: empty } }
  await toggle(false)
  await until(
    "document.querySelector('.ts-curve-section .empty-state') && document.querySelector('.ts-latest')",
  )
  assert.ok(await evaluate("document.querySelector('.ts-latest')!==null"))
  report.emptyCurve = true
  failures = {}
  await toggle(false)
  await loaded()
  await send('Fetch.disable')
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
  await screenshot('term-structure-mobile.png')
  await evaluate(
    'document.querySelector(\'select[aria-label="Product"]\').focus()',
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
    "({label:document.activeElement.getAttribute('aria-label'),outline:getComputedStyle(document.activeElement).outlineStyle})",
  )
  assert.equal(report.keyboard.label, 'Curve date')
  assert.notEqual(report.keyboard.outline, 'none')
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  assert.ok(
    await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),
  )
  report.reducedMotion = true
  await send('Page.navigate', { url: `${uiBase}/app` })
  await until("document.querySelectorAll('.product-card').length===4")
  report.overviewPreserved = true
  await send('Page.navigate', {
    url: `${uiBase}/app/relative-value`,
  })
  await until("document.querySelectorAll('.rv-reading').length===8")
  report.relativeValuePreserved = true
  assert.deepEqual(exceptions, [])
  report.runtimeExceptions = exceptions
  report.requests = requests
  await writeFile(
    resolve(output, 'term-structure-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify(
      {
        defaultCurveDate: apiCurve.selected_date,
        defaultPoints: apiCurve.points.length,
        latest: report.realLatest,
        apiWideCounts: {
          valid: apiRoll.valid_count,
          invalid: apiRoll.invalid_count,
        },
        offline: report.offlineAllProductsBothPurities,
        partialFailures:
          report.partialCurveFailure && report.partialRollFailure,
        keyboard: report.keyboard,
        regressions: report.overviewPreserved && report.relativeValuePreserved,
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
