import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore, schemas } from "../server/data.js";
import { createRequestService } from "../server/requests.js";
import { createApp } from "../server/index.js";

function data() {
  const item = (id, extra = {}) =>
    Object.fromEntries(
      schemas.items.map((k) => [
        k,
        {
          "Item Internal ID": id,
          "Item Name": "Assembly " + id,
          Type: "Assembly",
          "Costing Method": "Average",
          Inactive: "No",
          "Outsourced?": "Printed",
          "Express Image Item": "Yes",
          "Customer Approval": "No",
          "DuraMark Approved": "No",
          ...extra,
        }[k] || "",
      ]),
    );
  return {
    items: [
      item("1"),
      item("2", { "Costing Method": "Lot Numbered" }),
      item("3", { Inactive: "Yes", "Outsourced?": "Outsourced" }),
      item("4", { Type: "Inventory Item" }),
      item("5", { "Costing Method": "" }),
    ],
    connectors: [
      {
        "Item Name": "Assembly 1",
        "Item Internal ID": "1",
        "Item Bill of Materials": "BOM 1",
        "Bill of Materials Internal ID": "10",
        "Master Default?": "Yes",
      },
    ],
    components: [
      {
        "Bill of Materials Internal ID": "10",
        "Bill of Materials Name": "BOM 1",
        "Bill of Materials Revision Internal ID": "100",
        "Bill of Materials Revision Name": "R1",
        "Component Name": "Material",
        "Component Internal ID": "4",
        "Component Quantity": "1",
        Units: "Ea",
      },
    ],
    routings: [
      {
        "Bill of Materials Name": "Other",
        "Routing Name": "Other",
        "Default Routing?": "No",
        "Operation Sequence": "1",
        "Operation Name": "Cut",
        "Manufacturing Work Center": "Cut",
        "Manufacturing Cost Template": "Cut",
        "Setup Time": "10",
        "Run Rate": "1",
      },
    ],
  };
}
function csv(rows) {
  const headers = Object.keys(rows[0]);
  const q = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return Buffer.from(
    [
      headers.map(q).join(","),
      ...rows.map((r) => headers.map((h) => q(r[h])).join(",")),
    ].join("\n"),
  );
}
const files = () =>
  Object.fromEntries(
    Object.entries(data()).map(([kind, rows]) => [
      kind,
      { buffer: csv(rows), name: kind + ".csv" },
    ]),
  );
function setup(filename = ":memory:") {
  const store = openStore(filename);
  store.import(files());
  const service = createRequestService(
    store,
    () => new Date("2026-10-19T02:30:00Z"),
  );
  service.importCustomers({
    buffer: Buffer.from(
      "Name,DuraMark ID Number\nCustomer A,1\nCustomer B,1\n",
    ),
    name: "customers.csv",
  });
  return { store, service, customerId: service.customers()[0].id };
}
const payload = (s, extra = {}) => ({
  requester: "Jay",
  urgent: false,
  scopes: { assembly: true, bom: true, routing: true },
  targetItemId: null,
  oldItemId: null,
  quotePartNumber: "Quote-1",
  customerId: s.customerId,
  customerApproval: false,
  duramarkApproval: false,
  notes: "",
  approvalMismatchReason: "",
  eligibilityExceptionReason: "",
  datasetId: s.store.current.metadata.id,
  ...extra,
});

test("existing and quote-only requests use Chicago dates, preserve snapshots and do not require readiness", () => {
  const s = setup();
  try {
    const quote = s.service.save(payload(s));
    assert.equal(quote.date, "2026-10-18");
    assert.equal(quote.number, "BR-000001");
    assert.equal(quote.status, "open");
    assert.equal(quote.targetSnapshot, null);
    const linked = s.service.save(
      payload(s, { quotePartNumber: "", targetItemId: "1" }),
    );
    assert.equal(linked.targetSnapshot.findings.status, "blocked");
    assert.equal(linked.targetSnapshot.eligible, true);
    assert.equal(linked.customerName, "Customer A");
    assert.equal(s.service.detail(linked.id).history.length, 1);
  } finally {
    s.store.db.close();
  }
});

test("server rejects missing required fields, invalid scopes, approvals and ineligible items", () => {
  const s = setup();
  try {
    for (const invalid of [
      { requester: "" },
      { scopes: { assembly: false, bom: false, routing: false } },
      { quotePartNumber: "" },
      { customerId: 999 },
      { customerApproval: true },
      { urgent: "yes" },
      { targetItemId: "2" },
      { targetItemId: "4" },
      { targetItemId: "5" },
    ])
      assert.throws(() => s.service.save(payload(s, invalid)));
    assert.equal(s.service.list().length, 0);
    const valid = s.service.save(
      payload(s, {
        customerApproval: true,
        approvalMismatchReason: "Customer approved before internal review.",
      }),
    );
    assert.ok(valid.approvalMismatchReason);
    assert.throws(() => s.service.save(payload(s), 0), /Invalid request ID/);
  } finally {
    s.store.db.close();
  }
});

test("inactive/outsourced targets require a distinct explanation", () => {
  const s = setup();
  try {
    assert.throws(
      () => s.service.save(payload(s, { targetItemId: "3" })),
      /inactive or outsourced/,
    );
    assert.throws(
      () =>
        s.service.save(
          payload(s, {
            targetItemId: "3",
            approvalMismatchReason: "Not an item exception.",
          }),
        ),
      /inactive or outsourced/,
    );
    const r = s.service.save(
      payload(s, {
        targetItemId: "3",
        eligibilityExceptionReason:
          "Reactivating this part for local manufacturing.",
      }),
    );
    assert.equal(r.targetSnapshot.exceptions.length, 2);
  } finally {
    s.store.db.close();
  }
});

test("old lot-numbered item is reference-only, quote required, reference retained when target linked", () => {
  const s = setup();
  try {
    assert.throws(
      () => s.service.save(payload(s, { oldItemId: "2", quotePartNumber: "" })),
      /quote part number/,
    );
    assert.throws(
      () => s.service.save(payload(s, { oldItemId: "1" })),
      /lot-numbered/,
    );
    let r = s.service.save(payload(s, { oldItemId: "2" }));
    assert.equal(r.targetItemId, null);
    assert.equal(r.oldItemSnapshot.lotNumbered, true);
    s.service.save(
      payload(s, { oldItemId: "2", quotePartNumber: "Different quote" }),
    );
    r = s.service.save(
      {
        version: r.version,
        targetItemId: "1",
        datasetId: s.store.current.metadata.id,
      },
      r.id,
    );
    assert.equal(r.oldItemId, "2");
    assert.equal(r.targetItemId, "1");
    assert.equal(s.service.detail(r.id).history.length, 2);
  } finally {
    s.store.db.close();
  }
});

test("duplicates prevent creates, edits, linking and reopen while completed requests may repeat", () => {
  const s = setup();
  try {
    let a = s.service.save(payload(s, { targetItemId: "1" }));
    assert.throws(
      () =>
        s.service.save(
          payload(s, {
            targetItemId: "1",
            customerId: s.service.customers()[1].id,
            quotePartNumber: "Different",
          }),
        ),
      (e) => e.status === 409 && e.details.conflictId === a.id,
    );
    assert.throws(
      () => s.service.save(payload(s, { quotePartNumber: "  qUoTe-1  " })),
      (e) => e.status === 409,
    );
    let b = s.service.save(payload(s, { quotePartNumber: "Quote-2" }));
    assert.throws(
      () =>
        s.service.save(
          { version: b.version, quotePartNumber: "Quote-1" },
          b.id,
        ),
      (e) => e.status === 409,
    );
    assert.throws(
      () =>
        s.service.save(
          {
            version: b.version,
            targetItemId: "1",
            datasetId: s.store.current.metadata.id,
          },
          b.id,
        ),
      (e) => e.status === 409,
    );
    a = s.service.save({ version: a.version, status: "completed" }, a.id);
    assert.ok(a.completedAt);
    b = s.service.save(
      {
        version: b.version,
        quotePartNumber: "Quote-1",
        targetItemId: "1",
        datasetId: s.store.current.metadata.id,
      },
      b.id,
    );
    assert.throws(
      () => s.service.save({ version: a.version, status: "open" }, a.id),
      (e) => e.status === 409,
    );
    assert.equal(s.service.get(a.id).status, "completed");
    b = s.service.save({ version: b.version, status: "completed" }, b.id);
    a = s.service.save({ version: a.version, status: "open" }, a.id);
    assert.equal(a.completedAt, null);
  } finally {
    s.store.db.close();
  }
});

test("stale item dataset and request versions cannot overwrite requests", () => {
  const s = setup();
  try {
    assert.throws(
      () => s.service.save(payload(s, { targetItemId: "1", datasetId: "old" })),
      (e) => e.details.datasetChanged,
    );
    const r = s.service.save(payload(s));
    const updated = s.service.save(
      { version: r.version, notes: "Changed" },
      r.id,
    );
    assert.throws(
      () => s.service.save({ version: r.version, notes: "Lost edit" }, r.id),
      (e) => e.details.versionConflict,
    );
    assert.equal(s.service.get(r.id).notes, "Changed");
    assert.equal(s.service.detail(r.id).history.length, 2);
    assert.equal(updated.version, 2);
  } finally {
    s.store.db.close();
  }
});

test("independent customer refresh preserves IDs, retires absent names and rolls back malformed imports", () => {
  const s = setup();
  try {
    const r = s.service.save(payload(s));
    const id = s.customerId;
    s.service.importCustomers({
      buffer: Buffer.from("Name\nCustomer B\nCustomer C"),
      name: "new.csv",
    });
    assert.equal(s.service.customers().length, 2);
    assert.throws(
      () => s.service.save(payload(s, { quotePartNumber: "New quote" })),
      /current customer/,
    );
    assert.equal(
      s.service.save(
        { version: r.version, notes: "Historical customer retained" },
        r.id,
      ).customerName,
      "Customer A",
    );
    assert.throws(() =>
      s.service.importCustomers({
        buffer: Buffer.from("Name\nDuplicate\nDuplicate"),
        name: "bad.csv",
      }),
    );
    assert.equal(s.service.customers().length, 2);
    s.service.importCustomers({
      buffer: Buffer.from("Name\nCustomer A\nCustomer B"),
      name: "return.csv",
    });
    assert.equal(
      s.service.customers().find((c) => c.name === "Customer A").id,
      id,
    );
  } finally {
    s.store.db.close();
  }
});

test("item refresh and restart retain requests, history, customers and submission snapshots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "request-test-"));
  const filename = path.join(dir, "db.sqlite");
  const s = setup(filename);
  let reopened;
  try {
    const r = s.service.save(payload(s, { targetItemId: "1" }));
    const input = files();
    const replacement = data();
    replacement.items[0]["Item Name"] = "Changed assembly";
    input.items.buffer = csv(replacement.items);
    s.store.import(input);
    assert.equal(s.service.get(r.id).targetSnapshot.name, "Assembly 1");
    assert.equal(s.service.customers().length, 2);
    s.store.db.close();
    reopened = openStore(filename);
    const service = createRequestService(reopened);
    assert.equal(service.detail(r.id).history.length, 1);
    assert.equal(service.get(r.id).targetSnapshot.name, "Assembly 1");
    assert.equal(service.customers().length, 2);
  } finally {
    (reopened || s.store).db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("queue orders urgent first and oldest first, supports all filters", () => {
  const s = setup();
  try {
    const first = s.service.save(payload(s));
    const urgent = s.service.save(
      payload(s, {
        quotePartNumber: "UrgentQuote",
        urgent: true,
        requester: "Terri",
        scopes: { assembly: false, bom: false, routing: true },
      }),
    );
    assert.deepEqual(
      s.service.list().map((r) => r.id),
      [urgent.id, first.id],
    );
    assert.equal(s.service.list({ urgent: true }).length, 1);
    assert.equal(s.service.list({ scope: "bom" }).length, 1);
    assert.equal(
      s.service.list({
        requester: "terri",
        q: "urgentquote",
        customerId: s.customerId,
      }).length,
      1,
    );
  } finally {
    s.store.db.close();
  }
});

test("request APIs require login and simultaneous duplicate submissions produce one record", async () => {
  const s = setup();
  const app = createApp({ store: s.store, password: "test-password-123" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    for (const route of ["/requests", "/customers", "/items/1/intake"])
      assert.equal((await fetch(base + route)).status, 401);
    const login = await fetch(
      base + "/login",
      json({ password: "test-password-123" }),
    );
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const send = () =>
      fetch(base + "/requests", {
        ...json(payload(s)),
        headers: { ...json({}).headers, Cookie: cookie },
      });
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const conflict = await responses.find((r) => r.status === 409).json();
    assert.ok(conflict.conflictId);
    assert.equal(s.service.list().length, 1);
    const body = new FormData();
    body.append("customers", new Blob(["Name\nNew Customer"]), "customers.csv");
    assert.equal(
      (
        await fetch(base + "/customers/import", {
          method: "POST",
          headers: { Cookie: cookie },
          body,
        })
      ).status,
      200,
    );
    assert.equal(s.service.list().length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    s.store.db.close();
  }
});
