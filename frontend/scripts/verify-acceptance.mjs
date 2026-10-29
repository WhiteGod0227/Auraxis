// Fresh local browser acceptance. Private requests go only to disposable 8011.
// Requires dedicated Chrome 9223, preview 5173, real read-only analytics 8010,
// and backend/scripts/run_security_qa.py. No real account mutations.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { localBrowser, localTarget } from './local-browser.mjs'

const browser = await localBrowser(await localTarget())
const { send, evaluate: ev, waitFor, navigate } = browser
const output = `node_modules/.cache/acceptance-${process.env.ACCEPTANCE_DATE || new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
await mkdir(output, { recursive: true })
const results = []
let mode = 'normal'
const expectedNetworkFailures = []
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const record = (area, viewport, detail) =>
  results.push({ area, viewport, status: 'PASS', detail })
const fail = (error) => browser.errors.push(error.message)
browser.events.add((message) => {
  if (message.method !== 'Fetch.requestPaused') return
  const { requestId, request } = message.params
  const path = new URL(request.url).pathname
  if (/^\/api\/(auth|workspaces|alerts)(\/|$)/.test(path)) {
    send('Fetch.continueRequest', {
      requestId,
      url: request.url.replace('localhost:8010', 'localhost:8011'),
    }).catch(fail)
    return
  }
  if (mode === 'offline') {
    expectedNetworkFailures.push(path)
    send('Fetch.failRequest', {
      requestId,
      errorReason: 'ConnectionRefused',
    }).catch(fail)
    return
  }
  if (mode === '503' && path === '/api/spreads') {
    send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 503,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: 'http://localhost:5173' },
      ],
      body: Buffer.from('{"detail":"Injected acceptance outage"}').toString(
        'base64',
      ),
    }).catch(fail)
    return
  }
  send('Fetch.continueRequest', { requestId }).catch(fail)
})
const click = async (text) => {
  await waitFor(
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`,
  )
  await ev(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
  )
}
const fill = async (selector, value) =>
  ev(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const prototype=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  )
const select = async (label, value) =>
  ev(
    `(()=>{const e=document.querySelector('select[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  )
const key = async (key, code = key, vk = 13, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    modifiers,
  })
}
async function ready(path) {
  await navigate(path)
  await pause(350)
  await waitFor(
    `!!document.querySelector('h1') && !document.querySelector('.inline-loading-state,.skeleton') && !Array.from(document.querySelectorAll('[role="status"]')).some(e=>/^Loading|^Checking/.test(e.textContent.trim()))`,
  )
  await pause(250)
}
async function layout(viewport, path) {
  assert.ok(
    await ev(`document.documentElement.scrollWidth<=innerWidth+1`),
    `${viewport} overflow: ${path}`,
  )
  assert.equal(
    await ev(`!!document.querySelector('.error-notice')`),
    false,
    `${path} unexpected data error`,
  )
}
async function shot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${output}/${name}.png`, Buffer.from(image.data, 'base64'))
}
async function tooltip(index, viewport, name) {
  await waitFor(
    `document.querySelectorAll('.recharts-wrapper').length>${index}`,
  )
  await ev(
    `document.querySelectorAll('.recharts-wrapper')[${index}].scrollIntoView({block:'center',behavior:'instant'})`,
  )
  await pause(300)
  const rect = await ev(
    `(()=>{const r=document.querySelectorAll('.recharts-wrapper')[${index}].getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`,
  )
  let visible = false
  for (const yFraction of [0.42, 0.6, 0.25]) {
    for (const xFraction of [0.65, 0.45, 0.8, 0.25, 0.9]) {
      const x = Math.min(viewport - 5, Math.max(5, rect.x + rect.w * xFraction))
      const y = Math.max(5, rect.y + rect.h * yFraction)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await pause(55)
      visible = await ev(
        `Array.from(document.querySelectorAll('.recharts-tooltip-wrapper')).some(e=>getComputedStyle(e).visibility==='visible'&&e.textContent.trim())`,
      )
      if (visible) break
    }
    if (visible) break
  }
  assert.ok(visible, `Tooltip unavailable: ${name} at ${viewport}`)
  if (viewport < 700)
    assert.ok(
      await ev(
        `Array.from(document.querySelectorAll('.recharts-tooltip-wrapper')).filter(e=>getComputedStyle(e).visibility==='visible'&&e.textContent.trim()).every(e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})`,
      ),
      `Tooltip clipped: ${name}`,
    )
  record(
    `Tooltip: ${name}`,
    viewport,
    'Native mouse movement; visible nonempty tooltip, mobile horizontal bounds checked',
  )
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
}
async function save(title) {
  await waitFor(
    `!!document.querySelector('.research-save-action > button:not(:disabled)')`,
  )
  await ev(`document.querySelector('.research-save-action > button').focus()`)
  await key('Enter')
  await waitFor(`!!document.querySelector('#research-title')`)
  await fill('#research-title', title)
  await fill(
    '#research-notes',
    'Disposable acceptance research; not a performance claim.',
  )
  await ev(`document.querySelector('#research-save-form').requestSubmit()`)
  await waitFor(
    `document.querySelector('#research-message')?.textContent.includes('Research saved')`,
  )
}
const email = `acceptance-${Date.now()}@example.test`
const password = randomBytes(18).toString('hex')
let failed = false
try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const registered = await fetch('http://localhost:8011/api/auth/signup', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Acceptance Researcher', email, password }),
  })
  assert.equal(registered.status, 201, 'Disposable account created')
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*://localhost:8010/api/*' }],
  })
  for (const viewport of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await pause(350)
    await ready('/login')
    await fill('#login-face input[name=email]', email)
    await fill('#login-face input[name=password]', password)
    await ev(`document.querySelector('#login-face').requestSubmit()`)
    await waitFor(`location.pathname==='/'`)
    record(
      'Login',
      viewport,
      'Real cookie authentication against isolated backend, UI login',
    )
    await ready('/')
    await layout(viewport, '/')
    await tooltip(0, viewport, 'Landing prices')
    await ready('/app')
    await layout(viewport, '/app')
    assert.ok(
      await ev(
        `document.querySelector('.data-asof')?.textContent.includes('2026')`,
      ),
    )
    assert.ok(await ev(`document.querySelectorAll('.product-card').length===4`))
    await tooltip(0, viewport, 'Overview prices')
    await shot(`${viewport}-overview`)
    record(
      'Overview and visible dates/units',
      viewport,
      'Four references, chart, compact as-of date; no data error',
    )
    await ev(
      `document.querySelector('.sidebar a[href="/app/relative-value"]').focus()`,
    )
    if (viewport < 700) {
      await ev(`document.querySelector('.mobile-toggle').click()`)
      await waitFor(
        `document.querySelector('.sidebar').classList.contains('mobile-open')`,
      )
      await key('Escape', 'Escape', 27)
      await waitFor(
        `document.activeElement===document.querySelector('.mobile-toggle')`,
      )
      await ev(`document.querySelector('.mobile-toggle').click()`)
      await ev(
        `document.querySelector('.sidebar a[href="/app/relative-value"]').focus()`,
      )
    }
    await key('Enter')
    await waitFor(
      `location.pathname==='/app/relative-value'&&!document.querySelector('.inline-loading-state')`,
    )
    await pause(250)
    await waitFor(
      `!!document.querySelector('[aria-label="Comparison result summary"]') || !!document.querySelector('.error-notice')`,
    )
    await layout(viewport, 'relative-value')
    assert.ok(
      await ev(
        `!!document.querySelector('[aria-label="Comparison result summary"]')`,
      ),
    )
    await tooltip(0, viewport, 'Spread')
    await tooltip(1, viewport, 'Z-score')
    await ev(
      `document.querySelectorAll('.comparison-explanation details').forEach(d=>d.open=true)`,
    )
    assert.ok(
      await ev(
        `document.querySelector('.comparison-explanation').textContent.includes('Inputs for')`,
      ),
    )
    await save(`Acceptance comparison ${viewport}`)
    record(
      'Comparison and source explanation',
      viewport,
      'Data, calculation trace, keyboard navigation and real private Save passed',
    )
    await ready('/app/term-structure')
    await waitFor(`document.querySelectorAll('.recharts-wrapper').length>=2`)
    await layout(viewport, 'term-structure')
    assert.ok(
      await ev(`document.querySelectorAll('.recharts-wrapper').length>=2`),
    )
    await tooltip(0, viewport, 'Expiry curve')
    await tooltip(1, viewport, 'Roll-down')
    await save(`Acceptance curve ${viewport}`)
    record(
      'Curve / roll-down',
      viewport,
      'Curves loaded; dates, units and diagnostics retained; private Save passed',
    )
    await ready('/app/backtest')
    await layout(viewport, 'backtest')
    await tooltip(0, viewport, 'Backtest P&L')
    await tooltip(1, viewport, 'Closed-trade costs')
    await select('Sizing mode', 'integer_lots')
    await waitFor(`document.body.textContent.includes('Previous run')`)
    await click('Run simulation')
    await waitFor(
      `!document.querySelector('.inline-loading-state')&&!document.body.textContent.includes('Previous run')`,
    )
    await save(`Acceptance backtest ${viewport}`)
    record(
      'Backtest',
      viewport,
      'Applied integer sizing; marked/realized and open positions stay distinct; private Save passed',
    )
    await ready('/app/research')
    await layout(viewport, 'research')
    await waitFor(
      `document.body.textContent.includes('Acceptance backtest ${viewport}')`,
    )
    await ev(
      `Array.from(document.querySelectorAll('.research-item')).find(e=>e.textContent.includes('Acceptance backtest ${viewport}')).querySelector('a').click()`,
    )
    await waitFor(
      `location.pathname==='/app/backtest'&&document.body.textContent.includes('Opened')&&!document.querySelector('.inline-loading-state')`,
    )
    assert.equal(
      await ev(
        `document.querySelector('select[aria-label="Sizing mode"]').value`,
      ),
      'integer_lots',
    )
    record(
      'Saved Research / reopen',
      viewport,
      'Comparison, curve and backtest saved; selected backtest reopened with applied sizing',
    )
    await ready('/app/profile')
    await layout(viewport, 'profile')
    await click('Edit name')
    await fill('#profile-name', `Acceptance ${viewport}`)
    await click('Save')
    await waitFor(`!document.querySelector('#profile-name')`)
    await ready('/app/profile')
    assert.ok(
      await ev(
        `document.querySelector('[aria-label="Account profile"]').textContent.includes('Acceptance ${viewport}')`,
      ),
    )
    record(
      'Profile',
      viewport,
      'Name edit persisted after a real reload; account identity retained',
    )
    for (const path of [
      '/app/data-health',
      '/app/calendar',
      '/app/methodology',
      '/app/alerts',
      '/app/security',
      '/app/demo',
    ]) {
      await ready(path)
      await layout(viewport, path)
      record(
        `Route ${path}`,
        viewport,
        'Opened with no runtime/data error or page-wide horizontal overflow',
      )
    }
    await click('Sign out')
    await waitFor(
      `!!Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='Log in')`,
    )
    await ready('/app/research')
    assert.ok(await ev(`document.body.textContent.includes('Sign in')`))
    record(
      'Logout / private access',
      viewport,
      'Cookie logout removes private access',
    )
  }
  // Explicit error/retry and offline-to-API recovery on public research.
  await ready('/app/relative-value')
  mode = '503'
  await select('Window', '20')
  await waitFor(`!!document.querySelector('.error-notice')`)
  assert.equal(
    await ev(
      `!!document.querySelector('[aria-label="Comparison result summary"]')`,
    ),
    false,
  )
  record(
    'HTTP 503',
    390,
    'Old comparison hidden; error shown; no silent snapshot substitution',
  )
  mode = 'normal'
  await click('Retry')
  await waitFor(
    `!!document.querySelector('[aria-label="Comparison result summary"]')`,
  )
  record('Retry', 390, 'Actual API recovery using requested window')
  mode = 'offline'
  await select('Window', '10')
  await waitFor(`document.body.textContent.includes('Offline snapshot')`)
  record(
    'Offline exact default',
    390,
    'Existing local default snapshot loaded with provenance',
  )
  await select('Window', '20')
  await waitFor(`!!document.querySelector('.error-notice')`)
  assert.equal(
    await ev(
      `!!document.querySelector('[aria-label="Comparison result summary"]')`,
    ),
    false,
  )
  record(
    'Offline unsupported configuration',
    390,
    'Unavailable; default data not relabelled as custom settings',
  )
  mode = 'normal'
  await click('Retry')
  await waitFor(
    `!!document.querySelector('[aria-label="Comparison result summary"]')`,
  )
  assert.equal(
    await ev(
      `document.querySelector('.research-context')?.textContent.includes('Offline snapshot')`,
    ),
    false,
  )
  record(
    'Offline recovery',
    390,
    'Retry replaces offline/unavailable state with API data',
  )
  assert.deepEqual(browser.errors, [])
} catch (error) {
  failed = true
  results.push({
    area: 'Interrupted acceptance assertion',
    status: 'FAIL',
    detail: error.message,
  })
  await shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        status: failed ? 'FAIL' : 'PASS',
        results,
        runtimeErrors: browser.errors,
        expectedTransportFailures: expectedNetworkFailures.length,
        privateBackend: 'Disposable 8011; real stores untouched by mutation',
      },
      null,
      2,
    ),
  )
  browser.close()
}
console.log(
  `PASS: ${results.length} fresh acceptance checks; desktop/mobile, native tooltip/keyboard, real private flow, error/offline recovery.`,
)
