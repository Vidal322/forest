# Forest — reforestation field tracker

Forest replaces the hand-annotated satellite screenshot of a reforestation field. It is a phone-first web app
(installable, works without signal) for recording what was sown, planted and watered where, and what is still to do.

## What you can do

- **Set up the field** from a satellite screenshot or drone photo. All EXIF/GPS data is removed on upload; positions
  are pixels of that photo, so nothing can be placed on a real map. Set the scale by dragging a line over something of
  known length (areas then show in hectares).
- **Draw plots and zones** on the photo with your finger: tap corners, drag to adjust. Zones are coloured by state:
  *needs water*, *watered recently*, *planted*, *sown*, *nothing yet*, *path*.
- **Log work in three taps**: tap the zones (or "all that need water"), tap *Watered / Sowed / Planted*, Save. Optional:
  day, covas or litres per zone, seed mix, notes.
- **Tasks** on a zone or a whole plot ("Falta semear", "Melhorar caminho"), grouped by urgency, ticked done in one tap.
- **Zone page**: its state, open tasks, trees by species (alive/dead) and the full history, where any entry can be
  fixed or deleted.
- **Plot stats**: measured vs. old-map hectares, covas sown, trees planted, species, waterings, what needs water now.
- **Seasonal watering**: e.g. every 4 days June–September, every 14 days November–February.
- **Newer photos**: align a fresher satellite image by tapping 3–4 matching landmarks; every drawing stays in place.
- **Offline**: everything you log or change without signal is kept on the phone and sent, in order, when the signal
  returns — also after the app was closed. A bar shows what is still waiting.

## Running it

Everything runs inside the Nix dev shell (`nix develop`, or direnv).

```sh
cd backend
cp .env.example .env      # first time only
make db-up                # PostgreSQL + PostGIS in Docker (port 5433)
make run                  # API on :8080; applies database migrations on start

cd ../frontend
pnpm install
pnpm dev                  # http://localhost:5173 (proxies /api to :8080)
pnpm dev:lan              # open it on a phone on the same network
```

Checks before committing: `make check` (backend: lint + tests against the dev database, each test in a rolled-back
transaction) and `pnpm check` (frontend: lint, types, tests). `pnpm build` produces the installable app in
`frontend/dist` (service worker included; offline mode needs https or localhost).

## Using it on your phone in the field

**There is no login.** Anyone who can reach the API can read and change everything, so never expose it to the
internet as-is. Offline mode also needs HTTPS (browsers only install service workers on secure origins), so
`pnpm dev:lan` over plain http works on a phone but not offline.

The simplest setup is one machine (a home server, a small VPS, a Raspberry Pi):

1. Build the app and let the API serve it from the same address:
   ```sh
   cd frontend && pnpm build
   cd ../backend && FOREST_STATIC_DIR=../frontend/dist make run
   ```
2. Put HTTPS and access control in front of `127.0.0.1:8080`, for example
   - **Tailscale** (private, nothing public): `tailscale serve --bg 8080`, then open the `https://<machine>.<tailnet>.ts.net`
     address on the phone (with the Tailscale app on), or
   - **Caddy** with a password: `reverse_proxy 127.0.0.1:8080` plus `basic_auth` in a site block for your domain.
3. Open the address on the phone and use *Add to Home Screen*. From then on it opens without signal; changes made
   offline are sent when the connection comes back.

Back up the database (`pg_dump`) and `backend/data/photos` — together they are the whole field record.

## Design

- `docs/data-model.md` — the schema (source of truth) and the reasons behind it.
- `docs/mockups/` — the UI the app follows.
