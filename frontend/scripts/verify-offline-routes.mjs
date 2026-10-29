import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { localBrowser, localTarget } from './local-browser.mjs'
const output = `node_modules/.cache/acceptance-${process.env.ACCEPTANCE_DATE || new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
const browser = await localBrowser(await localTarget())
let offline = true
const results = []
browser.events.add((message) => {
  if (message.method !== 'Fetch.requestPaused') return
  const { requestId, request } = message.params
  const privatePath = /\/api\/(auth|workspaces|alerts)(\/|$)/.test(
    new URL(request.url).pathname,
  )
  const work =
    offline && !privatePath
      ? browser.send('Fetch.failRequest', {
          requestId,
          errorReason: 'ConnectionRefused',
        })
      : browser.send('Fetch.continueRequest', { requestId })
  work.catch((error) => browser.errors.push(error.message))
})
try {
  await browser.send('Fetch.enable', {
    patterns: [{ urlPattern: '*://localhost:8010/api/*' }],
  })
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (const path of [
    '/app',
    '/app/relative-value',
    '/app/term-structure',
    '/app/backtest',
    '/app/data-health',
    '/app/calendar',
  ]) {
    offline = true
    await browser.navigate(path)
    await browser.waitFor(
      `document.body.textContent.includes('Offline snapshot')&&!document.querySelector('.inline-loading-state,.skeleton')`,
    )
    assert.equal(
      await browser.evaluate(`!!document.querySelector('.error-notice')`),
      false,
      path,
    )
    offline = false
    await browser.navigate(path)
    await browser.waitFor(
      `!!document.querySelector('h1')&&!document.querySelector('.inline-loading-state,.skeleton')&&!document.body.textContent.includes('Offline snapshot')`,
    )
    assert.equal(
      await browser.evaluate(`!!document.querySelector('.error-notice')`),
      false,
      path,
    )
    results.push({ path, offline: 'PASS', API_recovery: 'PASS' })
  }
  assert.deepEqual(browser.errors, [])
  await mkdir(output, { recursive: true })
  await writeFile(
    `${output}/offline-routes.json`,
    JSON.stringify({ results, runtimeErrors: browser.errors }, null, 2),
  )
  console.log(
    'PASS: six public routes offline and API recovery; no runtime exceptions',
  )
} finally {
  browser.close()
}
