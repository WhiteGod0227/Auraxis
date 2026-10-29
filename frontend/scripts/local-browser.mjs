// For dedicated local QA Chrome sessions only. Does not start or stop services.
export async function localBrowser(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  const events = new Set()
  const errors = []
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      clearTimeout(task.timeout)
      if (message.error) task.reject(new Error(message.error.message))
      else task.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.text)
    for (const callback of events) callback(message)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`CDP timed out: ${method}`))
      }, 60000)
      pending.set(requestId, { resolve, reject, timeout })
      ws.send(JSON.stringify({ id: requestId, method, params }))
    })
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Browser condition timed out: ${expression}`)
  }
  let loads = 0
  events.add((message) => {
    if (message.method === 'Page.loadEventFired') loads++
  })
  await send('Runtime.enable')
  await send('Page.enable')
  async function navigate(path) {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new Error('Use a local app path.')
    const before = loads
    await send('Page.navigate', { url: `http://localhost:5173${path}` })
    for (let attempt = 0; loads === before && attempt < 150; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    if (loads === before) throw new Error('Page load timed out.')
  }
  return {
    send,
    evaluate,
    waitFor,
    navigate,
    errors,
    events,
    close: () => ws.close(),
  }
}
export async function localTarget() {
  const targets = await (await fetch('http://localhost:9223/json/list')).json()
  const target = targets.find((target) => target.type === 'page')
  if (!target) throw new Error('Start a dedicated QA Chrome on CDP port 9223.')
  return target
}
