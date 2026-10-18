# Part Viewer

Production readiness and routing estimates from four NetSuite CSV exports. React/TypeScript frontend, Node 24 API, persistent SQLite storage, and one password-protected account. This application proposes work orders; it does not create them in NetSuite.

## Run locally

Requires Node.js 24. Install with `npm ci`, then `npm run build`.

In PowerShell:

```powershell
$env:APP_PASSWORD = 'your-unique-password-at-least-10-characters'
$env:HOST = '127.0.0.1'
npm start
```

Open http://localhost:3000 and sign in with the configured password. Import the four exports through **Data & imports**. To seed the local database from a directory containing exactly one CSV for each saved search, run `npm run import -- "C:\path\to\exports"` while the server is stopped. The CLI matches search-name prefixes, allowing NetSuite's download suffixes to change. Restart the server after a CLI import.

For development, run `npm run server` with the password environment variable in one terminal and `npm run dev` in another. Open Vite's localhost URL; its API proxy uses port 3000.

## Docker package

For the shared DuraMark droplet, use [DEPLOYMENT.md](DEPLOYMENT.md) and `compose.production.yaml`. The configuration below is for local Docker testing.

Copy `.env.example` to `.env` and replace the password. Run `docker compose up --build -d` when ready. The app binds to localhost port 3000; SQLite resides in the named `part-viewer-data` volume. CSV exports and local data are excluded from the image and Git. A fresh container starts without business data; import through the app after sign-in.

On the droplet, terminate HTTPS at your reverse proxy and forward traffic to `127.0.0.1:3000`. Set `APP_ORIGIN=https://your-domain.example` and `COOKIE_SECURE=true`. Keep `COOKIE_SECURE=false` only for local HTTP. Configure your proxy for uploads of at least 160 MB and a 120-second request timeout. The app accepts four files up to 40 MiB each. Compose reserves a 1 GiB memory limit; larger future exports may require more memory. No deployment or remote Git push is performed by this project.

The account has no username; `APP_PASSWORD` is the single account's password. Password comparisons use salted scrypt. Sessions use HttpOnly, SameSite=Strict cookies and expire after 12 hours. Sessions reset on server restart. Cross-origin writes are rejected and failed logins are rate-limited. Login rate limits use the direct peer IP; a reverse proxy shares its limit across visitors. Restart the service after changing its environment. Do not commit `.env`.

### Backup and restore

Use SQLite's online backup API rather than copying a live WAL-mode file:

```sh
docker compose exec part-viewer node --input-type=module -e "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync(process.env.DB_PATH); await backup(db,'/app/data/backup.sqlite'); db.close();"
docker compose cp part-viewer:/app/data/backup.sqlite ./backup.sqlite
```

Store the backup securely outside the droplet. To restore, stop the service, copy the backup into the persistent volume as `part-viewer.sqlite`, remove any old `part-viewer.sqlite-wal` and `part-viewer.sqlite-shm` files while stopped, ensure UID 1000 owns the restored file, and restart. Avoid `docker compose down -v`, which deletes the persistent volume.

## Import contract and known source issue

Import **all four files together**: Item Master (including `Type`), BOM Connector, BOM Components, and Routing Steps. Original CSV headers are preserved. Internal IDs must be numeric strings; item IDs must be unique. Missing columns, invalid identifiers, empty files, or duplicate items reject the entire refresh. Broken references and invalid calculation fields are recorded as data-quality issues and surfaced in affected lookups. A validated refresh is written in one SQLite transaction; failed imports retain the current dataset. A single server process serves one database; do not scale to multiple replicas against the same volume.

Component IDs in the supplied export identify BOM component records, so child assembly resolution first uses a matching item ID when available, then an exact, unique Item Name with Type = Assembly. This name matching was explicitly selected for these exports. All other components remain materials without requiring an item-master match. Ambiguous assembly names are flagged and never guessed. Renaming an assembly requires keeping the component export names consistent.

Routing matches use exact BOM names because the routing export lacks BOM IDs. A BOM name belonging to multiple internal IDs blocks routing selection. Routing names identify routings within each BOM; add routing IDs to the source in a future version if distinct routings can share a name.

## Rules

- Inactive items are blocked. Exact `Outsourced` classification stops expansion, with no work order or routing hours. Other classifications do not bypass checks.
- Only `Type = Assembly` generates a proposed work order. Other types, including kits, are materials.
- DuraMark and customer approvals must explicitly equal `Yes`. Variable data displays the sales-order PRO warning.
- Exactly one master default BOM is required. Routing is optional for readiness only when `Express Image Item = No`; otherwise exactly one valid default routing is required. Optional routing issues appear as warnings and leave hour estimates incomplete. Duplicate identical item/BOM links count as one link.
- A single revision is automatic; multiple revisions require a selection. Selections apply consistently by BOM within the current lookup and reset after an import or part change. No date-based revision selection is attempted.
- Setup and run-rate fields must be finite nonnegative numbers; blanks are unresolved. Step hours = `(setup minutes + run rate × quantity) / 60`. Fractional quantities remain unrounded internally. Display rounding does not change calculations.
- Child quantities multiply the parent quantity by exported component quantities directly, with no unit conversions. Each occurrence is a separate proposed work order with its own setup charge.
- Approval failures and inactivity do not prevent computing available hours. Missing routing, revision, ambiguous assembly names, or calculation data make estimates incomplete. Child failures do not change parent readiness.
- Trees are capped at 2,000 occurrences and 100 levels. Cycles are reported at the affected occurrence; capped totals are marked incomplete. Collapsed branches do not mount their descendant React cards.

## BOM/routing requests

The **Requests** tab contains a four-step wizard, Open/Completed queue, editable request details, and timestamped change history. Dates are set on the server in America/Chicago. Requester and customer are required; Assembly information, BOM, and Routing are initially checked, and at least one must remain selected. Requests do not create or edit NetSuite records.

Select an eligible assembly or supply a quote part number. `Costing Method` is now required in item imports. Lot-numbered assemblies cannot be update targets; marking one **Old item** stores it as a reference only and requires a quote part number. That reference remains separate when a new eligible target is linked later. Inactive/outsourced targets require an exception reason. CA and DA can both be Yes or both No; different values require their own explanation. Missing BOM/routing/approval findings are informational for intake.

Import customers independently through **Data & imports**, or while the server is stopped run `npm run import:customers -- ActiveCustomerListResults153.csv`. Only the full `Name` values are needed; DuraMark IDs and other CSV columns are not used as identity. Customer refresh preserves stable application IDs and historical references, and retires absent names from new selections. An invalid customer import leaves the previous customer list intact.

Requests, history, and customers use separate SQLite tables and survive all four-file item refreshes. Saved item/customer names and validator findings are snapshots. Existing requests remain accessible if a source item/customer later disappears. No draft is saved before submission. Navigating away from an entered wizard warns about discarding it.

Only one open request may use a given target assembly ID, and only one may use a given customer/quote part number (trimmed, case-insensitive quote comparison). These rules also apply to edits, linking, and reopening. Old references do not count as targets. Completed requests may repeat these identifiers. Version conflicts return HTTP 409 rather than overwrite another edit. No editor identity is claimed with the shared account.

Additional protected endpoints:

| Endpoint                     | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `GET /api/customers?q=...`   | Active customer lookup; queue filters may use `includeInactive=true`     |
| `GET /api/customers/dataset` | Customer import filename, date, count                                    |
| `POST /api/customers/import` | Independent multipart `customers` CSV, maximum 5 MiB                     |
| `GET /api/items/:id/intake`  | Eligibility, costing method, exceptions, and validator findings          |
| `GET /api/request-date`      | Today's Chicago business date                                            |
| `GET /api/requests`          | Queue, filtered by status, q, customerId, requester, urgent, scope       |
| `POST /api/requests`         | Create an Open request; selected item IDs require the assessed datasetId |
| `GET /api/requests/:id`      | Request and change history                                               |
| `PATCH /api/requests/:id`    | Edit, complete, or reopen; version required                              |

Create/edit fields: requester, urgent, scopes `{assembly,bom,routing}`, targetItemId, oldItemId, quotePartNumber, customerId, customerApproval, duramarkApproval, notes, approvalMismatchReason, eligibilityExceptionReason. Dates, snapshots, identifiers, completion timestamps, and history are generated by the server. Duplicate errors include `conflictId`; stale datasets include `datasetChanged`; stale request versions include `versionConflict`.

## Viewer API

`GET /api/health` is public. All data endpoints require the session cookie.

| Endpoint              | Contract                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/login`     | JSON `{ password }`; returns session cookie                                                                                            |
| `GET /api/session`    | Check current session                                                                                                                  |
| `POST /api/logout`    | Revoke current session                                                                                                                 |
| `GET /api/dataset`    | Import ID/time, filenames, row counts, quality issues; null before import                                                              |
| `POST /api/import`    | Multipart file fields: `items`, `connectors`, `components`, `routings`                                                                 |
| `GET /api/search?q=…` | Up to 50 name/ID matches; exact ID takes priority                                                                                      |
| `POST /api/view`      | JSON `{ id, quantity, selections: { [bomId]: revisionId }, datasetId }`; tree, independent readiness, operations, totals, completeness |

`datasetId` prevents evaluating old revision choices after a refresh. Validation errors return JSON `{ error }`. Import and evaluation run synchronously in one process; brief pauses during a full dataset refresh are expected at this scale.

## Verification

Run `npm test` and `npm run build`. Tests cover readiness rules, independent child statuses, revision selection, recursion, quantities, hour estimates, atomic import failure, persistence, authentication, cross-origin rejection, API validation, and multipart uploads. When the supplied CSVs exist in the project root, tests also import the real dataset and time searches. Test-only databases are isolated from the working dataset. `docker build -t solutions-part-viewer:local .` verifies the container build.

This repository contains source and the dependency lockfile only. Supply your remote repository URL when ready to push; deployment remains a separate action.
