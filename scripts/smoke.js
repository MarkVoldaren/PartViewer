// Run only against a disposable verification instance: this replaces its dataset.
import fs from "node:fs";
import assert from "node:assert/strict";
const base = (process.argv[2] || "http://127.0.0.1:3101") + "/api";
const login = await fetch(base + "/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.APP_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
const prefixes = {
  items: "PARTVIEWERItemMasterList",
  connectors: "PARTVIEWERBomConnector",
  components: "PARTVIEWERBomComponents",
  routings: "PARTVIEWERRoutingSteps",
};
for (let refresh = 1; refresh <= 2; refresh++) {
  const body = new FormData();
  for (const [kind, prefix] of Object.entries(prefixes)) {
    const name = fs
      .readdirSync(".")
      .find((n) => n.startsWith(prefix) && n.endsWith(".csv"));
    body.append(kind, new Blob([fs.readFileSync(name)]), name);
  }
  const start = performance.now();
  const response = await fetch(base + "/import", {
    method: "POST",
    headers: { Cookie: cookie },
    body,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const meta = await response.json();
  assert.ok(meta.counts.items > 140000);
  console.log(
    `Real-data HTTP refresh ${refresh}: ${Math.round(performance.now() - start)}ms, ${meta.counts.items} items`,
  );
}
const result = await fetch(base + "/view", {
  method: "POST",
  headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "200124", quantity: 100 }),
});
assert.equal(result.status, 200);
const view = await result.json();
assert.equal(view.root.status, "ready");
assert.equal(view.root.children[0].itemId, "245264");
assert.equal(view.root.children[0].status, "ready");
assert.ok(view.totalHours > 0);
console.log(
  `Nested assembly verified: ${view.workOrders} work orders, ${view.totalHours.toFixed(3)} hours`,
);
