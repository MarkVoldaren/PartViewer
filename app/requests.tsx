import React, { useEffect, useRef, useState } from "react";
import { api, ApiError, post } from "./http";
import "./requests.css";

type Option = {
  id: string | number;
  name: string;
  type?: string;
  inactive?: boolean;
  active?: number;
};
type Assessment = {
  id: string;
  name: string;
  type: string;
  costingMethod: string;
  lotNumbered: boolean;
  inactive: boolean;
  outsourced: boolean;
  customerApproval: boolean;
  duramarkApproval: boolean;
  eligible: boolean;
  errors: string[];
  exceptions: string[];
  findings: { status: string; errors: string[]; warnings: string[] };
  datasetId: string;
};
type Scopes = { assembly: boolean; bom: boolean; routing: boolean };
type RequestRecord = {
  id: number;
  number: string;
  version: number;
  status: "open" | "completed";
  date: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  requester: string;
  urgent: boolean;
  scopes: Scopes;
  targetItemId: string | null;
  oldItemId: string | null;
  targetSnapshot: Assessment | null;
  oldItemSnapshot: Assessment | null;
  quotePartNumber: string;
  customerId: number;
  customerName: string;
  customerApproval: boolean;
  duramarkApproval: boolean;
  notes: string;
  approvalMismatchReason: string;
  eligibilityExceptionReason: string;
  history?: {
    at: string;
    action: string;
    changes: Record<string, { before: unknown; after: unknown }>;
  }[];
};
const labels: Record<keyof Scopes, string> = {
  assembly: "Assembly information",
  bom: "BOM",
  routing: "Routing",
};
const work = (scopes: Scopes) =>
  Object.entries(labels)
    .filter(([k]) => scopes[k as keyof Scopes])
    .map(([, v]) => v)
    .join(" · ");
const yes = (value: boolean) => (value ? "Yes" : "No");
const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { timeZone: "America/Chicago" });

function Lookup({
  label,
  endpoint,
  value,
  onSelect,
  disabled = false,
}: {
  label: string;
  endpoint: string;
  value: Option | null;
  onSelect: (value: Option | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(value?.name || ""),
    [active, setActive] = useState(false),
    [options, setOptions] = useState<Option[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const ticket = useRef(0);
  useEffect(() => {
    if (value) {
      setQuery(value.name);
      setActive(false);
    }
  }, [value?.id, value?.name]);
  useEffect(() => {
    const current = ++ticket.current;
    if (!active) return;
    if (endpoint === "/search" && !query.trim()) {
      setOptions([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError("");
    const timer = setTimeout(
      () =>
        api<Option[]>(endpoint + "?q=" + encodeURIComponent(query))
          .then((rows) => {
            if (current === ticket.current) setOptions(rows.slice(0, 50));
          })
          .catch((e) => {
            if (current === ticket.current) setError(e.message);
          })
          .finally(() => {
            if (current === ticket.current) setBusy(false);
          }),
      180,
    );
    return () => clearTimeout(timer);
  }, [query, active, endpoint]);
  const inputId = React.useId();
  return (
    <div className="request-lookup">
      <label htmlFor={inputId}>{label}</label>
      <div className="lookup-input">
        <input
          id={inputId}
          disabled={disabled}
          value={query}
          placeholder={
            endpoint === "/search"
              ? "Search item name or internal ID…"
              : "Search full customer name…"
          }
          autoComplete="off"
          aria-expanded={active}
          onFocus={() => {
            if (!value) setActive(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setActive(false);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOptions([]);
            setActive(true);
            onSelect(null);
          }}
        />
        {value && (
          <button
            type="button"
            className="clear-selection"
            aria-label={"Clear " + label}
            disabled={disabled}
            onClick={() => {
              setQuery("");
              setActive(false);
              onSelect(null);
            }}
          >
            ×
          </button>
        )}
      </div>
      {active && (
        <div className="search-results">
          <button
            type="button"
            className="lookup-close"
            onClick={() => setActive(false)}
          >
            Close suggestions ×
          </button>
          {busy ? (
            <p>Searching…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : options.length ? (
            options.map((option) => (
              <button
                type="button"
                key={option.id}
                onClick={() => {
                  setQuery(option.name);
                  setActive(false);
                  onSelect(option);
                }}
              >
                <strong>{option.name}</strong>
                {option.type && (
                  <span>
                    #{option.id} · {option.type}
                    {option.inactive ? " · Inactive" : ""}
                  </span>
                )}
              </button>
            ))
          ) : (
            <p>{query ? "No matches" : "Type to search"}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ItemCheck({
  item,
  reference = false,
}: {
  item: Assessment;
  reference?: boolean;
}) {
  return (
    <div className={"intake-item " + (reference ? "reference-item" : "")}>
      <div className="section-line">
        <strong>{item.name}</strong>
        <span>#{item.id}</span>
      </div>
      <p className="item-classification">
        {item.type} · Costing Method: {item.costingMethod || "Unavailable"}
      </p>
      {reference ? (
        <p className="reference-label">Reference only — do not update</p>
      ) : (
        item.errors.map((message, i) => (
          <p className="error" key={i}>
            {message}
          </p>
        ))
      )}
      {!reference &&
        item.exceptions.map((message, i) => (
          <p className="warning" key={i}>
            {message} An explanation is required.
          </p>
        ))}
      <details>
        <summary>Part validator findings</summary>
        {[...item.findings.errors, ...item.findings.warnings].length ? (
          [...item.findings.errors, ...item.findings.warnings].map(
            (message, i) => (
              <p className="validator-finding" key={i}>
                {message}
              </p>
            ),
          )
        ) : (
          <p className="validator-finding">
            No readiness issues found for the selected part.
          </p>
        )}
        <small>
          Missing approvals, BOMs, or routings can be addressed by this request.
        </small>
      </details>
    </div>
  );
}

function RequestForm({
  initial,
  onSaved,
  onCancel,
  onDirtyChange,
  onConflict,
}: {
  initial?: RequestRecord;
  onSaved: (record: RequestRecord) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onConflict: (id: number) => void;
}) {
  const [step, setStep] = useState(0),
    [date, setDate] = useState(initial?.date || ""),
    [requester, setRequester] = useState(initial?.requester || ""),
    [urgent, setUrgent] = useState(initial?.urgent || false),
    [scopes, setScopes] = useState<Scopes>(
      initial?.scopes || { assembly: true, bom: true, routing: true },
    );
  const originalItem =
    initial?.targetSnapshot || initial?.oldItemSnapshot || null;
  const [selected, setSelected] = useState<Option | null>(originalItem),
    [item, setItem] = useState<Assessment | null>(originalItem),
    [reference, setReference] = useState<Assessment | null>(
      initial?.oldItemSnapshot || null,
    ),
    [oldMode, setOldMode] = useState(
      !!initial?.oldItemId && !initial.targetItemId,
    ),
    [quote, setQuote] = useState(initial?.quotePartNumber || ""),
    [customer, setCustomer] = useState<Option | null>(
      initial ? { id: initial.customerId, name: initial.customerName } : null,
    );
  const [ca, setCa] = useState(initial?.customerApproval || false),
    [da, setDa] = useState(initial?.duramarkApproval || false),
    [notes, setNotes] = useState(initial?.notes || ""),
    [approvalReason, setApprovalReason] = useState(
      initial?.approvalMismatchReason || "",
    ),
    [exceptionReason, setExceptionReason] = useState(
      initial?.eligibilityExceptionReason || "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ApiError | null>(null),
    [dirty, setDirty] = useState(false);
  const selectionRequest = useRef(0),
    saving = useRef(false);
  const touch = () => setDirty(true);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!initial)
      api<{ date: string }>("/request-date")
        .then((data) => setDate(data.date))
        .catch((e) => setError(e));
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const target = item && !oldMode ? item : null;
  const selectItem = async (option: Option | null) => {
    const ticket = ++selectionRequest.current;
    touch();
    setSelected(option);
    setItem(null);
    setOldMode(false);
    setError(null);
    setCa(false);
    setDa(false);
    if (!option) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const checked = await api<Assessment>("/items/" + option.id + "/intake");
      if (ticket === selectionRequest.current) {
        setItem(checked);
        setCa(checked.customerApproval);
        setDa(checked.duramarkApproval);
      }
    } catch (e) {
      if (ticket === selectionRequest.current) setError(e as ApiError);
    } finally {
      if (ticket === selectionRequest.current) setBusy(false);
    }
  };
  const validate = (index: number): string | null => {
    if (index === 0) {
      if (!requester.trim()) return "Enter a requester.";
      if (!Object.values(scopes).some(Boolean))
        return "Choose at least one type of requested work.";
    }
    if (index === 1) {
      if (selected && !item)
        return "Check the selected item before continuing.";
      if (target && !target.eligible) return target.errors.join(" ");
      if (!target && !quote.trim())
        return "Enter a quote part number when there is no eligible target assembly. An old item is reference only.";
    }
    if (index === 2) {
      if (!customer)
        return "Select a customer from the imported customer list.";
      if (ca !== da && !approvalReason.trim())
        return "Explain why CA and DA do not match.";
      if (target?.exceptions.length && !exceptionReason.trim())
        return "Explain why the inactive or outsourced target needs this request.";
    }
    return null;
  };
  const submit = async () => {
    if (saving.current) return;
    for (let index = 0; index < 3; index++) {
      const message = validate(index);
      if (message) {
        setStep(index);
        setError(new ApiError({ error: message }));
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        requester,
        urgent,
        scopes,
        targetItemId: target?.id || null,
        oldItemId: reference?.id || null,
        quotePartNumber: quote,
        customerId: Number(customer!.id),
        customerApproval: ca,
        duramarkApproval: da,
        notes,
        approvalMismatchReason: approvalReason,
        eligibilityExceptionReason: exceptionReason,
        datasetId: (target || reference)?.datasetId,
        ...(initial ? { version: initial.version } : {}),
      };
      const record = await api<RequestRecord>(
        initial ? "/requests/" + initial.id : "/requests",
        { ...post(payload), method: initial ? "PATCH" : "POST" },
      );
      setDirty(false);
      onDirtyChange(false);
      onSaved(record);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const steps = [
    "Request basics",
    "Identify the part",
    "Customer & approvals",
    "Review & submit",
  ];
  return (
    <section className="request-panel">
      <div className="request-title">
        <div>
          <p className="eyebrow">{initial ? initial.number : "New request"}</p>
          <h2>
            {initial ? "Edit BOM/routing request" : "BOM/routing request"}
          </h2>
        </div>
        <span className="date-label">
          Request date · {date || "Loading…"} · Chicago
        </span>
      </div>
      <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li
            key={label}
            className={index === step ? "current" : index < step ? "done" : ""}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div role="alert" className="request-error">
          <p className="error">{error.message}</p>
          {error.conflictId && (
            <button
              className="text-button"
              onClick={() => onConflict(error.conflictId!)}
            >
              View conflicting request BR-
              {String(error.conflictId).padStart(6, "0")} →
            </button>
          )}
          {error.datasetChanged && (
            <button
              className="text-button"
              onClick={() => {
                setStep(1);
                if (selected) selectItem(selected);
                else if (reference)
                  api<Assessment>("/items/" + reference.id + "/intake")
                    .then(setReference)
                    .catch(setError);
              }}
            >
              Recheck selected item →
            </button>
          )}
          {error.versionConflict && (
            <p>
              Cancel editing and reload the request to get the latest version.
            </p>
          )}
        </div>
      )}
      <div className="wizard-content">
        <h3>{steps[step]}</h3>
        {step === 0 && (
          <>
            <label className="field">
              Requester{" "}
              <input
                value={requester}
                maxLength={120}
                onChange={(e) => {
                  touch();
                  setRequester(e.target.value);
                }}
                placeholder="Your name"
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => {
                  touch();
                  setUrgent(e.target.checked);
                }}
              />
              Urgent
            </label>
            <fieldset>
              <legend>What needs work?</legend>
              {Object.entries(labels).map(([key, label]) => (
                <label className="check-field" key={key}>
                  <input
                    type="checkbox"
                    checked={scopes[key as keyof Scopes]}
                    onChange={(e) => {
                      touch();
                      setScopes({ ...scopes, [key]: e.target.checked });
                    }}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {step === 1 && (
          <>
            <p className="form-hint">
              Link a NetSuite assembly, or enter a quote part number if the item
              does not exist yet.
            </p>
            <Lookup
              label="NetSuite item name"
              endpoint="/search"
              value={selected}
              onSelect={selectItem}
              disabled={busy}
            />
            {busy && (
              <p className="form-hint" role="status">
                Checking item…
              </p>
            )}
            {item && (
              <>
                <ItemCheck item={item} reference={oldMode} />
                {item.lotNumbered && item.type === "Assembly" && (
                  <label className="check-field old-item-checkbox">
                    <input
                      type="checkbox"
                      checked={oldMode}
                      onChange={(e) => {
                        touch();
                        setOldMode(e.target.checked);
                        if (e.target.checked) setReference(item);
                        else if (reference?.id === item.id) setReference(null);
                      }}
                    />
                    Old item — reference only; this is not the item to update
                  </label>
                )}
              </>
            )}
            {reference && (!item || reference.id !== item.id) && (
              <ItemCheck item={reference} reference />
            )}
            <label className="field">
              Quote part number
              {!target?.eligible ? " (required)" : " (optional)"}
              <input
                value={quote}
                maxLength={200}
                onChange={(e) => {
                  touch();
                  setQuote(e.target.value);
                }}
              />
            </label>
            {oldMode && (
              <p className="warning">
                The old item will be clearly labeled in the queue. No update
                target is assigned until an eligible assembly is linked.
              </p>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <Lookup
              label="Customer name (full NetSuite name)"
              endpoint="/customers"
              value={customer}
              onSelect={(value) => {
                touch();
                setCustomer(value);
              }}
            />
            <p className="form-hint">
              Customer missing? Refresh the customer list in Data & imports.
            </p>
            <fieldset>
              <legend>Approvals</legend>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={ca}
                  onChange={(e) => {
                    touch();
                    setCa(e.target.checked);
                  }}
                />
                Customer Approval (CA)
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={da}
                  onChange={(e) => {
                    touch();
                    setDa(e.target.checked);
                  }}
                />
                DuraMark Approval (DA)
              </label>
              <p className="form-hint">
                Both Yes or both No is valid. Different values need an
                explanation.
              </p>
            </fieldset>
            {(ca !== da || approvalReason) && (
              <label className="field">
                Approval mismatch reason{" "}
                {ca !== da ? "(required)" : "(retained)"}
                <textarea
                  value={approvalReason}
                  maxLength={3000}
                  onChange={(e) => {
                    touch();
                    setApprovalReason(e.target.value);
                  }}
                />
              </label>
            )}
            {(!!target?.exceptions.length || exceptionReason) && (
              <label className="field">
                Inactive / outsourced item exception reason{" "}
                {!!target?.exceptions.length ? "(required)" : "(retained)"}
                <textarea
                  value={exceptionReason}
                  maxLength={3000}
                  onChange={(e) => {
                    touch();
                    setExceptionReason(e.target.value);
                  }}
                />
              </label>
            )}
            <label className="field">
              Notes (optional)
              <textarea
                value={notes}
                maxLength={10000}
                rows={4}
                onChange={(e) => {
                  touch();
                  setNotes(e.target.value);
                }}
              />
            </label>
          </>
        )}
        {step === 3 && (
          <>
            <div className="review-grid">
              <div>
                <small>Requester</small>
                <strong>{requester}</strong>
              </div>
              <div>
                <small>Priority</small>
                <strong>{urgent ? "Urgent" : "Normal"}</strong>
              </div>
              <div>
                <small>Customer</small>
                <strong>{customer?.name}</strong>
              </div>
              <div>
                <small>Requested work</small>
                <strong>{work(scopes)}</strong>
              </div>
              <div>
                <small>Quote part number</small>
                <strong>{quote || "—"}</strong>
              </div>
              <div>
                <small>Approvals</small>
                <strong>
                  CA: {yes(ca)} · DA: {yes(da)}
                </strong>
              </div>
            </div>
            {target ? (
              <ItemCheck item={target} />
            ) : (
              <p className="warning">
                Quote-only request — no NetSuite update target is assigned.
              </p>
            )}
            {reference && <ItemCheck item={reference} reference />}
            {approvalReason && (
              <p className="review-text">
                <b>Approval mismatch reason:</b> {approvalReason}
              </p>
            )}
            {exceptionReason && (
              <p className="review-text">
                <b>Item exception reason:</b> {exceptionReason}
              </p>
            )}
            {notes && (
              <p className="review-text">
                <b>Notes:</b> {notes}
              </p>
            )}
            <p className="form-hint">
              Submitting adds this request to the queue. It does not create or
              change records in NetSuite.
            </p>
          </>
        )}
      </div>
      <div className="wizard-actions">
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <div>
          {step > 0 && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                const message = validate(step);
                if (message) setError(new ApiError({ error: message }));
                else {
                  setError(null);
                  setStep(step + 1);
                }
              }}
            >
              Next →
            </button>
          ) : (
            <button className="primary" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : initial ? "Save changes" : "Submit request →"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RequestDetail({
  id,
  onEdit,
  onBack,
  onToggle,
}: {
  id: number;
  onEdit: (record: RequestRecord) => void;
  onBack: () => void;
  onToggle: (record: RequestRecord) => void;
}) {
  const [record, setRecord] = useState<RequestRecord | null>(null),
    [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    setRecord(null);
    api<RequestRecord>("/requests/" + id)
      .then(setRecord)
      .catch(setError);
  }, [id]);
  if (error)
    return (
      <section className="request-panel">
        <p className="error">{error.message}</p>
        <button className="secondary" onClick={onBack}>
          Back to queue
        </button>
      </section>
    );
  if (!record) return <p role="status">Loading request…</p>;
  const historyLabels: Record<string, string> = {
    requester: "Requester",
    urgent: "Urgent",
    scopes: "Requested work",
    targetItemId: "Target internal ID",
    oldItemId: "Old reference internal ID",
    quotePartNumber: "Quote part number",
    customerId: "Customer reference",
    customerName: "Customer",
    customerApproval: "Customer Approval",
    duramarkApproval: "DuraMark Approval",
    notes: "Notes",
    approvalMismatchReason: "Approval mismatch reason",
    eligibilityExceptionReason: "Item exception reason",
    targetSnapshot: "Target assembly",
    oldItemSnapshot: "Old item reference",
    status: "Status",
    completedAt: "Completed at",
  };
  const displayValue = (value: unknown): string => {
    if (value === null) return "—";
    if (typeof value === "boolean") return yes(value);
    if (typeof value === "object") {
      if ("name" in value && "id" in value)
        return `${String(value.name)} (#${String(value.id)})`;
      return work(value as Scopes);
    }
    return String(value);
  };
  return (
    <section className="request-panel">
      <div className="request-title">
        <div>
          <p className="eyebrow">
            {record.number} · {record.date}
          </p>
          <h2>{record.targetSnapshot?.name || record.quotePartNumber}</h2>
        </div>
        <span
          className={
            "badge " + (record.status === "completed" ? "ready" : "blocked")
          }
        >
          {record.status === "completed" ? "Completed" : "Open"}
          {record.urgent ? " · Urgent" : ""}
        </span>
      </div>
      <div className="detail-actions">
        <button className="secondary" onClick={onBack}>
          ← Queue
        </button>
        <button className="secondary" onClick={() => onEdit(record)}>
          Edit request
        </button>
        <button className="primary" onClick={() => onToggle(record)}>
          {record.status === "open" ? "Mark completed" : "Reopen request"}
        </button>
      </div>
      <div className="review-grid">
        <div>
          <small>Requester</small>
          <strong>{record.requester}</strong>
        </div>
        <div>
          <small>Customer</small>
          <strong>{record.customerName}</strong>
        </div>
        <div>
          <small>Requested work</small>
          <strong>{work(record.scopes)}</strong>
        </div>
        <div>
          <small>Quote part number</small>
          <strong>{record.quotePartNumber || "—"}</strong>
        </div>
        <div>
          <small>Approvals</small>
          <strong
            className={
              record.customerApproval !== record.duramarkApproval
                ? "mismatch-text"
                : ""
            }
          >
            CA: {yes(record.customerApproval)} · DA:{" "}
            {yes(record.duramarkApproval)}
          </strong>
        </div>
        <div>
          <small>Completed</small>
          <strong>
            {record.completedAt
              ? dateTime(record.completedAt)
              : "Not completed"}
          </strong>
        </div>
      </div>
      {record.targetSnapshot ? (
        <ItemCheck item={record.targetSnapshot} />
      ) : (
        <p className="warning">No NetSuite update target assigned.</p>
      )}
      {record.oldItemSnapshot && (
        <ItemCheck item={record.oldItemSnapshot} reference />
      )}
      {record.approvalMismatchReason && (
        <p className="review-text">
          <b>Approval mismatch reason:</b> {record.approvalMismatchReason}
        </p>
      )}
      {record.eligibilityExceptionReason && (
        <p className="review-text">
          <b>Item exception reason:</b> {record.eligibilityExceptionReason}
        </p>
      )}
      {record.notes && (
        <p className="review-text">
          <b>Notes:</b> {record.notes}
        </p>
      )}
      <p className="form-hint">
        Item details above are the saved submission snapshot; data imports do
        not rewrite this request.
      </p>
      <details className="history">
        <summary>Change history ({record.history?.length || 0})</summary>
        {record.history?.map((entry, i) => (
          <div key={i}>
            <h3>
              {dateTime(entry.at)} · {entry.action}
            </h3>
            <dl>
              {Object.entries(entry.changes).map(([field, change]) => (
                <div key={field}>
                  <dt>{historyLabels[field] || field}</dt>
                  <dd>
                    {displayValue(change.before)} → {displayValue(change.after)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </details>
    </section>
  );
}

export function RequestWorkspace({
  onDirtyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
}) {
  const initialId = Number(new URLSearchParams(location.search).get("request"));
  const [mode, setMode] = useState<"queue" | "detail" | "form">(
      initialId > 0 ? "detail" : "queue",
    ),
    [detailId, setDetailId] = useState(initialId),
    [editing, setEditing] = useState<RequestRecord | undefined>(),
    [dirty, setDirty] = useState(false),
    [records, setRecords] = useState<RequestRecord[]>([]),
    [customers, setCustomers] = useState<Option[]>([]),
    [status, setStatus] = useState("open"),
    [search, setSearch] = useState(""),
    [customer, setCustomer] = useState(""),
    [requester, setRequester] = useState(""),
    [urgent, setUrgent] = useState(false),
    [scope, setScope] = useState(""),
    [error, setError] = useState<ApiError | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const loading = useRef(0);
  useEffect(() => {
    api<Option[]>("/customers?includeInactive=true")
      .then(setCustomers)
      .catch(setError);
  }, []);
  useEffect(() => {
    if (mode !== "queue") return;
    const ticket = ++loading.current;
    setBusy(true);
    const params = new URLSearchParams({
      status,
      q: search,
      customerId: customer,
      requester,
      urgent: urgent ? "true" : "",
      scope,
    });
    const timer = setTimeout(
      () =>
        api<RequestRecord[]>("/requests?" + params)
          .then((data) => {
            if (ticket === loading.current) setRecords(data);
          })
          .catch((e) => {
            if (ticket === loading.current) setError(e);
          })
          .finally(() => {
            if (ticket === loading.current) setBusy(false);
          }),
      150,
    );
    return () => clearTimeout(timer);
  }, [mode, status, search, customer, requester, urgent, scope, refresh]);
  const dirtyChanged = React.useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirtyChange(value);
    },
    [onDirtyChange],
  );
  const navigate = (
    next: "queue" | "detail" | "form",
    id?: number,
    record?: RequestRecord,
    saved = false,
  ) => {
    if (
      !saved &&
      dirty &&
      !window.confirm("Discard this unfinished request? It has not been saved.")
    )
      return;
    dirtyChanged(false);
    setError(null);
    setEditing(record);
    if (id) setDetailId(id);
    setMode(next);
    const url = new URL(location.href);
    if (next === "detail" && id) url.searchParams.set("request", String(id));
    else url.searchParams.delete("request");
    history.replaceState(null, "", url);
  };
  const toggle = async (record: RequestRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/requests/" + record.id, {
        ...post({
          version: record.version,
          status: record.status === "open" ? "completed" : "open",
        }),
        method: "PATCH",
      });
      setNotice(
        record.number +
          (record.status === "open" ? " completed." : " reopened."),
      );
      setRefresh(refresh + 1);
      navigate("queue");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="queue-toolbar">
        <div>
          <p className="eyebrow">BOM / Routing requests</p>
          <h2>
            {mode === "queue"
              ? "Request queue"
              : mode === "detail"
                ? "Request details"
                : editing
                  ? "Edit request"
                  : "New request"}
          </h2>
        </div>
        {mode !== "form" && (
          <button className="primary" onClick={() => navigate("form")}>
            + New request
          </button>
        )}
      </div>
      {notice && mode === "queue" && (
        <p role="status" className="success-message">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="error">{error.message}</p>
          {error.conflictId && (
            <button
              className="text-button"
              onClick={() => navigate("detail", error.conflictId)}
            >
              View conflicting request →
            </button>
          )}
          {error.versionConflict && (
            <button
              className="text-button"
              onClick={() => {
                setRefresh(refresh + 1);
                navigate("queue");
              }}
            >
              Reload queue
            </button>
          )}
        </div>
      )}
      {mode === "form" ? (
        <RequestForm
          initial={editing}
          onDirtyChange={dirtyChanged}
          onCancel={() => navigate(editing ? "detail" : "queue", editing?.id)}
          onConflict={(id) => navigate("detail", id)}
          onSaved={(record) => {
            setNotice(record.number + (editing ? " updated." : " submitted."));
            setRefresh(refresh + 1);
            navigate("detail", record.id, undefined, true);
          }}
        />
      ) : mode === "detail" ? (
        <RequestDetail
          key={detailId}
          id={detailId}
          onBack={() => navigate("queue")}
          onEdit={(record) => navigate("form", record.id, record)}
          onToggle={toggle}
        />
      ) : (
        <>
          <div className="queue-tabs" role="group" aria-label="Request status">
            <button
              className={status === "open" ? "active" : ""}
              onClick={() => setStatus("open")}
            >
              Open
            </button>
            <button
              className={status === "completed" ? "active" : ""}
              onClick={() => setStatus("completed")}
            >
              Completed
            </button>
          </div>
          <section className="queue-filters">
            <label>
              Search
              <input
                value={search}
                placeholder="Part, quote, customer, requester…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Customer
              <select
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">All customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active === 0 ? " (not in current import)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Requester
              <input
                value={requester}
                onChange={(e) => setRequester(e.target.value)}
                placeholder="Any requester"
              />
            </label>
            <label>
              Requested work
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All work</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
              />
              Urgent only
            </label>
          </section>
          <div className="queue-count">
            <span>
              {busy
                ? "Loading…"
                : `${records.length} ${status} requests · urgent first, oldest first`}
            </span>
            <button
              className="text-button"
              onClick={() => setRefresh(refresh + 1)}
            >
              Refresh queue ↻
            </button>
          </div>
          <div className="queue-table table-scroll" aria-busy={busy}>
            <table>
              <thead>
                <tr>
                  {[
                    "Request / date",
                    "NetSuite target / internal ID",
                    "Old item reference",
                    "Quote part number",
                    "Customer",
                    "Requested work",
                    "Notes",
                    "Urgent",
                    "CA",
                    "DA",
                    "Completed",
                    "Requester",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr
                    key={record.id}
                    className={record.urgent ? "urgent-row" : ""}
                  >
                    <td>
                      <button
                        className="text-button request-number"
                        onClick={() => navigate("detail", record.id)}
                      >
                        {record.number}
                      </button>
                      <small>{record.date}</small>
                    </td>
                    <td>
                      {record.targetSnapshot ? (
                        <>
                          <strong>{record.targetSnapshot.name}</strong>
                          <small>#{record.targetItemId}</small>
                        </>
                      ) : (
                        <span className="muted">Not linked — quote only</span>
                      )}
                    </td>
                    <td>
                      {record.oldItemSnapshot ? (
                        <>
                          <strong>{record.oldItemSnapshot.name}</strong>
                          <small>#{record.oldItemId}</small>
                          <span className="reference-label">
                            Reference only — do not update
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{record.quotePartNumber || "—"}</td>
                    <td>{record.customerName}</td>
                    <td>{work(record.scopes)}</td>
                    <td>
                      <span className="queue-notes" title={record.notes}>
                        {record.notes || "—"}
                      </span>
                      {record.customerApproval !== record.duramarkApproval && (
                        <small
                          className="mismatch-text"
                          title={record.approvalMismatchReason}
                        >
                          Approval mismatch — see reason
                        </small>
                      )}
                    </td>
                    <td>
                      {record.urgent ? (
                        <span className="urgent-label">Urgent</span>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td
                      className={
                        record.customerApproval !== record.duramarkApproval
                          ? "mismatch-cell"
                          : ""
                      }
                    >
                      {yes(record.customerApproval)}
                    </td>
                    <td
                      className={
                        record.customerApproval !== record.duramarkApproval
                          ? "mismatch-cell"
                          : ""
                      }
                    >
                      {yes(record.duramarkApproval)}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Completed " + record.number}
                        checked={record.status === "completed"}
                        disabled={busy}
                        onChange={() => toggle(record)}
                      />
                    </td>
                    <td>{record.requester}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!busy && !records.length && (
              <div className="queue-empty">
                <h3>No matching {status} requests</h3>
                <p>Create a request or adjust your filters.</p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

type CustomerMetadata = { filename: string; count: number; importedAt: string };
export function CustomerImport() {
  const [metadata, setMetadata] = useState<CustomerMetadata | null>(null),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  useEffect(() => {
    api<CustomerMetadata | null>("/customers/dataset")
      .then(setMetadata)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="request-panel customer-import">
      <p className="eyebrow">Independent customer list</p>
      <h2>Customer selector data</h2>
      <p className="form-hint">
        Import the active customer export. The full Name column is used; this
        does not replace item data or requests.
      </p>
      {metadata ? (
        <p className="customer-meta">
          {metadata.count} customers · {metadata.filename} · Imported{" "}
          {dateTime(metadata.importedAt)}
        </p>
      ) : (
        <p className="warning">
          No customer list imported. Import it before submitting requests.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="success-message">
          {success}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          if (!file) return;
          setBusy(true);
          setError("");
          setSuccess("");
          try {
            const body = new FormData();
            body.append("customers", file);
            const result = await api<CustomerMetadata>("/customers/import", {
              method: "POST",
              body,
            });
            setMetadata(result);
            setSuccess(
              "Customer list refreshed. Existing requests and customer references are preserved.",
            );
            setFile(null);
            form.reset();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Active customer CSV (Name column required)
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        <button className="primary" disabled={busy || !file}>
          {busy ? "Importing…" : "Import customer list →"}
        </button>
      </form>
    </section>
  );
}
