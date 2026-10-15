import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
const out = fileURLToPath(
  new URL('../../docs/evidence/final-local-audit/', import.meta.url),
)
await mkdir(out, { recursive: true })
const targets = await (await fetch('http://localhost:9222/json/list')).json()
const ws = new WebSocket(
  targets.find((t) => t.type === 'page' && t.url.includes('5173'))
    .webSocketDebuggerUrl,
)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (m.id) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) p.reject(Error(JSON.stringify(m.error)))
    else p.resolve(m.result)
  }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.text)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text)
  return r.result.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  await writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64'))
}
await send('Page.enable')
await send('Runtime.enable')
await send('Page.bringToFront')
const installed = await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.auditMode='normal';window.auditRealFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{const u=String(input);if(u.startsWith('http://localhost:8010/')){if(window.auditMode==='outage')throw new TypeError('Audit simulated transport outage');if(u.includes('/api/spreads')&&window.auditMode==='error')return new Response(JSON.stringify({detail:'Temporary audit failure'}),{status:503,headers:{'Content-Type':'application/json'}});if(u.includes('/api/spreads')&&u.includes('carry_adjusted=false')&&window.auditMode==='comparisonDelay'){const r=await window.auditRealFetch(input,init);await new Promise(r=>setTimeout(r,2500));return r;}if(u.includes('/api/spreads')&&window.auditMode==='delay'){const r=await window.auditRealFetch(input,{...init,signal:undefined});const w=new URL(u).searchParams.get('window');await new Promise(r=>setTimeout(r,w==='5'?1300:w==='6'?800:80));return r;}}return window.auditRealFetch(input,init);};`,
})
process.on('uncaughtException', async (error) => {
  console.error(error)
  try {
    await send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: installed.identifier,
    })
    await send('Page.navigate', { url: 'http://localhost:5173/' })
  } finally {
    ws.close()
    process.exit(1)
  }
})

const report = {}
let completed = false
ws.addEventListener('close', async () => {
  if (completed) return
  await writeFile(
    out + '/browser-interrupted.json',
    JSON.stringify(
      {
        status: 'interrupted',
        reason: 'Browser debugging connection closed',
        report,
        errors,
      },
      null,
      2,
    ),
  )
  process.exit(2)
})
const assert = (v, s) => {
  if (!v) throw Error(s)
}
const until = async (expression) => {
  const end = Date.now() + 18000
  while (Date.now() < end) {
    if (await ev(`Boolean(${expression})`)) return
    await wait(100)
  }
  throw Error('Timed out ' + expression)
}
const nav = async (route) => {
  await send('Page.navigate', { url: 'http://localhost:5173' + route })
  await until(
    "document.querySelector('h1') && !document.querySelector('.crow-loading-state')",
  )
  await wait(500)
}
const select = async (label, value) =>
  ev(
    `(()=>{const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  )
const number = async (id, value) =>
  ev(
    `(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  )
const key = async (k, code = k, vk = 13) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k,
    code,
    windowsVirtualKeyCode: vk,
  })
  await wait(100)
}
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
await nav('/app/relative-value')
await until("document.querySelector('.rv-result-summary')")
await ev("window.auditMode='delay'")
await select('Window', '5')
await wait(80)
assert(
  await ev("!document.querySelector('.rv-result-summary')"),
  'Old result visible on loading',
)
await select('Window', '6')
await select('Pair', 'GOLDTEN-GOLDGUINEA')
await select('Window', '7')
await until(
  "document.querySelector('.rv-result-summary')?.innerText.includes('GOLDTEN-GOLDGUINEA') && !document.querySelector('.crow-loading-state')",
)
await wait(1500)
report.rapidSwitch = await ev(
  "({pair:document.querySelector('select[aria-label=Pair]').value,window:document.querySelector('select[aria-label=Window]').value,summary:document.querySelector('.rv-result-summary').innerText,details:document.querySelector('.basis-note').textContent})",
)
assert(
  report.rapidSwitch.window === '7' &&
    report.rapidSwitch.summary.includes('GOLDTEN-GOLDGUINEA'),
  'Old response overwrote final selection',
)
await ev("window.auditMode='error'")
await select('Window', '8')
await until(
  "document.querySelector('.error-notice') && !document.querySelector('.crow-loading-state')",
)
assert(
  await ev("!document.querySelector('.rv-result-summary')"),
  'Old result survived HTTP failure',
)
report.failedResponse = await ev(
  "document.querySelector('.error-notice').innerText",
)
await ev(
  "window.auditMode='normal'; document.querySelector('.error-notice button').click()",
)
await until(
  "document.querySelector('.rv-result-summary') && !document.querySelector('.error-notice') && !document.querySelector('.crow-loading-state')",
)
report.retryRecovered = true
await ev(
  `document.querySelector('[aria-label="Observation quality and historical chart values"] details summary').focus()`,
)
await key(' ', 'Space', 32)
report.chartTable = await ev(
  'document.querySelector(\'[aria-label="Observation quality and historical chart values"] details\').innerText',
)
assert(
  report.chartTable.includes('Rolling mean') &&
    report.chartTable.includes('Z-score'),
  'No chart table values',
)
await shot('relative-history-desktop')
await nav('/app/backtest')
await until("document.querySelector('.bt-summary')")
await key('Tab', 'Tab', 9)
report.keyboardFirst = await ev('document.activeElement.textContent')
await number('bt-z_entry', 0.5)
await number('bt-z_exit', 1)
await ev("document.querySelector('.bt-draft button[type=submit]').click()")
await until("document.getElementById('bt-validation')")
report.validation = await ev(
  "({text:document.getElementById('bt-validation').innerText,entry:{label:document.getElementById('bt-z_entry').getAttribute('aria-label'),invalid:document.getElementById('bt-z_entry').getAttribute('aria-invalid'),describedby:document.getElementById('bt-z_entry').getAttribute('aria-describedby')},exitInvalid:document.getElementById('bt-z_exit').getAttribute('aria-invalid'),previous:document.body.innerText.includes('Previous run—apply changes to update')})",
)
assert(
  report.validation.entry.invalid === 'true' &&
    report.validation.exitInvalid === 'true' &&
    report.validation.entry.label === 'Entry z threshold' &&
    report.validation.previous,
  'Validation accessibility',
)
await shot('backtest-validation-desktop')
await ev("document.getElementById('bt-z_entry').focus()")
await key('Tab', 'Tab', 9)
report.focus = await ev(
  "({tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outlineStyle,label:document.activeElement.getAttribute('aria-label')})",
)
assert(report.focus.outline !== 'none', 'No visible keyboard focus')
await ev(
  "[...document.querySelectorAll('button')].find(e=>e.textContent==='Reset to defaults').click();document.querySelector('.bt-draft button[type=submit]').click()",
)
await until(
  "document.querySelector('.bt-summary') && !document.querySelector('.crow-loading-state')",
)
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
})
await nav('/app/relative-value')
await until("document.querySelector('.rv-result-summary')")
await ev("document.querySelector('.mobile-toggle').click()")
await key('Escape', 'Escape', 27)
report.mobileMenu = await ev(
  "({expanded:document.querySelector('.mobile-toggle').getAttribute('aria-expanded'),focus:document.activeElement.className,width:innerWidth,scrollWidth:document.documentElement.scrollWidth})",
)
assert(
  report.mobileMenu.expanded === 'false' &&
    report.mobileMenu.scrollWidth <= 390,
  'Mobile navigation or overflow',
)
await ev(
  'document.querySelector(\'[aria-label="Observation quality and historical chart values"]\').focus()',
)
report.mobileTable = await ev(
  '({tabindex:document.activeElement.tabIndex,scrollable:document.activeElement.scrollWidth>document.activeElement.clientWidth})',
)
await key('ArrowRight', 'ArrowRight', 39)
await wait(200)
report.mobileTable.scrolled = await ev('document.activeElement.scrollLeft>0')
assert(report.mobileTable.scrolled, 'Keyboard cannot scroll history table')
await shot('relative-history-mobile')
await nav('/')
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
report.reducedMotion = await ev(
  "({matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animations:[...document.querySelectorAll('.auraxis-star-background>div')].map(e=>getComputedStyle(e).animationName)})",
)
assert(
  report.reducedMotion.animations.every((n) => n === 'none'),
  'Landing ignores reduced motion',
)
await send('Emulation.setEmulatedMedia', { features: [] })
await nav('/app')
report.dashboardParticles = await ev(
  "document.querySelectorAll('.auraxis-star-background>div').length",
)
assert(report.dashboardParticles === 3, 'Dashboard retains the requested star background')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
await nav('/app/relative-value')
await ev(
  "window.auditMode='outage';document.querySelector('.rv-toggle input').click()",
)
await until("document.querySelector('.source-badge.offline')")
report.offline = await ev(
  "({label:document.querySelector('.source-badge.offline').innerText,date:document.querySelector('.basis-note').innerText})",
)
await shot('offline-supported-desktop')
await select('Window', '11')
await until(
  "document.querySelector('.error-notice') && !document.querySelector('.crow-loading-state')",
)
report.offlineUnsupported = await ev(
  "document.querySelector('.error-notice').innerText",
)
assert(
  await ev("!document.querySelector('.rv-result-summary')"),
  'Unsupported fallback fabricated',
)
await shot('offline-unsupported-desktop')
await ev(
  "window.auditMode='normal';document.querySelector('.error-notice button:last-child').click()",
)
await until(
  "document.querySelector('.rv-result-summary') && !document.querySelector('.error-notice') && !document.querySelector('.crow-loading-state')",
)
report.offlineRetryRecovered = true
await nav('/app/relative-value')
await ev("window.auditMode='comparisonDelay'")
await select('Pair', 'GOLDM-GOLDTEN')
await until(
  "document.querySelector('.rv-result-summary')?.innerText.includes('GOLDM-GOLDTEN')",
)
await select('Fixed expiry', '2026-11-05')
await until(
  "document.querySelector('.rv-result-summary')?.innerText.includes('Loading comparison')",
)
report.comparisonLoading = true
await until(
  "document.querySelector('.rv-result-summary')?.innerText.includes('651.58') && document.querySelector('.rv-result-summary')?.innerText.includes('270.58')",
)
report.traceUI = await ev(
  "document.querySelector('.rv-result-summary').innerText",
)
assert(
  report.traceUI.includes('651.58') && report.traceUI.includes('270.58'),
  'Independent trace display mismatch',
)
await shot('representative-comparison-desktop')
await writeFile(
  out + '/browser-regression.json',
  JSON.stringify(
    { report, errors, viewports: ['1440x1000', '390x844 mobile emulation'] },
    null,
    2,
  ),
)
assert(errors.length === 0, 'Runtime exceptions')
console.log(
  JSON.stringify({ passed: Object.keys(report), runtimeExceptions: errors }),
)
await send('Page.removeScriptToEvaluateOnNewDocument', {
  identifier: installed.identifier,
})
completed = true
ws.close()
process.exit(0)
