# DuraMark droplet deployment

Production URL: `https://duramark.jays-apps.com/part-viewer/`.
Checkout: `/opt/apps/duramark/part-viewer`, repository `MarkVoldaren/PartViewer`, branch `main`.
Container: `duramark-part-viewer`, internal port 3000, existing external network `apps_proxy`. No host ports are published. HTTPS is provided by the existing `apps-caddy` container.

The default `compose.yaml` is the production configuration. Use `compose.local.yaml` explicitly for local testing. Production `.env` contains the generated account password and exact image tag; do not commit or print it in shared logs. The password is unique to this app. Cookies are secure and scoped to `/part-viewer/`. The initial production data is a consistent SQLite backup of the locally imported dataset. Future refreshes use **Data & imports** after sign-in; business CSVs are never added to Git or the image.

The droplet has 1 GiB of RAM shared with other apps and 2 GiB swap. The standard update command builds on the droplet. A workstation build and image transfer remain available as an alternative. The app limits its JavaScript heap to 512 MiB, container RAM to 768 MiB, and combined RAM/swap to 1536 MiB. Full CSV refresh and restart were tested with these limits. The named `part-viewer-data` volume persists the database independently of containers.

## Updating

After changes are tested and pushed to GitHub, run on the droplet:

```bash
cd /opt/apps/duramark/part-viewer
git pull --ff-only
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS https://duramark.jays-apps.com/part-viewer/api/health
```

The default configuration retains the existing production container name, proxy network, secure cookies and named data volume. Preserve the production `.env`. Before rebuilding, retain the current image under a separate rollback tag: rebuilding reuses the configured `IMAGE_TAG` (or `latest`). For example, `docker image tag solutions-part-viewer:CURRENT_TAG solutions-part-viewer:rollback-YYYYMMDD-HHMM`, replacing both tag placeholders with actual values. To deploy a prebuilt image instead, load it, set `IMAGE_TAG` in `.env` to its tag and run `docker compose up -d --no-build`.

Verify sign-in, a part lookup and the other existing public app routes after updating.

The first deployment adds a route before the portal fallback in `/opt/apps/proxy/Caddyfile`. `deploy/install-route.py` validates a candidate before writing, backs up the original, validates again, and reloads Caddy. It refuses to overwrite an existing Part Viewer route. It preserves all existing routes and certificate volumes. Future app updates do not need proxy changes.

```caddy
redir /part-viewer /part-viewer/
handle_path /part-viewer/* {
    reverse_proxy duramark-part-viewer:3000
}
```

## Backup and rollback

### Request queue upgrade

The request feature adds tables for customers, requests, history, and customer import metadata. Startup applies the additive migration; four-file item imports still replace only the dataset/records tables. Before the first upgrade, use an online SQLite backup and save a private copy of `.env`. Keep both backups under `/root/part-viewer-backups` with restricted permissions.

Import the four exports including the updated item master with **Costing Method**, then independently import **ActiveCustomerListResults153.csv**. Use the existing production volume; never replace it with a QA database. The CLI import commands can run in temporary containers against that volume while the app is stopped. For future refreshes, use the authenticated Data & imports page. Keep the production password unchanged during feature upgrades.

If a first-upgrade import or verification fails, stop the app and restore the pre-upgrade SQLite backup plus previous image tag. Restoring that database is safe only before accepting new production requests; later rollback must preserve any requests submitted after the backup. Subsequent app-image rollbacks can leave the additive request/customer tables intact.

Use the online SQLite backup command in README, replacing `docker compose -f compose.local.yaml` with `docker compose` on production. Do not copy a live database without its WAL. Backups contain business data and must remain private. Never use `down -v`.

To roll back an app update, restore the previous `IMAGE_TAG` in `.env` and run `docker compose up -d --no-build`; leave the data volume intact. This first release does not change any existing app's database or configuration. To remove the new route, restore the timestamped Caddyfile backup in place, validate with `docker exec apps-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then reload with `docker exec apps-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`. The Caddy certificate volumes must be preserved.
