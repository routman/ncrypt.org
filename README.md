# ncrypt.org

End-to-end encrypted chat rooms. No account, no password, no tracking.

## How it works

The topic is the key. When you enter a topic, your browser derives an AES-256 key from it (SHA-256, Web Crypto) and encrypts every message locally before it leaves your device. The server only ever sees `SHA-256(topic)` (the room id) and ciphertext — it cannot read the messages and cannot recover the topic.

Anyone who knows the topic can join the room. Share the topic with the people you want in the room, and treat it like a password.

## Privacy

- No accounts, no passwords, no cookies, no ads, no analytics.
- Your nickname (1–20 characters) is stored only in your browser.
- The server never sees plaintext — only the room id and ciphertext.
- Each room keeps the last 100 messages, retained for up to 30 days.

## Security

- The topic is the secret. Use a long, random topic for private rooms — short topics can be guessed.
- Messages are encrypted with AES-256-GCM; the key is derived in your browser and never leaves your device.
- History is capped and expires. Don't rely on ncrypt as a permanent record.
- You are responsible for the messages you send.

## Getting started

1. Open https://ncrypt.org
2. Enter a topic (or create one) and pick a nickname.
3. Chat — a reload catches you up with the last 100 messages.

## Development

- `npm install`
- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`

## Donations

BTC: bc1q7fqwmtq2vaka8wwpjpnmlehe36qrgfmlw33vh9

LTC: LYMSJ313xJaUsAmucuYRkVJmGB8Ut9VDz8

DOGE: DATumCTp1QBG1Gpa3ko6bXPXccnFMFDgYC

ETH: 0x6abD6f3df07c06e4137269D7187661dE37441218
