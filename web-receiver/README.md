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

Point the camera at the terminal QR. The chunk mosaic fills in as frames arrive. Missed frames are expected — the sender loops, shuffles each lap, and includes XOR parity.

## Photo fallback

If the camera is blocked, use **Use a photo** and shoot the terminal QR. Repeat as frames change.

## Build

```bash
npm run build
npm run preview
```
