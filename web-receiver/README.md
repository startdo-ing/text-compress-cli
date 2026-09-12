# text-compress receiver

Phone-first camera app that rebuilds a TCQR stream from the `text-compress send` terminal sender.

## Run

```bash
npm install
npm run dev            # http://localhost:5173 — camera works on this computer
npm run dev:https      # https://<lan-ip>:5173 — required for a phone; accept the cert warning
```

Then, from the repo root:

```bash
npx tsx src/cli.ts send ./README.md --fps 8
```

Point the camera at the 2×2 QR grid in the terminal. The chunk mosaic fills in as frames arrive. Missed frames are expected — the sender loops four codes at a time, shuffles each lap, and includes XOR parity.

## Trusted HTTPS for phone testing

`dev:https` defaults to a self-signed cert (`@vitejs/plugin-basic-ssl`), which
the browser warns about and some phones refuse outright. For a certificate
your phone actually trusts, use [`mkcert`](https://github.com/FiloSottile/mkcert)
to make a local CA and a cert for `localhost` + your LAN IP:

```bash
sudo apt install mkcert libnss3-tools   # Debian/Ubuntu; brew install mkcert on macOS
mkcert -install                          # trust the local CA on this machine

cd web-receiver
mkdir -p .certs
mkcert -key-file .certs/dev-key.pem -cert-file .certs/dev-cert.pem \
  localhost 127.0.0.1 ::1 <your-lan-ip>   # e.g. 192.168.1.20
```

`vite.config.ts` picks up `.certs/dev-key.pem` + `.certs/dev-cert.pem`
automatically when present (falls back to `basicSsl` otherwise) — just re-run
`npm run dev:https`.

The phone still needs to trust the same CA `mkcert` created (it's local to
this machine, not a public CA):

```bash
mkcert -CAROOT   # prints the folder containing rootCA.pem
```

Send `rootCA.pem` to the phone (AirDrop, email, a temporary `python3 -m http.server`
in that folder, etc.) and install it:

- **iOS:** open the file to install the profile (Settings → General → VPN & Device
  Management), then enable full trust at Settings → General → About → Certificate
  Trust Settings.
- **Android:** Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate, then pick `rootCA.pem`.

Re-run `mkcert -key-file … -cert-file …` whenever your LAN IP changes (e.g. new
Wi-Fi network).

## Photo fallback

If the camera is blocked, use **Use a photo** and shoot the terminal QR grid. Repeat as frames change.

## Build

```bash
npm run build
npm run preview
```
