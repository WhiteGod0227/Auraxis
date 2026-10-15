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
            value: uiBase,
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
const requests = []
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (
    m.method === 'Network.requestWillBeSent' &&
    m.params.request.url.includes('/api/spreads')
  )
    requests.push(m.params.request.url)
})
async function control(label, value) {
  await evaluate(
    `(() => { const el=document.querySelector('select[aria-label="${label}"]'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
  )
}
async function loaded() {
  await until(
    "document.querySelectorAll('.rv-reading').length === 8 && !document.querySelector('.skeleton')",
  )
}
async function toggle(label) {
  await evaluate(
    `Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(label)})).querySelector('input').click()`,
  )
  await loaded()
}
async function reading() {
  return evaluate(
    "({expiry:document.querySelector('select[aria-label=\"Fixed expiry\"]').value, readings:Array.from(document.querySelectorAll('.rv-reading')).map(e=>e.innerText), text:document.querySelector('.relative-value-page').innerText})",
  )
}
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
  await send('Page.navigate', {
    url: `${uiBase}/app/relative-value`,
  })
  await loaded()
  await until("document.querySelectorAll('.recharts-wrapper').length === 2")
  report.default = await reading()
  assert.equal(report.default.expiry, '2026-10-30')
  assert.ok(report.default.readings[2].includes('584'))
  await evaluate(
    "document.querySelector('.recharts-wrapper').scrollIntoView({block:'center'})",
  )
  await wait(200)
  const plot = await evaluate(
    "(() => {const r=document.querySelector('.recharts-wrapper').getBoundingClientRect(); return {x:r.x+r.width*0.65,y:r.y+r.height*0.45}})()",
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...plot })
  await until(
    "Array.from(document.querySelectorAll('.recharts-tooltip-wrapper')).some(e=>getComputedStyle(e).visibility==='visible')",
  )
  report.tooltip = await evaluate(
    "Array.from(document.querySelectorAll('.recharts-tooltip-wrapper')).filter(e=>getComputedStyle(e).visibility==='visible').map(e=>e.innerText)",
  )
  assert.ok(report.tooltip[0].includes('2026'))
  await screenshot('relative-value-desktop.png')
  await control('Fixed expiry', '2026-11-30')
  assert.equal((await reading()).expiry, '2026-11-30')
  await toggle('Purity adjustment')
  assert.equal((await reading()).expiry, '2026-11-30')
  assert.ok(requests.at(-1).includes('purity=false'))
  await toggle('Purity adjustment')
  for (const pair of [
    'GOLDTEN-GOLDGUINEA',
    'GOLDGUINEA-GOLDPETAL',
    'GOLDM-GOLDGUINEA',
    'GOLDM-GOLDPETAL',
    'GOLDM-GOLDTEN',
  ]) {
    await control('Pair', pair)
    await loaded()
    assert.ok((await reading()).text.includes(pair))
  }
  await control('Fixed expiry', '2026-11-05')
  report.goldmCarryOn = await reading()
  assert.ok(report.goldmCarryOn.text.includes('Analytics only'))
  assert.ok(report.goldmCarryOn.text.includes('executable_pair=false'))
  await toggle('Carry-adjusted comparison')
  report.goldmCarryOff = await reading()
  assert.equal(report.goldmCarryOff.expiry, report.goldmCarryOn.expiry)
  assert.ok(requests.at(-1).includes('carry_adjusted=false'))
  await control('Window', '11')
  await loaded()
  assert.ok(requests.at(-1).includes('window=11'))
  assert.ok((await reading()).text.includes('window 11'))
  await control('Window', '10')
  await loaded()
  await send('Network.setBlockedURLs', { urls: ['http://localhost:8010/*'] })
  await toggle('Purity adjustment')
  await until(
    "document.querySelector('.relative-value-page .source-badge')?.innerText === 'Offline snapshot'",
  )
  report.offlineCarryOff = await reading()
  assert.ok(
    report.offlineCarryOff.text.includes('purity false; carry_adjusted false'),
  )
  await toggle('Carry-adjusted comparison')
  report.offlineCarryOn = await reading()
  assert.ok(
    report.offlineCarryOn.text.includes('purity false; carry_adjusted true'),
  )
  await toggle('Purity adjustment')
  report.offlinePurityTrue = await reading()
  await control('Pair', 'GOLDTEN-GOLDPETAL')
  await loaded()
  assert.equal((await reading()).expiry, '2026-10-30')
  await control('Window', '11')
  await until(
    "document.body.innerText.includes('This configuration is unavailable offline')",
  )
  assert.equal(
    await evaluate("document.querySelectorAll('.rv-reading').length"),
    0,
  )
  report.offlineUnavailable = true
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Restore default window')).click()",
  )
  await loaded()
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await wait(300)
  assert.equal(
    await evaluate('document.documentElement.scrollWidth > innerWidth'),
    false,
  )
  await screenshot('relative-value-mobile.png')
  await evaluate(
    'document.querySelector(\'select[aria-label="Pair"]\').focus()',
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
  assert.equal(report.keyboard.label, 'Fixed expiry')
  assert.notEqual(report.keyboard.outline, 'none')
  await send('Network.setBlockedURLs', { urls: [] })
  await send('Page.navigate', { url: `${uiBase}/app` })
  await until("document.querySelectorAll('.product-card').length===4")
  report.overviewPreserved = true
  report.requests = requests
  assert.deepEqual(exceptions, [])
  await writeFile(
    resolve(output, 'relative-value-report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  await send('Network.setBlockedURLs', { urls: [] })
  socket.close()
}
