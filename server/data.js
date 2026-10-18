import { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";

export const schemas = {
  items: [
    "Item Name",
    "Item Internal ID",
    "Customer Approval",
    "DuraMark Approved",
    "Variable Data",
    "Inactive",
    "Outsourced?",
    "Express Image Item",
    "Type",
    "Costing Method",
  ],
  connectors: [
    "Item Name",
    "Item Internal ID",
    "Item Bill of Materials",
    "Bill of Materials Internal ID",
    "Master Default?",
  ],
  components: [
    "Bill of Materials Internal ID",
    "Bill of Materials Name",
    "Bill of Materials Revision Internal ID",
    "Bill of Materials Revision Name",
    "Component Name",
    "Component Internal ID",
    "Component Quantity",
    "Units",
  ],
  routings: [
    "Bill of Materials Name",
    "Routing Name",
    "Default Routing?",
    "Operation Sequence",
    "Operation Name",
    "Manufacturing Work Center",
    "Manufacturing Cost Template",
    "Setup Time",
    "Run Rate",
  ],
};
const add = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};
// CSV cells repeat thousands of small classification strings. Share those values
// so atomic refreshes can retain the live dataset within the droplet's heap limit.
const sharedColumns = new Set([
  "Type",
  "Costing Method",
  "Inactive",
  "Outsourced?",
  "Express Image Item",
  "Customer Approval",
  "DuraMark Approved",
  "Variable Data",
  "Machine Type",
  "COLORS",
  "Master Default?",
  "Default Routing?",
  "Manufacturing Work Center",
  "Manufacturing Cost Template",
  "Units",
]);
function sharedValues() {
  const values = new Map();
  return (value, column) => {
    if (!sharedColumns.has(column)) return value;
    if (!values.has(value)) values.set(value, value);
    return values.get(value);
  };
}
export function indexData(tables, metadata) {
  const share = sharedValues();
  for (const rows of Object.values(tables))
    for (const row of rows)
      for (const column of Object.keys(row))
        row[column] = share(row[column], column);
  const items = new Map(tables.items.map((r) => [r["Item Internal ID"], r])),
    connectors = new Map(),
    components = new Map(),
    routings = new Map(),
    names = new Map(),
    assemblyNames = new Map();
  for (const r of tables.items)
    if (r.Type === "Assembly")
      add(assemblyNames, r["Item Name"], r["Item Internal ID"]);
  for (const r of tables.connectors) {
    add(connectors, r["Item Internal ID"], r);
    if (!names.has(r["Item Bill of Materials"]))
      names.set(r["Item Bill of Materials"], new Set());
    names
      .get(r["Item Bill of Materials"])
      .add(r["Bill of Materials Internal ID"]);
  }
  for (const r of tables.components) {
    add(components, r["Bill of Materials Internal ID"], r);
    if (!names.has(r["Bill of Materials Name"]))
      names.set(r["Bill of Materials Name"], new Set());
    names
      .get(r["Bill of Materials Name"])
      .add(r["Bill of Materials Internal ID"]);
  }
  for (const r of tables.routings)
    add(routings, r["Bill of Materials Name"], r);
  return {
    items,
    connectors,
    components,
    routings,
    names,
    assemblyNames,
    metadata,
  };
}
export function resolveComponent(data, row) {
  const id = row["Component Internal ID"],
    item = data.items.get(id);
  if (item)
    return {
      id,
      assembly: item.Type === "Assembly",
      ambiguous: false,
      byName: false,
    };
  const matches = data.assemblyNames.get(row["Component Name"]) || [];
  return {
    id: matches.length === 1 ? matches[0] : id,
    assembly: matches.length === 1,
    ambiguous: matches.length > 1,
    byName: matches.length === 1,
  };
}
export function openStore(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dataset (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, payload TEXT NOT NULL)",
  );
  const stored = db.prepare("SELECT payload FROM dataset WHERE id=1").get();
  let current = stored
    ? (() => {
        const d = JSON.parse(stored.payload);
        if (d.tables) return indexData(d.tables, d.metadata); // Local pre-release database compatibility.
        const tables = Object.fromEntries(
          Object.keys(schemas).map((kind) => [kind, []]),
        );
        for (const row of db
          .prepare("SELECT kind,payload FROM records ORDER BY rowid")
          .iterate()) {
          const values = JSON.parse(row.payload);
          tables[row.kind].push(
            Object.fromEntries(
              d.headers[row.kind].map((key, i) => [key, values[i]]),
            ),
          );
        }
        return indexData(tables, d.metadata);
      })()
    : null;
  return {
    db,
    get current() {
      return current;
    },
    import(files) {
      const tables = {},
        issues = [];
      const share = sharedValues();
      for (const [kind, required] of Object.entries(schemas)) {
        const file = files[kind];
        if (!file) throw Error(`Missing ${kind} CSV`);
        let headers;
        const rows = parse(file.buffer, {
          cast: (value, context) => share(value, context.column),
          bom: true,
          skip_empty_lines: true,
          columns: (cols) => {
            headers = cols.map((s) => s.trim());
            return headers;
          },
          trim: true,
        });
        if (!headers || required.some((h) => !headers.includes(h)))
          throw Error(
            `${kind}: missing required columns: ${required.filter((h) => !headers?.includes(h)).join(", ")}`,
          );
        if (!rows.length) throw Error(`${kind}: CSV contains no data`);
        const ids =
          kind === "items"
            ? ["Item Internal ID"]
            : kind === "connectors"
              ? ["Item Internal ID", "Bill of Materials Internal ID"]
              : kind === "components"
                ? [
                    "Bill of Materials Internal ID",
                    "Bill of Materials Revision Internal ID",
                    "Component Internal ID",
                  ]
                : [];
        for (let i = 0; i < rows.length; i++)
          for (const id of ids)
            if (!/^\d+$/.test(rows[i][id]))
              throw Error(`${kind} row ${i + 2}: invalid ${id}`);
        if (
          kind === "items" &&
          new Set(rows.map((r) => r["Item Internal ID"])).size !== rows.length
        )
          throw Error("Duplicate item internal IDs");
        tables[kind] = rows;
      }
      const candidate = indexData(tables, null);
      const counts = {};
      const issue = (message) => (counts[message] = (counts[message] || 0) + 1);
      for (const r of tables.connectors)
        if (!candidate.items.has(r["Item Internal ID"]))
          issue("BOM links reference missing items");
      for (const r of tables.components) {
        const resolved = resolveComponent(candidate, r);
        if (resolved.byName)
          issue("Assembly components resolved by exact unique name");
        if (resolved.ambiguous)
          issue("Component names match multiple assemblies");
        if (number(r["Component Quantity"]) === null)
          issue("Components have invalid quantities");
      }
      for (const [name, ids] of candidate.names)
        if (ids.size > 1) issue("BOM names map to multiple internal IDs");
      for (const r of tables.routings) {
        if (!candidate.names.has(r["Bill of Materials Name"]))
          issue("Routing rows reference unknown BOM names");
        if (number(r["Setup Time"]) === null || number(r["Run Rate"]) === null)
          issue("Routing rows have invalid times");
      }
      for (const [message, count] of Object.entries(counts))
        issues.push({ message, count });
      const metadata = {
        id: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        files: Object.fromEntries(
          Object.entries(files).map(([k, f]) => [k, f.name]),
        ),
        counts: Object.fromEntries(
          Object.entries(tables).map(([k, v]) => [k, v.length]),
        ),
        issues,
      };
      candidate.metadata = metadata;
      db.exec("BEGIN IMMEDIATE");
      try {
        const headers = Object.fromEntries(
          Object.entries(tables).map(([kind, rows]) => [
            kind,
            Object.keys(rows[0]),
          ]),
        );
        db.exec("DELETE FROM records");
        const insert = db.prepare(
          "INSERT INTO records(kind,payload) VALUES(?,?)",
        );
        for (const [kind, rows] of Object.entries(tables)) {
          const columns = headers[kind];
          for (const row of rows)
            insert.run(kind, JSON.stringify(columns.map((key) => row[key])));
        }
        db.prepare(
          "INSERT OR REPLACE INTO dataset(id,payload) VALUES(1,?)",
        ).run(JSON.stringify({ format: 2, headers, metadata }));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      current = candidate;
      return metadata;
    },
  };
}
export function number(value) {
  if (value === undefined || value === null || String(value).trim() === "")
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function buildTree(data, id, quantity, selections = {}) {
  let budget = 2000;
  let truncated = false;
  const visit = (itemId, qty, ancestors, key) => {
    if (--budget < 0 || ancestors.length > 100) {
      truncated = true;
      return null;
    }
    const item = data.items.get(itemId);
    const errors = [],
      warnings = [],
      children = [],
      materials = [];
    const node = {
      key,
      itemId,
      item: item || { "Item Name": "Missing item", Type: "Unknown" },
      quantity: qty,
      errors,
      warnings,
      children,
      materials,
      operations: [],
      revisions: [],
      bom: null,
      revision: null,
      routing: null,
      hours: 0,
      complete: true,
      status: "blocked",
    };
    const fail = (msg) => {
      errors.push(msg);
      node.complete = false;
    };
    if (!item) {
      fail("Component item is missing from the item master.");
      return node;
    }
    if (item.Inactive === "Yes") errors.push("Part is inactive.");
    if (item["Variable Data"] === "Yes")
      warnings.push(
        "Variable data: PRO will need to be checked on the sales order.",
      );
    if (item["Outsourced?"] === "Outsourced") {
      node.status = errors.length ? "blocked" : "outsourced";
      warnings.push("Outsourced parts do not need work orders.");
      node.complete = true;
      return node;
    }
    if (item.Type !== "Assembly") {
      node.status = errors.length ? "blocked" : "material";
      warnings.push("This item is not an assembly; no work order is proposed.");
      return node;
    }
    // Approval errors do not prevent estimating available routing hours.
    if (item["DuraMark Approved"] !== "Yes")
      errors.push("DuraMark approval is required.");
    if (item["Customer Approval"] !== "Yes")
      errors.push("Customer approval is required.");
    if (ancestors.includes(itemId)) {
      fail("Circular BOM reference detected.");
      return node;
    }
    const defaults = (data.connectors.get(itemId) || []).filter(
      (r) => r["Master Default?"] === "Yes",
    );
    const unique = [
      ...new Map(
        defaults.map((r) => [r["Bill of Materials Internal ID"], r]),
      ).values(),
    ];
    if (unique.length !== 1) {
      fail(
        unique.length
          ? "Multiple master default BOMs."
          : "No master default BOM.",
      );
      return node;
    }
    const link = unique[0],
      bomId = link["Bill of Materials Internal ID"],
      bomName = link["Item Bill of Materials"];
    node.bom = { id: bomId, name: bomName };
    const rows = data.components.get(bomId) || [];
    node.revisions = [
      ...new Map(
        rows.map((r) => [
          r["Bill of Materials Revision Internal ID"],
          {
            id: r["Bill of Materials Revision Internal ID"],
            name: r["Bill of Materials Revision Name"],
          },
        ]),
      ).values(),
    ];
    const selected =
      node.revisions.length === 1 ? node.revisions[0].id : selections[bomId];
    node.revision = node.revisions.find((r) => r.id === selected) || null;
    if (!node.revision)
      fail(
        node.revisions.length
          ? "Choose a BOM revision."
          : "No BOM revision available.",
      );
    const routingIssue = (message) => {
      node.complete = false;
      if (item["Express Image Item"] === "No")
        warnings.push(
          `${message} Routing is optional because Express Image Item is No; hours estimate is incomplete.`,
        );
      else errors.push(message);
    };
    if ((data.names.get(bomName)?.size || 0) > 1)
      routingIssue("BOM name is ambiguous; routing cannot be matched safely.");
    else {
      const routingRows = (data.routings.get(bomName) || []).filter(
        (r) => r["Default Routing?"] === "Yes",
      );
      const names = [...new Set(routingRows.map((r) => r["Routing Name"]))];
      if (names.length !== 1 || !names[0])
        routingIssue(
          names.length > 1
            ? "Multiple default routings."
            : "No default routing.",
        );
      else {
        node.routing = names[0];
        node.operations = routingRows
          .map((r) => {
            const setup = number(r["Setup Time"]),
              rate = number(r["Run Rate"]);
            const hours =
              setup === null || rate === null
                ? null
                : (setup + rate * qty) / 60;
            return { ...r, hours: Number.isFinite(hours) ? hours : null };
          })
          .sort(
            (a, b) =>
              Number(a["Operation Sequence"]) - Number(b["Operation Sequence"]),
          );
        if (node.operations.some((o) => o.hours === null))
          routingIssue(
            "Routing contains blank or invalid setup/run-rate values.",
          );
        node.hours = node.operations.reduce(
          (sum, o) => sum + (o.hours ?? 0),
          0,
        );
        if (!Number.isFinite(node.hours)) {
          node.hours = 0;
          routingIssue("Routing estimate exceeds the supported numeric range.");
        }
      }
    }
    if (node.revision)
      for (const r of rows.filter(
        (r) => r["Bill of Materials Revision Internal ID"] === node.revision.id,
      )) {
        const per = number(r["Component Quantity"]),
          childQty = per === null ? null : qty * per,
          resolved = resolveComponent(data, r),
          childId = resolved.id;
        if (childQty === null || !Number.isFinite(childQty)) {
          fail(`Invalid component quantity: ${r["Component Name"]}`);
          continue;
        }
        if (resolved.ambiguous) {
          fail(
            `Component name matches multiple assemblies: ${r["Component Name"]}`,
          );
          materials.push({
            id: childId,
            name: r["Component Name"],
            quantity: childQty,
            units: r.Units,
          });
        } else if (resolved.assembly) {
          const child = visit(
            childId,
            childQty,
            [...ancestors, itemId],
            `${key}.${children.length}`,
          );
          if (child) children.push({ ...child, units: r.Units });
        } else
          materials.push({
            id: childId,
            name: r["Component Name"],
            quantity: childQty,
            units: r.Units,
          });
      }
    node.status = errors.length ? "blocked" : "ready";
    return node;
  };
  const root = visit(id, quantity, [], "0");
  let hours = 0,
    complete = !truncated,
    workOrders = 0;
  const sum = (n) => {
    if (n.item.Type === "Assembly" && n.item["Outsourced?"] !== "Outsourced") {
      hours += n.hours;
      workOrders++;
      complete = complete && n.complete;
    } else if (!data.items.has(n.itemId)) complete = false;
    for (const c of n.children) sum(c);
  };
  if (root) sum(root);
  return {
    root,
    totalHours: hours,
    complete,
    workOrders,
    truncated,
    datasetId: data.metadata?.id,
  };
}
