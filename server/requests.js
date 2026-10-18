import { parse } from "csv-parse/sync";
import { buildTree } from "./data.js";

export class RequestError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const reject = (message, status, details) => {
  throw new RequestError(message, status, details);
};
const text = (value, label, max = 3000) => {
  if (typeof value !== "string" || value.length > max)
    reject(`${label} must be text of at most ${max} characters.`);
  return value.trim();
};
const key = (value) => value.trim().toLowerCase();
const businessDate = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export function createRequestService(store, now = () => new Date()) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS customer_dataset (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL CHECK(status IN ('open','completed')),
      target_id TEXT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      quote_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS requests_open_target ON requests(target_id) WHERE status='open' AND target_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS requests_open_quote ON requests(customer_id,quote_key) WHERE status='open' AND quote_key<>'';
    CREATE TABLE IF NOT EXISTS request_history (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id), payload TEXT NOT NULL);
    PRAGMA user_version=1;
  `);
  const get = (id) => {
    if (!Number.isSafeInteger(id) || id <= 0) reject("Invalid request ID.");
    const row = db.prepare("SELECT * FROM requests WHERE id=?").get(id);
    if (!row) reject("Request not found.", 404);
    return {
      ...JSON.parse(row.payload),
      id: row.id,
      number: `BR-${String(row.id).padStart(6, "0")}`,
      version: row.version,
      status: row.status,
    };
  };
  const customer = (id) =>
    db.prepare("SELECT id,name,active FROM customers WHERE id=?").get(id);
  function assess(id) {
    if (!store.current)
      reject("Import the item dataset before checking an item.", 409);
    const item = store.current.items.get(id);
    if (!item) reject("Item is not in the current dataset.", 404);
    const costingMethod = item["Costing Method"] || "";
    const lotNumbered = costingMethod === "Lot Numbered";
    const errors = [];
    if (item.Type !== "Assembly")
      errors.push("Only assembly items can be update targets.");
    if (!costingMethod.trim())
      errors.push(
        "Costing Method is unavailable. Refresh the item export before using this item as a target.",
      );
    if (lotNumbered)
      errors.push(
        "Lot-numbered assemblies do not receive BOM/routing requests. Use Old item only as a reference.",
      );
    const exceptions = [];
    if (item.Inactive === "Yes")
      exceptions.push("The selected item is inactive.");
    if (item["Outsourced?"] === "Outsourced")
      exceptions.push("The selected item is outsourced.");
    const root = buildTree(store.current, id, 1).root;
    return {
      id,
      name: item["Item Name"],
      type: item.Type,
      costingMethod,
      lotNumbered,
      inactive: item.Inactive === "Yes",
      outsourced: item["Outsourced?"] === "Outsourced",
      customerApproval: item["Customer Approval"] === "Yes",
      duramarkApproval: item["DuraMark Approved"] === "Yes",
      eligible: errors.length === 0,
      errors,
      exceptions,
      findings: {
        status: root.status,
        errors: root.errors,
        warnings: root.warnings,
      },
      datasetId: store.current.metadata.id,
    };
  }
  function validate(input, previous) {
    const allowed = [
      "requester",
      "urgent",
      "scopes",
      "targetItemId",
      "oldItemId",
      "quotePartNumber",
      "customerId",
      "customerApproval",
      "duramarkApproval",
      "notes",
      "approvalMismatchReason",
      "eligibilityExceptionReason",
    ];
    const v = previous
      ? Object.fromEntries(allowed.map((k) => [k, previous[k]]))
      : {};
    for (const k of allowed) if (Object.hasOwn(input, k)) v[k] = input[k];
    v.requester = text(v.requester, "Requester", 120);
    if (!v.requester) reject("Requester is required.");
    for (const k of ["urgent", "customerApproval", "duramarkApproval"])
      if (typeof v[k] !== "boolean")
        reject(`${k} must be checked or unchecked.`);
    if (
      !v.scopes ||
      typeof v.scopes !== "object" ||
      ["assembly", "bom", "routing"].some(
        (k) => typeof v.scopes[k] !== "boolean",
      )
    )
      reject("Choose the requested work.");
    v.scopes = Object.fromEntries(
      ["assembly", "bom", "routing"].map((k) => [k, v.scopes[k]]),
    );
    if (!Object.values(v.scopes).some(Boolean))
      reject("Select at least one of Assembly information, BOM, or Routing.");
    for (const k of ["targetItemId", "oldItemId"]) {
      if (v[k] == null || v[k] === "") v[k] = null;
      else if (typeof v[k] !== "string" || !/^\d+$/.test(v[k]))
        reject("Invalid NetSuite item ID.");
    }
    v.quotePartNumber = text(v.quotePartNumber ?? "", "Quote part number", 200);
    v.notes = text(v.notes ?? "", "Notes", 10000);
    v.approvalMismatchReason = text(
      v.approvalMismatchReason ?? "",
      "Approval mismatch reason",
    );
    v.eligibilityExceptionReason = text(
      v.eligibilityExceptionReason ?? "",
      "Item exception reason",
    );
    if (!v.targetItemId && !v.quotePartNumber)
      reject(
        "Select an eligible target assembly or enter a quote part number. An old item is reference only.",
      );
    if (v.customerApproval !== v.duramarkApproval && !v.approvalMismatchReason)
      reject(
        "Explain why Customer Approval and DuraMark Approval do not match.",
      );
    if (!Number.isSafeInteger(v.customerId))
      reject("Select a customer from the imported list.");
    const c = customer(v.customerId);
    if (
      !c ||
      (!c.active && (!previous || previous.customerId !== v.customerId))
    )
      reject("Select a current customer from the imported list.");
    v.customerName =
      previous?.customerId === v.customerId ? previous.customerName : c.name;
    const targetChanged = !previous || previous.targetItemId !== v.targetItemId;
    const oldChanged = !previous || previous.oldItemId !== v.oldItemId;
    if ((targetChanged && v.targetItemId) || (oldChanged && v.oldItemId)) {
      if (input.datasetId !== store.current?.metadata.id)
        reject(
          "Item data changed. Check the selected item again before saving.",
          409,
          { datasetChanged: true },
        );
    }
    v.targetSnapshot = v.targetItemId
      ? targetChanged
        ? assess(v.targetItemId)
        : previous.targetSnapshot
      : null;
    v.oldItemSnapshot = v.oldItemId
      ? oldChanged
        ? assess(v.oldItemId)
        : previous.oldItemSnapshot
      : null;
    if (v.targetSnapshot && targetChanged && !v.targetSnapshot.eligible)
      reject(v.targetSnapshot.errors.join(" "));
    if (v.targetSnapshot?.exceptions.length && !v.eligibilityExceptionReason)
      reject("Explain why this inactive or outsourced target needs a request.");
    if (
      v.oldItemSnapshot &&
      oldChanged &&
      (!v.oldItemSnapshot.lotNumbered || v.oldItemSnapshot.type !== "Assembly")
    )
      reject("Old item references must be lot-numbered assemblies.");
    if (v.targetItemId && v.targetItemId === v.oldItemId)
      reject("The old item cannot also be the update target.");
    return v;
  }
  function save(input, id) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
      reject("Invalid request ID.");
    if (!input || typeof input !== "object" || Array.isArray(input))
      reject("Invalid request.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = id ? get(id) : null;
      if (previous && input.version !== previous.version)
        reject(
          "This request changed in another session. Reload before saving.",
          409,
          { versionConflict: true },
        );
      const v = validate(input, previous);
      const status = input.status ?? previous?.status ?? "open";
      if (
        !["open", "completed"].includes(status) ||
        (!previous && status !== "open")
      )
        reject("Invalid request status.");
      if (status === "open") {
        const conflict = db
          .prepare(
            "SELECT id FROM requests WHERE status='open' AND id<>? AND ((? IS NOT NULL AND target_id=?) OR (?<>'' AND customer_id=? AND quote_key=?)) ORDER BY id LIMIT 1",
          )
          .get(
            id || 0,
            v.targetItemId,
            v.targetItemId,
            key(v.quotePartNumber),
            v.customerId,
            key(v.quotePartNumber),
          );
        if (conflict)
          reject(
            "An open request already exists for this item or customer/quote part number.",
            409,
            { conflictId: conflict.id },
          );
      }
      const timestamp = now().toISOString();
      const payload = {
        ...v,
        createdAt: previous?.createdAt || timestamp,
        date: previous?.date || businessDate(new Date(timestamp)),
        updatedAt: timestamp,
        completedAt:
          status === "completed"
            ? previous?.status === "completed"
              ? previous.completedAt
              : timestamp
            : null,
      };
      if (previous)
        db.prepare(
          "UPDATE requests SET status=?,target_id=?,customer_id=?,quote_key=?,version=version+1,payload=? WHERE id=?",
        ).run(
          status,
          v.targetItemId,
          v.customerId,
          key(v.quotePartNumber),
          JSON.stringify(payload),
          id,
        );
      else
        id = Number(
          db
            .prepare(
              "INSERT INTO requests(status,target_id,customer_id,quote_key,version,payload) VALUES(?,?,?,?,1,?)",
            )
            .run(
              status,
              v.targetItemId,
              v.customerId,
              key(v.quotePartNumber),
              JSON.stringify(payload),
            ).lastInsertRowid,
        );
      const saved = get(id);
      const changes = Object.fromEntries(
        [...Object.keys(v), "status", "completedAt"]
          .filter(
            (k) =>
              JSON.stringify(previous?.[k] ?? null) !==
              JSON.stringify(saved[k] ?? null),
          )
          .map((k) => [
            k,
            { before: previous?.[k] ?? null, after: saved[k] ?? null },
          ]),
      );
      db.prepare(
        "INSERT INTO request_history(request_id,payload) VALUES(?,?)",
      ).run(
        id,
        JSON.stringify({
          at: timestamp,
          action: previous ? "updated" : "created",
          changes,
        }),
      );
      db.exec("COMMIT");
      return saved;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    assess,
    save,
    get,
    detail(id) {
      return {
        ...get(id),
        history: db
          .prepare(
            "SELECT payload FROM request_history WHERE request_id=? ORDER BY id DESC",
          )
          .all(id)
          .map((r) => JSON.parse(r.payload)),
      };
    },
    today() {
      return businessDate(now());
    },
    customers(q = "", includeInactive = false) {
      return db
        .prepare(
          "SELECT id,name,active FROM customers WHERE active=1 OR ?=1 ORDER BY name COLLATE NOCASE",
        )
        .all(includeInactive ? 1 : 0)
        .filter((c) => key(c.name).includes(key(q)));
    },
    customerMetadata() {
      const row = db
        .prepare("SELECT payload FROM customer_dataset WHERE id=1")
        .get();
      return row ? JSON.parse(row.payload) : null;
    },
    importCustomers(file) {
      if (!file) reject("Choose a customer CSV.");
      let headers;
      const rows = parse(file.buffer, {
        bom: true,
        trim: true,
        skip_empty_lines: true,
        columns: (cols) => {
          headers = cols.map((c) => c.trim());
          return headers;
        },
      });
      if (!headers?.includes("Name") || !rows.length)
        reject(
          "Customer CSV must contain a Name column and at least one customer.",
        );
      const names = rows.map((r) => r.Name.trim());
      if (
        names.some((n) => !n || n.length > 500) ||
        new Set(names).size !== names.length
      )
        reject("Customer names must be nonempty and unique.");
      const metadata = {
        id: crypto.randomUUID(),
        importedAt: now().toISOString(),
        filename: file.name,
        count: names.length,
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("UPDATE customers SET active=0");
        const upsert = db.prepare(
          "INSERT INTO customers(name,active) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET active=1",
        );
        for (const name of names) upsert.run(name);
        db.prepare(
          "INSERT OR REPLACE INTO customer_dataset(id,payload) VALUES(1,?)",
        ).run(JSON.stringify(metadata));
        db.exec("COMMIT");
        return metadata;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    list(filters = {}) {
      const rows = db
        .prepare("SELECT id FROM requests WHERE status=? ORDER BY id")
        .all(filters.status === "completed" ? "completed" : "open")
        .map((r) => get(r.id));
      return rows
        .filter(
          (r) =>
            (!filters.customerId ||
              String(r.customerId) === String(filters.customerId)) &&
            (!filters.requester ||
              key(r.requester).includes(key(filters.requester))) &&
            (!filters.urgent || r.urgent) &&
            (!filters.scope || r.scopes[filters.scope]) &&
            (!filters.q ||
              key(
                [
                  r.number,
                  r.targetSnapshot?.name,
                  r.targetItemId,
                  r.oldItemSnapshot?.name,
                  r.oldItemId,
                  r.quotePartNumber,
                  r.customerName,
                  r.requester,
                  r.notes,
                ].join(" "),
              ).includes(key(filters.q))),
        )
        .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.id - b.id);
    },
  };
}
