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

### Backups

The database and the photos (`backend/data/photos`) are together the whole field record. Back them up **every day**
and keep a copy off the machine — a backup on the same disk is lost with it.

```sh
cd backend
make backup         # → backups/<date_time>/ at the repo root: db.dump (pg_dump -Fc) + photos/; prints path and size
make backup-check   # proves it works: backs up, restores into a scratch database, compares every table's row count
                    # and every photo, then a forced restore over it must keep the old copy (the live data is only
                    # read); run it once after setting up, then monthly
```

Backups and restores always go through the compose `db` service (`docker compose exec db …`, run from `backend/`):
they use that container's own `pg_dump` / `pg_restore`, and the host and port in `DATABASE_URL` are ignored (only its
database name is used). So the database must live in that container; a Postgres elsewhere needs its own backup.

`make backup` only needs `make` and Docker (it uses the database container's own `pg_dump`), so cron can run it
outside the Nix shell. Cron runs with a bare `PATH` (`/usr/bin:/bin`), which misses Docker when it is installed as a
snap (`/snap/bin`) or under `/usr/local/bin`, so set `PATH` in the crontab; check that it holds the folder printed by
`command -v docker`. For example, every night at 03:30, keeping 30 days (`crontab -e`, adjust the path):

```cron
PATH=/usr/local/bin:/usr/bin:/bin:/snap/bin
30 3 * * * cd /srv/forest/backend && make -s backup >> $HOME/forest-backup.log 2>&1 && find ../backups -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} +
```

Look at `~/forest-backup.log` now and then: a failed night only shows there (and as a `<date_time>.partial` folder).
To back up a different database, put the override after `make`: `make backup DATABASE_URL=postgres://…/other`
(a `DATABASE_URL=… make backup` prefix is ignored, because `backend/.env` wins).

Then copy `backups/` elsewhere (another machine, a USB disk, `rsync`, a cloud drive) as often as you can afford to lose.

### Old deletions

Deleted entries stay in the database as *tombstones*, so a phone that was offline can't bring them back by sending an
old edit. After a few months nothing queued can still arrive, and they can go for good:

```sh
cd backend
make purge dry=1    # what would go, nothing changed
make purge          # hard-delete entries deleted more than 90 days ago (days=120 for another age; at least 30)
```

It runs in one transaction and prints a count per table. Deleted entries that something still points at (a deleted
species with trees, a deleted zone in the watering history) are kept and listed. Take a backup first.

**Restore**

```sh
cd backend
# look first: restore into a separate database and folder, nothing live is touched
make restore from=backups/2026-11-24_033000 db=forest_check data=/tmp/forest-check
# replace the live data: stop the API, restore, start it again
make restore from=backups/2026-11-24_033000 db=forest data=data force=1
```

`make restore` loads the dump into a scratch database and only swaps it in once that worked, so a broken backup never
costs you the database you had. It refuses to overwrite the live `forest` database without `force=1`. It never drops
a database either: the one it replaces is renamed to `<db>_old_<date_time>`, and the restore prints that name and the
command to drop it once you are happy with the result; until then it is your way back.
Photos are copied into `<data>/photos` over the ones already there: a forced restore leaves photo files newer than the
backup in place (they are harmless — nothing in the restored database points at them). Delete a check database
afterwards with `docker compose exec db psql -U forest -c 'DROP DATABASE forest_check'` (from `backend/`).

## Design

- `docs/data-model.md` — the schema (source of truth) and the reasons behind it.
- `docs/mockups/` — the UI the app follows.
