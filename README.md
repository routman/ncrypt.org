# ncrypt.org

End-to-end encrypted chat rooms.

The topic is the key. When you enter a topic, your browser derives an AES-256 key from it (SHA-256, Web Crypto) and encrypts every message locally before it leaves your device. The server only ever sees `SHA-256(topic)` (the room id) and ciphertext — it cannot read the messages, and it cannot derive the key.

- No accounts, no passwords, no ads, no cookies, no analytics.
- Pick a nickname (1–20 characters, stored only in your browser).
- Messages are encrypted with AES-256-GCM; the key never leaves your device.
- Each room keeps the last 100 messages, so a reload catches you up.
- Open source and free.

## Development

- `npm install`
- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`

## Donations

BTC: bc1q7fqwmtq2vaka8wwpjpnmlehe36qrgfmlw33vh9

LTC: LYMSJ313xJaUsAmucuYRkVJmGB8Ut9VDz8

DOGE: DATumCTp1QBG1Gpa3ko6bXPXccnFMFDgYC

ETH: 0x6abD6f3df07c06e4137269D7187661dE37441218
