// Requires a dedicated Chrome CDP session on 9223 and existing local services.
// All private auth/workspace requests are intercepted; real accounts are never mutated.
// Public analytics use local API data and authorized local offline exports.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const targets = await (await fetch('http://localhost:9223/json/list')).json()
const ws = new WebSocket(
  targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errors = []
let signedIn = false
let saved
let mode = 'online'
let loadCount = 0
const user = { id: 999, name: 'Demo QA', email: 'demo@example.test' }
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (m.method === 'Page.loadEventFired') loadCount++
  if (m.id) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) p.reject(m.error)
    else p.resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.text)
  if (m.method === 'Fetch.requestPaused')
    handle(m.params).catch((e) => errors.push(e.message))
})
async function handle({ requestId, request }) {
  const path = new URL(request.url).pathname
  const headers = [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Access-Control-Allow-Origin', value: 'http://localhost:5173' },
    { name: 'Access-Control-Allow-Credentials', value: 'true' },
    { name: 'Access-Control-Allow-Headers', value: 'content-type' },
    {
      name: 'Access-Control-Allow-Methods',
      value: 'GET,POST,PATCH,DELETE,OPTIONS',
    },
  ]
  const reply = (body, status = 200) =>
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: headers,
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    })
  if (request.method === 'OPTIONS') return reply({}, 204)
  if (path.startsWith('/api/auth/')) {
    if (path.endsWith('/login') || path.endsWith('/signup')) signedIn = true
    if (path.endsWith('/logout')) {
      signedIn = false
      return reply({}, 204)
    }
    return signedIn
      ? reply({ user })
      : reply({ detail: 'Not authenticated' }, 401)
  }
  if (path.startsWith('/api/workspaces')) {
    if (request.method === 'POST') {
      saved = {
        ...JSON.parse(request.postData),
        id: '00112233-4455-4677-8899-aabbccddeeff',
        owner_id: 999,
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      return reply(saved, 201)
    }
    return reply(
      path === '/api/workspaces'
        ? {
            items: saved ? [saved] : [],
            total: saved ? 1 : 0,
            limit: 20,
            offset: 0,
          }
        : saved,
    )
  }
  if (mode === 'empty' || (mode === 'mismatch' && path === '/api/backtest')) {
    const payload = await (await fetch(request.url)).json()
    if (mode === 'empty') {
      payload.data_available = false
      payload.data_as_of = null
      payload.message = 'No permitted data loaded.'
      if (path === '/api/spreads') payload.series = []
      else payload.reports = []
    } else payload.data_as_of = '2000-01-01'
    return reply(payload)
  }
  if (mode === 'offline')
    return send('Fetch.failRequest', {
      requestId,
      errorReason: 'ConnectionRefused',
    })
  if (mode === 'error') return reply({ detail: 'Injected failure' }, 503)
  return send('Fetch.continueRequest', { requestId })
}
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text)
  return r.result.value
}
const waitFor = async (expression) => {
  for (let i = 0; i < 100; i++) {
    if (await ev(expression)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('Timed out: ' + expression)
}
const navigate = async (path) => {
  const previousLoad = loadCount
  await send('Page.navigate', { url: 'http://localhost:5173' + path })
  for (let i = 0; loadCount === previousLoad && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(loadCount > previousLoad, 'New document finished loading')
  await waitFor(`!!document.querySelector('.demo-page')`)
  await waitFor(`!document.querySelector('.inline-loading-state')`)
}
await send('Runtime.enable')
await send('Page.enable')
await send('Fetch.enable', {
  patterns: [
    { urlPattern: '*://localhost:8010/api/auth/*' },
    { urlPattern: '*://localhost:8010/api/workspaces*' },
    { urlPattern: '*://localhost:8010/api/spreads*' },
    { urlPattern: '*://localhost:8010/api/backtest*' },
  ],
})
const output = 'node_modules/.cache/demo-review'
await mkdir(output, { recursive: true })
for (const width of [1440, 390, 320]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await navigate('/app/demo')
  const expiry = await ev(
    `document.querySelector('.demo-context select').value`,
  )
  assert.ok(expiry)
  assert.equal(
    await ev(`document.querySelectorAll('.demo-metrics dd').length`),
    3,
  )
  for (const step of [2, 3, 4]) {
    await ev(
      `document.querySelectorAll('.demo-steps button')[${step - 1}].click()`,
    )
    await waitFor(
      `new URLSearchParams(location.search).get('step')==='${step}'`,
    )
    assert.equal(
      await ev(`document.querySelector('.demo-context select').value`),
      expiry,
    )
    assert.equal(await ev(`document.activeElement.id`), 'demo-step-heading')
    assert.ok(await ev(`document.documentElement.scrollWidth<=innerWidth+1`))
    if (step === 2) {
      await ev(
        `document.querySelectorAll('.comparison-explanation details').forEach(d=>d.open=true)`,
      )
      assert.ok(
        await ev(
          `document.querySelector('.comparison-explanation').textContent.includes('Inputs for')`,
        ),
      )
    }
    if (step === 3) {
      assert.ok(
        await ev(
          `document.querySelector('.demo-stage').textContent.includes('completed trades')`,
        ),
      )
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(
        output + '/' + width + '-costs.png',
        Buffer.from(shot.data, 'base64'),
      )
    }
  }
}
await navigate('/app/demo?step=4&expiry=2026-10-30')
await waitFor(`!!document.querySelector('.research-save a[href^="/login"]')`)
await ev(`document.querySelector('.research-save a[href^="/login"]').click()`)
await waitFor(`!!document.querySelector('#login-face')`)
await ev(
  `document.querySelector('#login-face input[name=email]').value='demo@example.test'; document.querySelector('#login-face input[name=password]').value='test-only-password';document.querySelector('#login-face').requestSubmit()`,
)
await waitFor(
  `location.pathname==='/app/demo' && new URLSearchParams(location.search).get('step')==='4'`,
)
await waitFor(
  `!!document.querySelector('.research-save-action > button:not(:disabled)')`,
)
assert.equal(
  await ev(`new URLSearchParams(location.search).get('expiry')`),
  '2026-10-30',
)
await ev(`document.querySelector('.research-save-action > button').click()`)
await waitFor(`!!document.querySelector('#research-title')`)
await ev(
  `const input=document.querySelector('#research-title');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Demo cost research');input.dispatchEvent(new Event('input',{bubbles:true}))`,
)
await ev(`document.querySelector('#research-save-form').requestSubmit()`)
await waitFor(
  `document.querySelector('#research-message')?.textContent.includes('Research saved')`,
)
assert.equal(saved.configuration.kind, 'backtest')
assert.equal(saved.configuration.expiry.value, '2026-10-30')
assert.equal(saved.configuration.query.purity, false)
await ev(`document.querySelector('#research-save-form a').click()`)
await waitFor(`document.body.textContent.includes('Demo cost research')`)
await ev(
  `document.querySelector('a[href^="/app/backtest?workspace="]').click()`,
)
await waitFor(
  `location.pathname==='/app/backtest' && document.body.textContent.includes('Opened') && !document.querySelector('.inline-loading-state')`,
)
assert.ok(await ev(`document.body.textContent.includes('Demo cost research')`))
assert.ok(
  await ev(
    `Array.from(document.querySelectorAll('select')).some(s=>s.value==='2026-10-30')`,
  ),
)
mode = 'offline'
await navigate('/app/demo?step=3')
assert.ok(
  await ev(
    `document.querySelector('.demo-stage').textContent.includes('Offline snapshot')`,
  ),
)
mode = 'online'
await navigate('/app/demo?step=1&expiry=2099-01-01')
assert.ok(
  await ev(`document.body.textContent.includes('No shared result exists')`),
)
assert.equal(
  await ev(`document.querySelector('.demo-context select').value`),
  '2099-01-01',
)
mode = 'error'
await navigate('/app/demo?step=3')
assert.ok(
  await ev(`document.body.textContent.includes('Simulation unavailable')`),
)
assert.equal(
  await ev(`document.querySelectorAll('.demo-metrics dd').length`),
  0,
)
mode = 'online'
await ev(
  `Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='Retry simulation'||b.textContent==='Retry comparison').forEach(b=>b.click())`,
)
await waitFor(`document.querySelectorAll('.demo-metrics dd').length===3`)
mode = 'empty'
await navigate('/app/demo?step=4')
assert.ok(
  await ev(`document.body.textContent.includes('No shared result exists')`),
)
assert.equal(
  await ev(
    `document.querySelector('.research-save-action > button')?.disabled`,
  ),
  true,
)
mode = 'mismatch'
await navigate('/app/demo?step=4')
assert.ok(
  await ev(
    `document.body.textContent.includes('different source versions or data dates')`,
  ),
)
assert.equal(
  await ev(
    `document.querySelector('.research-save-action > button')?.disabled`,
  ),
  true,
)
assert.deepEqual(errors, [])
await writeFile(
  output + '/results.json',
  JSON.stringify(
    {
      route: 'demo',
      widths: [1440, 390, 320],
      steps: 4,
      loginReturn: 'passed (intercepted private API)',
      saveAndList: 'passed (intercepted private API)',
      reopen: 'passed with selected expiry (intercepted private API)',
      offline: 'passed with existing local exports',
      unavailableExpiry: 'preserved',
      HTTP503: 'no snapshot substitution',
      recovery: 'passed',
      emptyData: 'unavailable; saving disabled',
      mismatchedData: 'warning; saving disabled',
      runtimeErrors: errors,
    },
    null,
    2,
  ),
)
console.log(
  'PASS: demo steps/expiry/calculation/mobile; intercepted login/save/list; exact local offline; unavailable expiry; HTTP 503/recovery; no runtime exceptions',
)
ws.close()
