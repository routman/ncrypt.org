# ncrypt.org

End-to-end encrypted chat rooms. No account, no password, no tracking.

## How it works

The channel name is the encryption secret. Entering a channel causes your browser to derive an AES-256 key from it (SHA-256, Web Crypto); every message is then encrypted locally before it leaves your device. The server only ever sees `SHA-256(channel)` (the room id) and ciphertext — it cannot read the messages and cannot recover the channel.

Anyone who knows the channel name can join the room. Share the channel with the people you want in the room, and treat it like a password.

The channel name is case-sensitive. There is no recovery if you forget it: ncrypt has no accounts and no password reset, and the server only stores a one-way hash of the channel, so a lost channel means permanent loss of access to that room.

## Features

- **Delete your own messages** — the × on a message you sent deletes it. Only the sender can delete their own messages; the server can't.
- **Mute** — the speaker button in the header toggles the new-message sound.
- **Who's online** — a dot next to a nickname means that person is in the room right now.

## Privacy

- No accounts, no passwords, no cookies, no ads, no analytics.
- Your nickname (1–20 characters) is stored only in your browser.
- The server never sees plaintext — only the room id and ciphertext.
- Each room keeps the last 100 messages, retained for up to 30 days.

## Security

- The channel is the secret. Use a long, random channel for private rooms — short channels can be guessed.
- Channel names are case-sensitive, and a forgotten channel cannot be recovered (no account, no reset, one-way hash only).
- Messages are encrypted with AES-256-GCM; the key is derived in your browser and never leaves your device.
- History is capped and expires. Don't rely on ncrypt as a permanent record.
- You are responsible for the messages you send.

## Getting started

1. Open https://ncrypt.org
2. Enter a channel (or create one) and pick a nickname.
3. Chat — a reload catches you up with the last 100 messages.

## Development

- `npm install`
- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/`
- `npm test` — run the test suite (crypto vectors, service checks)

## Donations

BTC: bc1q7fqwmtq2vaka8wwpjpnmlehe36qrgfmlw33vh9

LTC: LYMSJ313xJaUsAmucuYRkVJmGB8Ut9VDz8

DOGE: DATumCTp1QBG1Gpa3ko6bXPXccnFMFDgYC

ETH: 0x6abD6f3df07c06e4137269D7187661dE37441218
