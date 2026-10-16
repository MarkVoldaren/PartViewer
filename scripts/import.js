import fs from "node:fs";
import path from "node:path";
import { openStore } from "../server/data.js";
const dir = path.resolve(process.argv[2] || ".");
const prefixes = {
  items: "PARTVIEWERItemMasterList",
  connectors: "PARTVIEWERBomConnector",
  components: "PARTVIEWERBomComponents",
  routings: "PARTVIEWERRoutingSteps",
};
const files = {};
for (const [kind, prefix] of Object.entries(prefixes)) {
  const matches = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".csv"));
  if (matches.length !== 1)
    throw Error(
      `Expected exactly one ${prefix} CSV in ${dir}; found ${matches.length}`,
    );
  files[kind] = {
    name: matches[0],
    buffer: fs.readFileSync(path.join(dir, matches[0])),
  };
}
const store = openStore(process.env.DB_PATH || "data/part-viewer.sqlite");
try {
  console.log(JSON.stringify(store.import(files), null, 2));
} finally {
  store.db.close();
}
