import fs from "node:fs";
import path from "node:path";
import { openStore } from "../server/data.js";
import { createRequestService } from "../server/requests.js";
const filename = process.argv[2];
if (!filename) throw Error("Supply a customer CSV path.");
const store = openStore(process.env.DB_PATH || "data/part-viewer.sqlite");
try {
  console.log(
    JSON.stringify(
      createRequestService(store).importCustomers({
        buffer: fs.readFileSync(filename),
        name: path.basename(filename),
      }),
      null,
      2,
    ),
  );
} finally {
  store.db.close();
}
