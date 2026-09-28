import { useMemo, useState } from "react";
import { Upload, ArrowRight } from "lucide-react";
import {
  api,
  useApp,
  useData,
  Card,
  Heading,
  Listing,
  Table,
  State,
  Form,
  Modal,
  download,
  ActionDialog,
} from "./lib";
import { header, label, type Row } from "../shared/core";
import { importMappingError, inspectImport } from "../shared/imports";
import { timezoneOptions } from "../shared/timezones";
const fields = [
  "name",
  "phone",
  "website",
  "email",
  "timezone",
  "city",
  "state",
  "industry",
  "contact",
  "notes",
  "source",
  "tags",
  "address",
  "zip",
  "country",
  "external_id",
  "google_url",
  "rating",
  "review_count",
  "website_assessment",
];
const aliases: Record<string, string[]> = {
  name: ["business", "businessname", "company", "companyname", "name"],
  phone: [
    "phone",
    "phonenumber",
    "telephone",
    "telephonenumber",
    "businessphone",
    "businessphonenumber",
    "mobile",
    "mobilephone",
    "tel",
  ],
  website: ["website", "url", "domain"],
  timezone: ["timezone", "tz"],
  contact: ["contact", "contactname", "owner", "decisionmaker"],
  external_id: ["externalid", "placeid", "googleplaceid"],
  google_url: ["googleurl", "googlebusinessurl", "businessprofile"],
  rating: ["rating", "googlerating"],
  review_count: ["reviews", "reviewcount"],
  zip: ["zip", "zipcode", "postalcode"],
  source: ["source", "leadsource"],
  tags: ["tags", "tag"],
  website_assessment: ["websitenotes", "websiteassessment", "websitestatus"],
};
export function Imports() {
  const app = useApp(),
    templates = useData("/table?name=saved_views&kind=import_mapping");
  const [file, setFile] = useState<Row | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [zone, setZone] = useState(""),
    [batch, setBatch] = useState<Row | null>(null),
    [progress, setProgress] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [paste, setPaste] = useState(""),
    [saveTemplate, setSaveTemplate] = useState(false),
    [archive, setArchive] = useState<Row | null>(null),
    [rowReview, setRowReview] = useState<Row | null>(null),
    [batchTag, setBatchTag] = useState("");
  const inspection = useMemo(
    () => (file ? inspectImport(file.rows, mapping, zone) : null),
    [file, mapping, zone],
  );
  const mappingError = importMappingError(mapping, zone);
  function autoMap(data: Row) {
    return Object.fromEntries(
      fields.map((k) => [
        k,
        data.headers.find((h: string) =>
          (aliases[k] || [k]).includes(header(h)),
        ) || "",
      ]),
    );
  }
  async function upload(f: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", f);
      const data = await api("/import/preview", form);
      setFile(data);
      setMapping(autoMap(data));
      setBatch(null);
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stage(existing?: Row) {
    if (!file) {
      setError("Choose your lead spreadsheet first.");
      return;
    }
    if (!existing && mappingError) {
      setError(mappingError);
      return;
    }
    if (!existing && !inspection?.valid) {
      setError(
        "No rows can be imported with these settings. Check the phone column and timezone, then validate again.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      let current = existing;
      if (
        current &&
        (current.total !== file.rows.length ||
          current.mapping._fingerprint !== file.fingerprint)
      )
        throw Error(
          "Choose the same unchanged spreadsheet to resume this upload.",
        );
      if (!current) {
        const started = await api("/import/start", {
          filename: file.filename,
          total: file.rows.length,
          mapping,
          defaultZone: zone,
          batchTag,
          fingerprint: file.fingerprint,
        });
        current = {
          id: started.id,
          status: "staging",
          total: file.rows.length,
          mapping: {
            ...mapping,
            _default_zone: zone,
            _fingerprint: file.fingerprint,
          },
        };
        setBatch(current);
      }
      for (let offset = 0; offset < file.rows.length; offset += 250) {
        await api("/import/stage", {
          id: current.id,
          offset,
          rows: file.rows.slice(offset, offset + 250),
        });
        setProgress({
          staged: Math.min(offset + 250, file.rows.length),
          total: file.rows.length,
        });
      }
      await api("/action", {
        action: "import_review",
        p: {
          id: current.id,
          reason: "Review all validated rows before importing",
        },
      });
      setBatch({ ...current, status: "ready" });
      setProgress(await api(`/report?kind=import&id=${current.id}`));
      app.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(r: Row) {
    setBatch(r);
    setProgress(await api(`/report?kind=import&id=${r.id}`));
  }
  async function commit() {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      let result;
      do {
        result = await api("/action", {
          action: "import_commit",
          p: { id: batch.id, reason: "Import reviewed clean business records" },
        });
        setProgress(result);
      } while (result.pending > 0);
      setBatch({ ...batch, status: "complete" });
      app.refresh();
      app.notify(
        `${result.accepted} businesses imported; ${result.rejected} exceptions retained in the report.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION"
        title="Import leads"
        description="Upload a spreadsheet, review every exception, and import clean records."
      >
        <button
          onClick={() =>
            app.run(() =>
              download("/import/template", "pixelalty-import-template.csv"),
            )
          }
        >
          Download template
        </button>
      </Heading>
      <div className="import-steps">
        <span className={!file ? "active" : "done"}>1 · Upload</span>
        <ArrowRight />
        <span className={file && !batch ? "active" : ""}>
          2 · Map & validate
        </span>
        <ArrowRight />
        <span className={batch ? "active" : ""}>3 · Review & import</span>
      </div>
      <Card>
        <details>
          <summary>Spreadsheet requirements and how importing works</summary>
          <p>
            Use CSV, TSV or XLSX with one header row and one business per row.
            Business name and Phone are required. Each business also needs its
            verified timezone, either in a Timezone column or selected below.
          </p>
          <p>
            Phone examples: (212) 555-0123, 2125550123 or +1 212 555 0123.
            International numbers need a + and country code. Do not map a
            row-number column such as # to Phone. Names must be between 1 and
            200 characters. Timezone examples: America/New_York and
            America/Los_Angeles; avoid abbreviations such as EST.
          </p>
          <p>
            Optional columns include website, email, city, state, industry,
            contact, notes, source, tags, address, ZIP, country, external ID,
            Google profile URL, rating, review count and website assessment.
            Leave a field unmapped when you do not have it. Export formulas as
            values.
          </p>
          <p>
            Validation stages a review only. It checks invalid rows, existing
            customers, matching phone numbers or websites, possible duplicates
            and the do-not-contact list. Review exceptions, then choose Import
            clean records. Duplicate and DNC checks run again when saving.
            Rejected rows remain in the downloadable report.
          </p>
          <p>
            Committed leads enter the existing claim pool. Reps claim within
            their configured capacity and approved calling hours. Ownership and
            follow-ups use the workspace’s configured expiry rules. Admins can
            correct a business in All leads. Archive unused leads removes only
            untouched, unowned imported leads from the pool and preserves
            history; it does not undo calls, customer records or sales.
          </p>
        </details>
        <label
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy && e.dataTransfer.files[0])
              void upload(e.dataTransfer.files[0]);
          }}
        >
          <Upload size={32} />
          <strong>Drop CSV or Excel here</strong>
          <span>CSV, TSV or XLSX · up to 8 MB / 25,000 rows</span>
          <input
            type="file"
            aria-label="Choose lead spreadsheet"
            accept=".csv,.tsv,.xlsx"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) void upload(e.target.files[0]);
            }}
          />
        </label>
        <details>
          <summary>Paste a table instead</summary>
          <label className="field">
            <span>Tab-separated rows, including column headers</span>
            <textarea
              rows={5}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !paste.trim()}
            onClick={() =>
              upload(
                new File([paste], "pasted-leads.tsv", {
                  type: "text/tab-separated-values",
                }),
              )
            }
          >
            Read pasted table
          </button>
        </details>
        {busy && (
          <div role="status" aria-live="polite">
            <p>
              Processing {progress?.staged || 0} /{" "}
              {file?.rows.length || batch?.total || 0} rows…
            </p>
            <progress
              aria-label="Import progress"
              value={progress?.staged || 0}
              max={file?.rows.length || batch?.total || 1}
            />
          </div>
        )}
        {file && !batch && (
          <>
            <div className="card-head">
              <h2>{file.filename}</h2>
              <strong>{file.rows.length.toLocaleString()} rows</strong>
            </div>
            <div className="toolbar">
              <button onClick={() => setMapping(autoMap(file))}>
                Auto map
              </button>
              <select
                aria-label="Mapping template"
                defaultValue=""
                onChange={(e) => {
                  const t = templates.data?.rows.find(
                    (r: Row) => r.id === e.target.value,
                  );
                  if (t) {
                    setMapping(t.config.mapping);
                    setZone(t.config.zone || "");
                  }
                }}
              >
                <option value="">Saved mapping templates</option>
                {templates.data?.rows.map((t: Row) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button onClick={() => setSaveTemplate(true)}>
                Save mapping template
              </button>
            </div>
            <div className="mapping-grid">
              {fields.map((k) => (
                <label className="field" key={k}>
                  <span>
                    {k === "name" ? "Business name" : label(k)}
                    {["name", "phone"].includes(k) ? " *" : ""}
                  </span>
                  <select
                    disabled={busy}
                    value={mapping[k] || ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [k]: e.target.value })
                    }
                  >
                    <option value="">Skip / not mapped</option>
                    {file.headers.map((h: string) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="field">
              <span>Default timezone for rows without one</span>
              <select
                value={zone}
                disabled={busy}
                onChange={(e) => setZone(e.target.value)}
              >
                <option value="">Choose a verified timezone</option>
                {timezoneOptions(zone).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <small>
                Use a default only when you have verified that these businesses
                share this timezone.
              </small>
            </label>
            <label className="field">
              Tag every business in this import
              <input
                value={batchTag}
                onChange={(e) => setBatchTag(e.target.value)}
                maxLength={100}
                placeholder="Optional campaign or source tag"
              />
            </label>
            <h3>Mapped preview — first five rows</h3>
            <Table
              rows={inspection?.preview || []}
              columns={[
                ["row", "Spreadsheet row"],
                ["name", "Business"],
                ["phone", "Phone"],
                ["timezone", "Timezone"],
                ["result", "Validation result"],
              ]}
            />
            <div id="import-validation-help" aria-live="polite">
              {mappingError ? (
                <p className="notice">{mappingError}</p>
              ) : (
                <p>
                  {inspection?.valid} rows pass format validation;{" "}
                  {inspection?.invalid} need correction. Duplicate and DNC
                  checks happen next.
                </p>
              )}
              {!!inspection?.invalidPhones && mapping.phone && (
                <p>
                  Phone column “{mapping.phone}” has {inspection.invalidPhones}{" "}
                  invalid numbers. Confirm it contains telephone numbers, not
                  row numbers.
                </p>
              )}
              {!mappingError && !!inspection?.invalid && (
                <ul>
                  {inspection.issues.map((issue) => (
                    <li key={issue.message}>
                      {issue.count} rows: {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              className="primary"
              disabled={busy}
              aria-describedby="import-validation-help"
              onClick={() => stage()}
            >
              Validate & stage import
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {error && <State error={error} />}
        {batch && (
          <>
            <h2>
              {batch.status === "complete"
                ? "Import complete"
                : batch.status === "staging"
                  ? busy
                    ? "Validating and staging…"
                    : "Upload interrupted — ready to resume"
                  : "Review before importing"}
            </h2>
            {batch.status === "staging" ? (
              <>
                {!busy && (
                  <p>
                    Re-upload the original file if needed, then resume this
                    batch. Previously staged rows will not be duplicated.
                  </p>
                )}
                <button disabled={busy || !file} onClick={() => stage(batch)}>
                  Resume staging
                </button>
              </>
            ) : (
              <>
                <div className="stats">
                  {[
                    "ready",
                    "accepted",
                    "duplicates",
                    "possible_duplicates",
                    "suppressed",
                    "customers",
                    "invalid",
                    "rejected",
                    "pending",
                  ]
                    .filter((k) => progress?.[k] != null)
                    .map((k) => (
                      <div key={k}>
                        <strong>{progress?.[k]}</strong>
                        <small>{label(k)}</small>
                      </div>
                    ))}
                </div>
                <p>
                  Rejected rows remain in the report. Committing rechecks
                  current DNC and existing records.
                </p>
                {progress?.ready === 0 && batch.status === "ready" && (
                  <State error="No clean rows are ready to import. Review the row errors below or download the report, then correct your spreadsheet or mappings and start another import." />
                )}
                {batch.status === "complete" && progress?.accepted === 0 && (
                  <State error="This batch added no leads. Every row was rejected. Review the validation report, correct the spreadsheet or timezone settings, then start another import." />
                )}
                <div className="actions">
                  {batch.status === "ready" && (
                    <button
                      className="primary"
                      disabled={busy || progress?.ready === 0}
                      onClick={commit}
                    >
                      Import clean records
                    </button>
                  )}
                  <button
                    onClick={() =>
                      app.run(() =>
                        download(
                          `/import/report?id=${batch.id}`,
                          "pixelalty-import-report.csv",
                        ),
                      )
                    }
                  >
                    Download validation report
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBatch(null);
                      setFile(null);
                      setProgress(null);
                    }}
                  >
                    Start another import
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Card>
      {batch && batch.status !== "staging" && (
        <>
          <h2>Row-by-row review</h2>
          <Listing
            name="import_rows"
            query={`&batch=${batch.id}`}
            columns={[
              ["row_num", "Spreadsheet row"],
              ["business_name", "Business"],
              ["phone", "Phone"],
              ["error", "Validation result"],
              ["status", "Import status"],
            ]}
            actions={(r) =>
              r.error?.startsWith("Possible duplicate:") &&
              batch.status === "ready" ? (
                <button onClick={() => setRowReview({ ...r, id: batch.id })}>
                  Review possible duplicate
                </button>
              ) : null
            }
          />
        </>
      )}
      {rowReview && (
        <ActionDialog
          title="Resolve possible duplicate"
          action="import_row_decision"
          initial={rowReview}
          fields={[
            {
              name: "keep",
              label:
                "I reviewed the matching details; import this as a separate business",
              type: "checkbox",
            },
          ]}
          onClose={() => {
            setRowReview(null);
            if (batch)
              app.run(async () =>
                setProgress(await api(`/report?kind=import&id=${batch.id}`)),
              );
          }}
        />
      )}
      <h2>Import history</h2>
      <Listing
        name="imports"
        columns={[
          ["filename", "File"],
          ["total", "Rows"],
          ["status", "Status"],
          ["created_at", "Uploaded"],
        ]}
        actions={(r) => (
          <>
            <button disabled={busy} onClick={() => app.run(() => review(r))}>
              {r.status === "staging" ? "Resume upload" : "Review results"}
            </button>
            <button
              onClick={() =>
                app.run(() =>
                  download(
                    `/import/report?id=${r.id}`,
                    "pixelalty-import-report.csv",
                  ),
                )
              }
            >
              Report
            </button>
            {r.status === "complete" && (
              <button onClick={() => setArchive(r)}>
                Archive unused leads
              </button>
            )}
          </>
        )}
      />
      {saveTemplate && (
        <Modal
          title="Save mapping template"
          onClose={() => setSaveTemplate(false)}
        >
          <Form
            fields={[{ name: "name", label: "Template name", required: true }]}
            submit="Save template"
            onSubmit={async (p) => {
              await app.mutate("save_view", {
                ...p,
                kind: "import_mapping",
                config: { mapping, zone },
                reason: "Save reusable spreadsheet mapping",
              });
              setSaveTemplate(false);
            }}
          />
        </Modal>
      )}
      {archive && (
        <ActionDialog
          title="Archive unused imported leads"
          action="import_archive"
          initial={{ id: archive.id }}
          onClose={() => setArchive(null)}
        />
      )}
    </>
  );
}
