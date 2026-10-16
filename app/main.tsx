import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Row = Record<string, string>;
type Metadata = {
  id: string;
  importedAt: string;
  files: Record<string, string>;
  counts: Record<string, number>;
  issues: { message: string; count: number }[];
};
type PartNode = {
  key: string;
  itemId: string;
  item: Row;
  quantity: number;
  errors: string[];
  warnings: string[];
  children: PartNode[];
  materials: { id: string; name: string; quantity: number; units: string }[];
  operations: (Row & { hours: number | null })[];
  revisions: { id: string; name: string }[];
  bom: { id: string; name: string } | null;
  revision: { id: string; name: string } | null;
  routing: string | null;
  hours: number;
  complete: boolean;
  status: string;
  units?: string;
};
type View = {
  root: PartNode;
  totalHours: number;
  complete: boolean;
  workOrders: number;
  truncated: boolean;
  datasetId: string;
};
type Hit = { id: string; name: string; type: string; inactive: boolean };
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const hours = (n: number) =>
  n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(import.meta.env.BASE_URL + "api" + url, options);
  const body = await res.json();
  if (!res.ok) throw Error(body.error || "Request failed");
  return body;
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function AssemblySummary({ root }: { root: PartNode }) {
  const counts = { ready: 0, blocked: 0, outsourced: 0 };
  const count = (node: PartNode) => {
    if (node.status in counts) counts[node.status as keyof typeof counts]++;
    node.children.forEach(count);
  };
  count(root);
  const branch = (node: PartNode): React.ReactNode => (
    <li key={node.key}>
      <div className={`summary-node ${node.status}`}>
        <div className="summary-node-heading">
          <strong>{node.item["Item Name"]}</strong>
          <span className={`badge ${node.status}`}>
            {node.status === "ready"
              ? "Ready"
              : node.status === "outsourced"
                ? "Outsourced"
                : node.status === "material"
                  ? "Material"
                  : "Needs attention"}
          </span>
        </div>
        <small>
          #{node.itemId} · Qty {fmt(node.quantity)} {node.units || ""}
        </small>
        {node.errors.length > 0 && (
          <p className="summary-reason">{node.errors.join(" · ")}</p>
        )}
        {node.warnings.length > 0 && node.status !== "outsourced" && (
          <p className="summary-note">{node.warnings.join(" · ")}</p>
        )}
      </div>
      {node.children.length > 0 && <ul>{node.children.map(branch)}</ul>}
    </li>
  );
  return (
    <section
      className="assembly-summary"
      aria-label="Assembly readiness summary"
    >
      <div className="summary-heading">
        <div>
          <p className="eyebrow">At a glance</p>
          <h2>Assembly readiness</h2>
        </div>
        <p>
          {counts.ready} ready · {counts.blocked} need attention ·{" "}
          {counts.outsourced} outsourced
        </p>
      </div>
      <div
        className="summary-scroll"
        tabIndex={0}
        aria-label="Assembly flow chart"
      >
        <ul className="summary-tree">{branch(root)}</ul>
      </div>
      <p className="summary-caption">
        Each assembly is checked independently. Detailed routing steps appear
        below.
      </p>
    </section>
  );
}

function WorkOrder({
  node,
  onRevision,
  depth = 0,
}: {
  node: PartNode;
  onRevision: (bom: string, revision: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2),
    [materials, setMaterials] = useState(false);
  return (
    <div className="branch">
      <article className={"work-order " + node.status}>
        <button
          className="card-heading"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="chevron">{open ? "−" : "+"}</span>
          <span className="card-title">
            <span className="eyebrow">
              {depth === 0 ? "Selected part" : "Child assembly"} · #
              {node.itemId}
            </span>
            <strong>{node.item["Item Name"]}</strong>
          </span>
          <span className={"badge " + node.status}>
            {node.status === "ready"
              ? "Ready for work order"
              : node.status === "outsourced"
                ? "Outsourced"
                : node.status === "material"
                  ? "Material"
                  : "Needs attention"}
          </span>
        </button>
        <div className="card-summary">
          <span>
            Required quantity{" "}
            <b>
              {fmt(node.quantity)} {node.units || ""}
            </b>
          </span>
          <span>
            Routing estimate{" "}
            <b>
              {hours(node.hours)} h{!node.complete ? " · incomplete" : ""}
            </b>
          </span>
          {node.children.length > 0 && (
            <span>
              {node.children.length} child{" "}
              {node.children.length === 1 ? "assembly" : "assemblies"}
            </span>
          )}
        </div>
        <div className="messages">
          {node.errors.map((e, i) => (
            <p className="error" key={"e" + i}>
              <b>!</b>
              {e}
            </p>
          ))}
          {node.warnings.map((w, i) => (
            <p className="warning" key={"w" + i}>
              <b>△</b>
              {w}
            </p>
          ))}
        </div>
        {open && (
          <div className="card-body">
            <dl className="details">
              {[
                "Type",
                "Machine Type",
                "COLORS",
                "Outsourced?",
                "LENGTH",
                "WIDTH",
                "Label Length",
                "Label Width",
                "Customer Approval",
                "DuraMark Approved",
                "Approval Date",
                "UPC Code",
                "ITEMNO1",
                "ITEMNO2",
                "OVERITEMNO",
                "Express Image Item",
                "NOUPL",
                "NOUPW",
              ]
                .filter((k) => node.item[k])
                .map((k) => (
                  <div key={k}>
                    <dt>
                      {k === "Outsourced?"
                        ? "Classification"
                        : k === "COLORS"
                          ? "Colors"
                          : k}
                    </dt>
                    <dd>{node.item[k]}</dd>
                  </div>
                ))}
            </dl>
            {node.bom && (
              <div className="bom-bar">
                <div>
                  <span className="eyebrow">
                    Master default BOM · #{node.bom.id}
                  </span>
                  <strong>{node.bom.name}</strong>
                </div>
                <label>
                  Revision
                  {node.revisions.length > 1 ? (
                    <select
                      value={node.revision?.id || ""}
                      onChange={(e) => onRevision(node.bom!.id, e.target.value)}
                    >
                      <option value="">Select revision…</option>
                      {node.revisions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · #{r.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{node.revision?.name || "Unavailable"}</span>
                  )}
                </label>
              </div>
            )}
            {node.operations.length > 0 && (
              <>
                <div className="section-line">
                  <h3>Routing operations</h3>
                  <span>{node.routing}</span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Operation / cost template</th>
                        <th>Work center</th>
                        <th>Setup min</th>
                        <th>Min / unit</th>
                        <th>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {node.operations.map((op, i) => (
                        <tr key={i}>
                          <td>
                            <span className="step">
                              {op["Operation Sequence"]}
                            </span>
                          </td>
                          <td>
                            <strong>{op["Operation Name"]}</strong>
                            <small>{op["Manufacturing Cost Template"]}</small>
                          </td>
                          <td>{op["Manufacturing Work Center"] || "—"}</td>
                          <td>{op["Setup Time"] || "—"}</td>
                          <td>{op["Run Rate"] || "—"}</td>
                          <td className="number">
                            {op.hours === null ? "Unresolved" : hours(op.hours)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>
                          This work order
                          {!node.complete ? " · estimate incomplete" : ""}
                        </td>
                        <td className="number">{hours(node.hours)} h</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
            {node.materials.length > 0 && (
              <div className="materials">
                <button
                  className="text-button"
                  onClick={() => setMaterials(!materials)}
                  aria-expanded={materials}
                >
                  {materials ? "−" : "+"} {node.materials.length} material
                  components
                </button>
                {materials && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Internal ID</th>
                          <th>Required quantity</th>
                          <th>Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {node.materials.map((m, i) => (
                          <tr key={i}>
                            <td>{m.name}</td>
                            <td>{m.id}</td>
                            <td>{fmt(m.quantity)}</td>
                            <td>{m.units || "Unspecified"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </article>
      {open && node.children.length > 0 && (
        <div className="children">
          <div className="flow-label">
            ↓ Required child work orders · independent readiness
          </div>
          {node.children.map((c) => (
            <WorkOrder
              key={c.key}
              node={c}
              depth={depth + 1}
              onRevision={onRevision}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [metadata, setMetadata] = useState<Metadata | null>(null),
    [tab, setTab] = useState("viewer"),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<Hit[]>([]),
    [selected, setSelected] = useState<Hit | null>(null),
    [quantity, setQuantity] = useState("100"),
    [view, setView] = useState<View | null>(null),
    [busy, setBusy] = useState(false),
    [selections, setSelections] = useState<Record<string, string>>({}),
    [files, setFiles] = useState<Record<string, File>>({}),
    [searchError, setSearchError] = useState("");
  const request = useRef(0),
    searchRequest = useRef(0);
  const loadDataset = async () => {
    const data = await api<Metadata | null>("/dataset");
    setMetadata(data);
    setSelections({});
    setView(null);
    setSelected(null);
    setQuery("");
    request.current++;
  };
  useEffect(() => {
    api("/session")
      .then(() => {
        setAuthenticated(true);
        loadDataset().catch((e) => setError(e.message));
      })
      .catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => {
    const ticket = ++searchRequest.current;
    if (!authenticated || selected || query.trim().length < 1) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api<Hit[]>("/search?q=" + encodeURIComponent(query))
        .then((data) => {
          if (ticket === searchRequest.current) {
            setHits(data);
            setSearchError("");
          }
        })
        .catch((e) => {
          if (ticket === searchRequest.current) setSearchError(e.message);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, selected, authenticated, metadata?.id]);
  const evaluate = async (part: Hit, choices: Record<string, string>) => {
    const ticket = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<View>(
        "/view",
        post({
          id: part.id,
          quantity: Number(quantity),
          selections: choices,
          datasetId: metadata?.id,
        }),
      );
      if (ticket === request.current) setView(result);
    } catch (e) {
      if (ticket === request.current) {
        setView(null);
        setError((e as Error).message);
      }
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  const choose = (part: Hit) => {
    request.current++;
    setBusy(false);
    setError("");
    setSelected(part);
    setSelections({});
    setHits([]);
    setQuery(part.name);
    setView(null);
  };
  if (authenticated === null)
    return (
      <main className="login">
        <p>Opening Part Viewer…</p>
      </main>
    );
  if (!authenticated)
    return (
      <main className="login">
        <form
          className="login-card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              await api("/login", post({ password }));
              setAuthenticated(true);
              setPassword("");
              await loadDataset();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand-icon">
            P<span>V</span>
          </div>
          <p className="eyebrow">Solutions Group · Manufacturing</p>
          <h1>
            Know your part.
            <br />
            Plan your work.
          </h1>
          <p>Sign in to review production readiness and routing estimates.</p>
          <label>
            Account password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      </main>
    );
  return (
    <>
      <header>
        <div className="brand">
          <div className="brand-icon">
            P<span>V</span>
          </div>
          <div>
            <strong>Part Viewer</strong>
            <small>Solutions Group</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={tab === "viewer" ? "active" : ""}
            onClick={() => setTab("viewer")}
          >
            Part explorer
          </button>
          <button
            className={tab === "data" ? "active" : ""}
            onClick={() => setTab("data")}
          >
            Data & imports
          </button>
        </nav>
        <button
          className="logout"
          onClick={async () => {
            await api("/logout", post({}));
            setAuthenticated(false);
            setView(null);
            setHits([]);
            setMetadata(null);
          }}
        >
          Sign out ↗
        </button>
      </header>
      <main className="workspace">
        <div className="page-title">
          <div>
            <p className="eyebrow">Production intelligence</p>
            <h1>
              {tab === "viewer"
                ? "From part to production."
                : "Your production data."}
            </h1>
            <p>
              {tab === "viewer"
                ? "Check readiness. Explore assemblies. Estimate routing hours."
                : "Refresh all four NetSuite saved searches together."}
            </p>
          </div>
          <div className="dataset-status">
            <span className={metadata ? "dot" : "dot empty"} />
            {metadata ? (
              <>
                Dataset imported
                <br />
                <b>{new Date(metadata.importedAt).toLocaleString()}</b>
              </>
            ) : (
              "No dataset imported"
            )}
          </div>
        </div>
        {error && (
          <div className="error global-error" role="alert">
            {error}
          </div>
        )}
        {tab === "viewer" ? (
          <>
            <section className="lookup">
              <div className="search-field">
                <label htmlFor="part-search">Find a part</label>
                <input
                  id="part-search"
                  placeholder="Search part name or internal ID…"
                  value={query}
                  onChange={(e) => {
                    request.current++;
                    searchRequest.current++;
                    setBusy(false);
                    setSelected(null);
                    setSelections({});
                    setView(null);
                    setHits([]);
                    setSearchError("");
                    setError("");
                    setQuery(e.target.value);
                  }}
                  autoComplete="off"
                  disabled={!metadata}
                />
                {query && !selected && (
                  <div className="search-results">
                    {searchError ? (
                      <p>{searchError}</p>
                    ) : hits.length ? (
                      hits.map((h) => (
                        <button key={h.id} onClick={() => choose(h)}>
                          <strong>{h.name}</strong>
                          <span>
                            #{h.id} · {h.type}
                            {h.inactive ? " · Inactive" : ""}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p>No matching parts</p>
                    )}
                  </div>
                )}
              </div>
              <form
                className="quantity-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (selected) evaluate(selected, selections);
                }}
              >
                <label htmlFor="qty">
                  Production quantity
                  <input
                    id="qty"
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => {
                      request.current++;
                      setBusy(false);
                      setQuantity(e.target.value);
                      setView(null);
                    }}
                    required
                  />
                </label>
                <button className="primary" disabled={!selected || busy}>
                  {busy ? "Calculating…" : "Review part →"}
                </button>
              </form>
            </section>
            {selected && (
              <p className="selected-part">
                Selected: <b>{selected.name}</b> · #{selected.id}
              </p>
            )}
            {view ? (
              <>
                <AssemblySummary root={view.root} />
                <section className="metrics">
                  <div>
                    <span>Selected part</span>
                    <strong>
                      {view.root.status === "ready"
                        ? "Ready"
                        : view.root.status === "outsourced"
                          ? "Outsourced"
                          : view.root.status === "material"
                            ? "Material"
                            : "Needs attention"}
                    </strong>
                    <small>Readiness is independent for each assembly</small>
                  </div>
                  <div>
                    <span>Proposed work orders</span>
                    <strong>{fmt(view.workOrders)}</strong>
                    <small>Separate work order per occurrence</small>
                  </div>
                  <div>
                    <span>Total routing estimate</span>
                    <strong>
                      {hours(view.totalHours)} <em>hours</em>
                    </strong>
                    <small>
                      {view.complete
                        ? "All displayed estimates resolved"
                        : "Incomplete · resolve highlighted data"}
                    </small>
                  </div>
                </section>
                <div className="section-line">
                  <h2>Assembly & routing flow</h2>
                  <span>Setup + (run rate × quantity), converted to hours</span>
                </div>
                {view.truncated && (
                  <p className="warning">
                    Display limited to 2,000 assembly occurrences and 100
                    levels. Total hours are incomplete. Look up a child assembly
                    separately to inspect further.
                  </p>
                )}
                <WorkOrder
                  key={view.datasetId + view.root.itemId}
                  node={view.root}
                  onRevision={(bom, revision) => {
                    const choices = { ...selections, [bom]: revision };
                    setSelections(choices);
                    if (selected) evaluate(selected, choices);
                  }}
                />
              </>
            ) : (
              <section className="empty-state">
                <div className="empty-symbol">⌕</div>
                <h2>
                  {metadata
                    ? "Start with a part."
                    : "Bring your data into view."}
                </h2>
                <p>
                  {metadata
                    ? "Search your NetSuite item master, then enter the quantity you plan to produce."
                    : "Import the four saved searches to explore readiness, routing operations, and underlying assemblies."}
                </p>
                {!metadata && (
                  <button className="primary" onClick={() => setTab("data")}>
                    Import NetSuite exports →
                  </button>
                )}
                {selected && (
                  <p>
                    Review <b>{selected.name}</b> with the quantity above.
                  </p>
                )}
              </section>
            )}
          </>
        ) : (
          <>
            <section className="import-panel">
              <div>
                <p className="eyebrow">One consistent snapshot</p>
                <h2>Import NetSuite exports</h2>
                <p>
                  Choose all four CSV files. A refresh replaces the dataset only
                  after validation succeeds.
                </p>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const body = new FormData();
                    for (const [key, file] of Object.entries(files))
                      body.append(key, file);
                    await api("/import", { method: "POST", body });
                    await loadDataset();
                    setFiles({});
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {[
                  [
                    "items",
                    "Item master",
                    "Includes Type, approvals and part attributes",
                  ],
                  [
                    "connectors",
                    "BOM connectors",
                    "Connects items to master default BOMs",
                  ],
                  [
                    "components",
                    "BOM components",
                    "Revisions, component quantities and units",
                  ],
                  [
                    "routings",
                    "Routing steps",
                    "Default routings, operations and times",
                  ],
                ].map(([key, label, hint]) => (
                  <label className="file-field" key={key}>
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      required
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.files?.[0])
                          setFiles({ ...files, [key]: e.target.files[0] });
                      }}
                    />
                  </label>
                ))}
                <button
                  className="primary"
                  disabled={busy || Object.keys(files).length !== 4}
                >
                  {busy
                    ? "Validating and importing…"
                    : "Validate & replace dataset →"}
                </button>
              </form>
            </section>
            {metadata && (
              <section className="data-panel">
                <h2>Current dataset</h2>
                <p>
                  Imported {new Date(metadata.importedAt).toLocaleString()} ·
                  Data persists across sessions.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Export</th>
                        <th>Filename</th>
                        <th>Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(metadata.files).map(([key, name]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>{name}</td>
                          <td>{fmt(metadata.counts[key])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>Data quality</h3>
                {metadata.issues.length ? (
                  metadata.issues.map((i) => (
                    <p className="warning" key={i.message}>
                      {i.message}: <b>{fmt(i.count)}</b>
                    </p>
                  ))
                ) : (
                  <p>No structural issues detected.</p>
                )}
                <p className="muted">
                  Readiness checks are evaluated separately for each part.
                  Source exports determine the accuracy of these estimates.
                </p>
              </section>
            )}
          </>
        )}
        <footer>
          <span>Part Viewer · NetSuite export workspace</span>
          <span>Planning estimates · No work orders are created</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
