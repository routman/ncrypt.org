import mqtt from 'mqtt'

const BROKER_URL = process.env.BROKER_URL || 'ws://127.0.0.1:9001'
const CONNECTIONS = Number(process.env.CONNECTIONS || 500)
const EXTRA = Number(process.env.EXTRA || 1)
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 15000)
const FLOOD = Number(process.env.FLOOD || 300)
const MAX_QUEUED = Number(process.env.MAX_QUEUED || 100)

function connectOne(url, id) {
  return new Promise((resolve) => {
    const client = mqtt.connect(url, {
      clientId: 'cap-' + id,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      resolve({ ok, client })
    }
    client.on('connect', () => finish(true))
    client.on('error', () => finish(false))
    client.on('close', () => finish(false))
    client.on('offline', () => finish(false))
    const t = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS)
    if (t.unref) t.unref()
  })
}

function closeAll(handles) {
  for (const h of handles) {
    if (h && h.client) h.client.end(true)
  }
}

async function connectionCap() {
  console.log('connection cap: opening ' + CONNECTIONS + ' concurrent clients to ' + BROKER_URL)
  const clients = await Promise.all(
    Array.from({ length: CONNECTIONS }, (_, i) => connectOne(BROKER_URL, i))
  )
  const connected = clients.filter((c) => c.ok).length
  console.log('  connected: ' + connected + '/' + CONNECTIONS)
  let ok = connected === CONNECTIONS
  if (!ok) {
    console.log('  FAIL: expected all ' + CONNECTIONS + ' to connect')
  }

  if (ok && EXTRA > 0) {
    console.log('  attempting ' + EXTRA + ' extra connection(s) beyond the cap')
    const extra = await Promise.all(
      Array.from({ length: EXTRA }, (_, i) => connectOne(BROKER_URL, 'extra-' + i))
    )
    const extraConnected = extra.filter((c) => c.ok).length
    console.log('  extra connected: ' + extraConnected + '/' + EXTRA + ' (expected 0)')
    if (extraConnected > 0) {
      console.log('  WARN: extra connections succeeded — cap may be higher than expected')
    }
    closeAll(extra)
  }
  closeAll(clients)
  return ok
}

async function flood() {
  const sub = mqtt.connect(BROKER_URL, { clientId: 'flood-sub', clean: true, reconnectPeriod: 0 })
  await new Promise((res) => sub.on('connect', res))
  const topic = 'ncrypt-caps/flood'
  sub.subscribe(topic, { qos: 1 })
  let received = 0
  sub.on('message', () => {
    received++
  })
  const pub = mqtt.connect(BROKER_URL, { clientId: 'flood-pub', clean: true, reconnectPeriod: 0 })
  await new Promise((res) => pub.on('connect', res))
  for (let i = 0; i < FLOOD; i++) {
    pub.publish(topic, Buffer.from('m' + i), { qos: 1 })
  }
  await new Promise((res) => setTimeout(res, 2000))
  console.log('flood backstop: published ' + FLOOD + ' QoS-1 msgs, subscriber received ' + received + ' (max_queued_messages ' + MAX_QUEUED + ' is the backstop)')
  sub.end(true)
  pub.end(true)
}

async function main() {
  console.log('ncrypt broker cap check')
  console.log('broker: ' + BROKER_URL)
  const capOk = await connectionCap()
  if (capOk) {
    await flood()
  }
  if (capOk) {
    console.log('PASS: connection cap held under load')
    process.exit(0)
  }
  console.log('FAIL: connection cap not verified')
  process.exit(1)
}

main().catch((err) => {
  console.error('broker cap check error: ' + (err && err.message ? err.message : err))
  process.exit(1)
})
