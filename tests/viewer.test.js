import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { indexData, buildTree, openStore, schemas } from "../server/data.js";
import { createApp } from "../server/index.js";

const item = (id, fields = {}) => ({
  "Item Internal ID": id,
  "Item Name": "Part " + id,
  Type: "Assembly",
  Inactive: "No",
  "DuraMark Approved": "Yes",
  "Customer Approval": "Yes",
  "Variable Data": "No",
  "Outsourced?": "Printed",
  ...fields,
});
const link = (id, bom = id) => ({
  "Item Internal ID": id,
  "Item Name": "Part " + id,
  "Bill of Materials Internal ID": bom,
  "Item Bill of Materials": "BOM " + bom,
  "Master Default?": "Yes",
});
const component = (bom, child, quantity = "1", revision = "100") => ({
  "Bill of Materials Internal ID": bom,
  "Bill of Materials Name": "BOM " + bom,
  "Bill of Materials Revision Internal ID": revision,
  "Bill of Materials Revision Name": "Revision " + revision,
  "Component Internal ID": child,
  "Component Name": "Part " + child,
  "Component Quantity": quantity,
  Units: "Ea",
});
const operation = (bom, seq = "1", fields = {}) => ({
  "Bill of Materials Name": "BOM " + bom,
  "Routing Name": "Route " + bom,
  "Default Routing?": "Yes",
  "Operation Sequence": seq,
  "Operation Name": "Print",
  "Manufacturing Work Center": "Press",
  "Manufacturing Cost Template": "Print",
  "Setup Time": "30",
  "Run Rate": "2",
  ...fields,
});
function fixture() {
  return {
    items: [item("1"), item("2"), item("3", { Type: "Inventory Item" })],
    connectors: [link("1"), link("2")],
    components: [
      component("1", "2", "0.5"),
      component("1", "2", "0.25"),
      component("2", "3", "3"),
    ],
    routings: [operation("1", "10"), operation("1", "2"), operation("2")],
  };
}
const view = (tables) => buildTree(indexData(tables, { id: "test" }), "1", 10);
const csv = (rows) => {
  const keys = Object.keys(rows[0]);
  const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return Buffer.from(
    [
      keys.map(quote).join(","),
      ...rows.map((r) => keys.map((k) => quote(r[k])).join(",")),
    ].join("\n"),
  );
};
function files(tables) {
  return Object.fromEntries(
    Object.entries(tables).map(([key, rows]) => [
      key,
      {
        name: key + ".csv",
        buffer: csv(
          rows.map((r) => ({
            ...Object.fromEntries(schemas[key].map((h) => [h, ""])),
            ...r,
          })),
        ),
      },
    ]),
  );
}

test("nested fractions, separate occurrences, numeric sequence and setup per work order", () => {
  const result = view(fixture());
  assert.equal(result.root.status, "ready");
  assert.deepEqual(
    result.root.operations.map((o) => o["Operation Sequence"]),
    ["2", "10"],
  );
  assert.deepEqual(
    result.root.children.map((n) => n.quantity),
    [5, 2.5],
  );
  assert.equal(result.root.children[0].materials[0].quantity, 15);
  assert.equal(result.workOrders, 3);
  assert.ok(Math.abs(result.totalHours - (50 + 50 + 40 + 35) / 60) < 1e-10);
  assert.equal(result.complete, true);
});
test("all approvals and inactivity errors; variable data warning; child independent", () => {
  const t = fixture();
  Object.assign(t.items[1], {
    "DuraMark Approved": "",
    "Customer Approval": "No",
    Inactive: "Yes",
    "Variable Data": "Yes",
  });
  const r = view(t);
  assert.equal(r.root.status, "ready");
  assert.equal(r.root.children[0].status, "blocked");
  assert.equal(r.root.children[0].errors.length, 3);
  assert.match(r.root.children[0].warnings[0], /PRO/);
  assert.equal(r.complete, true);
});
test("outsourced stops expansion and hours, BOTH does not", () => {
  const t = fixture();
  t.items[1]["Outsourced?"] = "Outsourced";
  const r = view(t);
  assert.equal(r.workOrders, 1);
  assert.equal(r.root.children[0].status, "outsourced");
  assert.equal(r.root.children[0].children.length, 0);
  t.items[1]["Outsourced?"] = "BOTH";
  assert.equal(view(t).workOrders, 3);
  t.items[1].Inactive = "Yes";
  t.items[1]["Outsourced?"] = "Outsourced";
  assert.equal(view(t).root.children[0].status, "blocked");
});
test("missing and multiple defaults block", () => {
  const t = fixture();
  t.connectors = [];
  assert.match(view(t).root.errors.join(), /No master/);
  t.connectors = [link("1"), link("1", "4")];
  assert.match(view(t).root.errors.join(), /Multiple master/);
});
test("manual revision selection is applied to all repeated occurrences", () => {
  const t = fixture();
  t.components.push(component("2", "3", "9", "101"));
  const d = indexData(t, { id: "test" });
  let r = buildTree(d, "1", 10);
  assert.match(r.root.children[0].errors.join(), /Choose a BOM revision/);
  assert.equal(r.complete, false);
  r = buildTree(d, "1", 10, { 2: "101" });
  assert.equal(r.root.children[0].materials[0].quantity, 45);
  assert.equal(r.root.children[1].revision.id, "101");
});
test("missing/ambiguous routing and invalid times; zero times valid", () => {
  const t = fixture();
  t.routings = [];
  assert.match(view(t).root.errors.join(), /No default routing/);
  t.routings = [
    operation("1"),
    operation("1", "2", { "Routing Name": "Other" }),
  ];
  assert.match(view(t).root.errors.join(), /Multiple default/);
  t.routings = [operation("1", "1", { "Setup Time": "", "Run Rate": "2" })];
  assert.equal(view(t).root.operations[0].hours, null);
  t.routings = [operation("1", "1", { "Setup Time": "0", "Run Rate": "0" })];
  assert.equal(view(t).root.status, "ready");
  assert.equal(view(t).root.hours, 0);
});
test("Express Image Item No makes routing optional without bypassing other checks", () => {
  const t = fixture();
  t.items[0]["Express Image Item"] = "No";
  t.routings = [];
  let result = view(t);
  assert.equal(result.root.status, "ready");
  assert.equal(result.root.complete, false);
  assert.match(result.root.warnings.join(), /Routing is optional/);
  t.routings = [operation("1", "1", { "Setup Time": "" })];
  result = view(t);
  assert.equal(result.root.status, "ready");
  assert.equal(result.root.operations[0].hours, null);
  t.items[0]["Customer Approval"] = "No";
  assert.equal(view(t).root.status, "blocked");
  t.items[0]["Customer Approval"] = "Yes";
  for (const value of ["Yes", "", undefined]) {
    t.items[0]["Express Image Item"] = value;
    assert.equal(view(t).root.status, "blocked");
  }
});
test("ambiguous BOM names never attach a routing", () => {
  const t = fixture();
  t.connectors.push({ ...link("2", "4"), "Item Bill of Materials": "BOM 1" });
  assert.match(view(t).root.errors.join(), /ambiguous/);
  assert.equal(view(t).root.operations.length, 0);
});
test("cycle, missing items, invalid quantities and absent revisions are visible", () => {
  const t = fixture();
  t.components = [component("1", "2"), component("2", "1")];
  let r = view(t);
  assert.match(r.root.children[0].children[0].errors.join(), /Circular/);
  assert.equal(r.complete, false);
  t.components = [component("1", "999")];
  assert.equal(view(t).root.children.length, 0);
  assert.equal(view(t).root.materials[0].id, "999");
  t.components = [component("1", "2", "-2")];
  assert.match(view(t).root.errors.join(), /Invalid component quantity/);
  t.components = [];
  assert.match(view(t).root.errors.join(), /No BOM revision/);
});
test("non-assembly items are materials without work order checks", () => {
  const t = fixture();
  t.items[0].Type = "Inventory Item";
  t.items[0]["Customer Approval"] = "";
  const r = view(t);
  assert.equal(r.root.status, "material");
  assert.equal(r.workOrders, 0);
});
test("component record IDs resolve unique assembly names; unmatched materials need no item join", () => {
  const t = fixture();
  t.components[0]["Component Internal ID"] = "999";
  t.components[1]["Component Internal ID"] = "998";
  t.components[2]["Component Internal ID"] = "997";
  const r = view(t);
  assert.equal(r.root.children.length, 2);
  assert.equal(r.root.children[0].itemId, "2");
  assert.equal(r.root.children[0].materials.length, 1);
  assert.equal(r.root.children[0].materials[0].id, "997");
  assert.equal(r.complete, true);
  assert.equal(r.root.children[0].warnings.length, 0);
});
test("ambiguous assembly names block expansion without guessing", () => {
  const t = fixture();
  t.items.push(item("4", { "Item Name": "Part 2" }));
  t.components[0]["Component Internal ID"] = "999";
  const r = view(t);
  assert.match(r.root.errors.join(), /matches multiple assemblies/);
  assert.equal(r.root.children.length, 1);
  assert.equal(r.complete, false);
});
test("import commits atomically and persists after reopening", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-test-"));
  const filename = path.join(dir, "db.sqlite");
  let store = openStore(filename);
  try {
    const first = store.import(files(fixture()));
    const invalid = files(fixture());
    invalid.items.buffer = Buffer.from("wrong\nheader");
    assert.throws(() => store.import(invalid), /missing required/);
    assert.equal(store.current.metadata.id, first.id);
    const duplicate = fixture();
    duplicate.items.push(duplicate.items[0]);
    assert.throws(() => store.import(files(duplicate)), /Duplicate item/);
    const badId = fixture();
    badId.items[0]["Item Internal ID"] = "bad";
    assert.throws(() => store.import(files(badId)), /invalid Item Internal ID/);
    store.db.close();
    store = openStore(filename);
    assert.equal(store.current.metadata.id, first.id);
    assert.equal(store.current.items.size, 3);
  } finally {
    store.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("API authentication, CSRF, quantity, refresh, import failure and logout", async () => {
  const store = openStore(":memory:");
  store.import(files(fixture()));
  const app = createApp({ store, password: "test-password-123" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await fetch(base + "/dataset")).status, 401);
    assert.equal(
      (await fetch(base + "/login", json({ password: "wrong" }))).status,
      401,
    );
    const login = await fetch(
      base + "/login",
      json({ password: "test-password-123" }),
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const auth = (body) => ({
      ...json(body),
      headers: { ...json(body).headers, Cookie: cookie },
    });
    assert.equal(
      (await fetch(base + "/search?q=1", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal(
      (await fetch(base + "/view", auth({ id: "1", quantity: 0 }))).status,
      400,
    );
    assert.equal(
      (
        await fetch(
          base + "/view",
          auth({ id: "1", quantity: 10, datasetId: "old" }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await fetch(base + "/view", {
          ...auth({ id: "1", quantity: 10 }),
          headers: { ...auth({}).headers, Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const good = await fetch(base + "/view", auth({ id: "1", quantity: 10 }));
    assert.equal((await good.json()).workOrders, 3);
    const before = store.current.metadata.id;
    const body = new FormData();
    for (const [key, file] of Object.entries(files(fixture())))
      body.append(key, new Blob([file.buffer]), file.name);
    assert.equal(
      (
        await fetch(base + "/import", {
          method: "POST",
          headers: { Cookie: cookie },
          body,
        })
      ).status,
      200,
    );
    assert.notEqual(store.current.metadata.id, before);
    const current = store.current.metadata.id;
    assert.equal(
      (
        await fetch(base + "/import", {
          method: "POST",
          headers: { Cookie: cookie },
          body: new FormData(),
        })
      ).status,
      400,
    );
    assert.equal(store.current.metadata.id, current);
    await fetch(base + "/logout", auth({}));
    assert.equal(
      (await fetch(base + "/dataset", { headers: { Cookie: cookie } })).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.db.close();
  }
});

test(
  "supplied NetSuite dataset import and search performance",
  { skip: !fs.existsSync("PARTVIEWERItemMasterListResults895.csv") },
  () => {
    const prefixes = {
      items: "PARTVIEWERItemMasterList",
      connectors: "PARTVIEWERBomConnector",
      components: "PARTVIEWERBomComponents",
      routings: "PARTVIEWERRoutingSteps",
    };
    const inputs = Object.fromEntries(
      Object.entries(prefixes).map(([kind, prefix]) => {
        const name = fs
          .readdirSync(".")
          .find((n) => n.startsWith(prefix) && n.endsWith(".csv"));
        return [kind, { name, buffer: fs.readFileSync(name) }];
      }),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-real-"));
    const filename = path.join(dir, "db.sqlite");
    const store = openStore(filename);
    try {
      const start = performance.now();
      const metadata = store.import(inputs);
      assert.ok(metadata.counts.items > 140000);
      let searches = 0;
      const searchStart = performance.now();
      for (const q of ["label", "123022", "toro", "zzzzzz"]) {
        const results = [];
        for (const [id, item] of store.current.items)
          if (id === q || item["Item Name"].toLowerCase().includes(q)) {
            results.push(id);
            if (results.length === 50) break;
          }
        searches += results.length;
      }
      const duration = performance.now() - searchStart;
      assert.ok(duration < 2000, `Search batch took ${duration}ms`);
      const result = buildTree(store.current, "123022", 100);
      assert.ok(result.root);
      console.log(
        `Real exports: ${metadata.counts.items} items, import ${(searchStart - start).toFixed(0)}ms; four searches ${duration.toFixed(0)}ms, ${searches} matches; sample status ${result.root.status}`,
      );
      const reopened = execFileSync(
        process.execPath,
        [
          "--max-old-space-size=384",
          "--input-type=module",
          "-e",
          "import {openStore} from './server/data.js'; const s=openStore(process.argv[1]); console.log(s.current.items.size); s.db.close();",
          filename,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(Number(reopened.trim()), metadata.counts.items);
    } finally {
      store.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
