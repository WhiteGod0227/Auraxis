import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { localBrowser, localTarget } from './local-browser.mjs'

const browser = await localBrowser(await localTarget())
const { send, evaluate, waitFor, navigate } = browser
let outage = false
browser.events.add((message) => {
  if (message.method !== 'Fetch.requestPaused') return
  const requestId = message.params.requestId
  const promise = outage
    ? send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' })
    : send('Fetch.continueRequest', { requestId })
  promise.catch((error) => browser.errors.push(error.message))
})
try {
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*://localhost:8010/api/spreads*' }],
  })
  await navigate('/app/alerts')
  await waitFor(`!!document.querySelector('form.alert-form')`)
  // Dedicated QA profile: clear only this feature's rule store.
  await evaluate(`localStorage.removeItem('auraxis.research-alerts.v1')`)
  await navigate('/app/alerts')
  await waitFor(`document.body.textContent.includes('No alerts yet')`)
  await evaluate(`document.querySelector('form.alert-form').requestSubmit()`)
  await waitFor(
    `!!document.querySelector('.alert-card') && !document.body.textContent.includes('Checking...') && !document.querySelector('.alert-status')?.textContent.includes('Checking')`,
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('.alert-card').length`),
    1,
  )
  await evaluate(`document.querySelector('form.alert-form').requestSubmit()`)
  await waitFor(
    `document.body.textContent.includes('That rule already exists')`,
  )
  assert.equal(
    await evaluate(
      `JSON.parse(localStorage.getItem('auraxis.research-alerts.v1')).length`,
    ),
    1,
  )
  await navigate('/app/alerts')
  await waitFor(
    `!!document.querySelector('.alert-card') && !document.querySelector('.alert-status')?.textContent.includes('Checking')`,
  )
  for (const width of [1440, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    )
    assert.ok(
      await evaluate(`document.documentElement.scrollWidth <= innerWidth+1`),
    )
  }
  outage = true
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh results').click()`,
  )
  await waitFor(`document.body.textContent.includes('Offline snapshot')`)
  outage = false
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh results').click()`,
  )
  await waitFor(
    `!document.body.textContent.includes('Offline snapshot') && !document.querySelector('.alert-status')?.textContent.includes('Checking')`,
  )
  await evaluate(`document.querySelector('.alert-actions button').click()`)
  await waitFor(`document.body.textContent.includes('No alerts yet')`)
  assert.equal(
    await evaluate(`localStorage.getItem('auraxis.research-alerts.v1')`),
    '[]',
  )
  await evaluate(`localStorage.setItem('auraxis.research-alerts.v1','{broken')`)
  await navigate('/app/alerts')
  await waitFor(`document.body.textContent.includes('could not be read')`)
  assert.equal(
    await evaluate(`localStorage.getItem('auraxis.research-alerts.v1')`),
    '{broken',
  )
  await evaluate(`localStorage.removeItem('auraxis.research-alerts.v1')`)
  assert.deepEqual(browser.errors, [])
  await mkdir('node_modules/.cache/alerts-review', { recursive: true })
  await writeFile(
    'node_modules/.cache/alerts-review/results.json',
    JSON.stringify(
      {
        add: 'passed',
        duplicate: 'rejected',
        reload: 'persisted',
        remove: 'persisted',
        brokenStorage: 'preserved with warning',
        widths: [1440, 390, 320],
        offline: 'exact local snapshots',
        recovery: 'API',
        errors: browser.errors,
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: Alerts add/duplicate/reload/remove/storage/mobile/offline/recovery; no runtime exceptions',
  )
} finally {
  browser.close()
}
