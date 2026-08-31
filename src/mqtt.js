import mqtt from 'mqtt'

function randomClientId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return 'ncrypt-' + hex
}

export function connectMqtt({ url, topics, onMessage, onStatus }) {
  const client = mqtt.connect(url, {
    clientId: randomClientId(),
    clean: true,
    reconnectPeriod: 2000,
    resubscribe: true,
  })

  let lastStatus = null

  const setStatus = (connected) => {
    if (lastStatus === connected) return
    lastStatus = connected
    onStatus(connected)
  }

  client.on('connect', () => {
    client.subscribe(topics, { qos: 0 })
    setStatus(true)
  })

  client.on('offline', () => setStatus(false))
  client.on('close', () => setStatus(false))
  client.on('error', () => setStatus(false))

  client.on('message', (t, payload) => {
    onMessage(t, payload.toString('utf8'))
  })

  return {
    publish(t, payload) {
      if (!client.connected) return
      client.publish(t, payload, { qos: 0 })
    },
    close() {
      client.end()
    },
  }
}

export function mqttUrl() {
  if (location.protocol === 'https:') return 'wss://' + location.host + '/mqtt'
  return 'ws://localhost:9001'
}
