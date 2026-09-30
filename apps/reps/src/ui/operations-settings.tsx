import { useState, useEffect } from "react";
import {
  Mail,
  MessageCircle,
  Bell,
  Globe,
  HelpCircle,
  Users,
  ExternalLink,
  Copy,
  Plus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  api,
  useApp,
  useData,
  Heading,
  Card,
  State,
  Form,
  Modal,
  Table,
  type Field,
  mediaBlob,
} from "./lib";
import { money, type Row } from "../shared/core";

const packageFields: Field[] = [
  { name: "name", label: "Package name", required: true, maxLength: 120 },
  {
    name: "price_cents",
    label: "Customer price ($)",
    type: "currency",
    required: true,
    min: 0,
  },
  { name: "starts_at", label: "Display price as starts at", type: "checkbox" },
  {
    name: "commission_cents",
    label: "Fixed rep commission ($)",
    type: "currency",
    required: true,
    min: 0,
  },
  {
    name: "display_order",
    label: "Display order",
    type: "number",
    required: true,
    min: 1,
    max: 1000,
    hint: "Core tier slots: Launch 10, Growth 20, Premium 30, Advanced 40.",
  },
  { name: "active", label: "Active for new sales", type: "checkbox" },
  { name: "visible", label: "Visible to reps", type: "checkbox" },
  { name: "reason", label: "Reason for update", required: true },
];
export function SalesSettings() {
  const app = useApp(),
    state = useData("/report?kind=package_catalog"),
    [editing, setEditing] = useState<Row | null>(null);
  return (
    <>
      <Heading
        title="Sales settings"
        description="Keep the sales catalog and fixed commissions current."
      />
      <Card title="Packages & commissions">
        <p>
          Updates apply to future sales. Existing deals, verified sales,
          commissions and payouts keep their saved amounts.
        </p>
        <p className="notice">
          After changing a customer price, confirm the corresponding external
          payment link separately. Saving here does not change a Stripe Payment
          Link.
        </p>
        <State {...state}>
          <Table
            rows={state.data?.rows || []}
            columns={[
              ["name", "Package"],
              ["price_cents", "Customer price"],
              ["commission_cents", "Commission"],
              ["display_order", "Order"],
              ["active", "Active"],
              ["visible", "Visible"],
            ]}
            render={{
              active: (r) => (r.active ? "Active" : "Inactive"),
              visible: (r) => (r.visible ? "Visible" : "Hidden"),
              price_cents: (r) =>
                `${r.starts_at ? "Starts at " : ""}${money(r.price_cents)}`,
            }}
            actions={(r) => (
              <button onClick={() => setEditing(r)}>Edit package</button>
            )}
          />
        </State>
      </Card>
      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <p>
            Version {editing.version} · {money(editing.price_cents)} · fixed
            tier {editing.code}
          </p>
          <Form
            initial={editing}
            fields={packageFields}
            submit="Save package settings"
            onSubmit={async (p) => {
              await app.mutate("package_settings", { ...p, id: editing.id });
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
const icons = {
  message: MessageCircle,
  mail: Mail,
  bell: Bell,
  globe: Globe,
  help: HelpCircle,
  users: Users,
};
function SupportImage({ card }: { card: Row }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true,
      object = "";
    setSrc("");
    if (card.qr_path?.startsWith("/support/")) {
      setSrc(card.qr_path);
      return;
    }
    if (card.qr_path)
      void mediaBlob("/support/image/" + encodeURIComponent(card.id))
        .then((blob) => {
          if (live) {
            object = URL.createObjectURL(blob);
            setSrc(object);
          }
        })
        .catch(() => {});
    return () => {
      live = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [card.id, card.qr_path]);
  return src ? <img src={src} alt={card.qr_alt} /> : null;
}
export function SupportChannels() {
  const app = useApp(),
    state = useData("/report?kind=support_hub", 60000);
  return (
    <State {...state}>
      <div className="support-grid">
        {state.data?.rows.map((card: Row) => {
          const Icon = icons[card.icon as keyof typeof icons] || HelpCircle;
          return (
            <Card
              key={card.id}
              title={card.title}
              className={`support-channel ${card.qr_path ? "" : "compact"}`}
            >
              <Icon aria-hidden="true" />
              <p>{card.description}</p>
              <a
                className="button primary"
                href={card.type === "email" ? `mailto:${card.email}` : card.url}
                target={card.type === "email" ? undefined : "_blank"}
                rel="noopener noreferrer"
              >
                {card.button_text}
                <ExternalLink size={15} />
              </a>
              {card.qr_path && <SupportImage card={card} />}
              {card.type === "email" && (
                <>
                  <p>{card.email}</p>
                  <button
                    onClick={() =>
                      app.run(async () => {
                        await navigator.clipboard.writeText(card.email);
                        app.notify("Support email copied.");
                      })
                    }
                  >
                    <Copy size={15} /> Copy email
                  </button>
                </>
              )}
            </Card>
          );
        })}
      </div>
      {state.data?.rows.length === 0 && (
        <p>Open a ticket below and the Pixelalty team will help.</p>
      )}
    </State>
  );
}
export function SupportHubSettings() {
  const app = useApp(),
    state = useData("/report?kind=support_hub&admin=true");
  const [editing, setEditing] = useState<Row | null>(null),
    [removing, setRemoving] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(""),
    [uploaded, setUploaded] = useState(""),
    [error, setError] = useState("");
  const edit = (row: Row) => {
    setEditing(row);
    setQr(row.qr_path || "");
    setUploaded("");
    setError("");
  };
  const close = () => {
    if (uploaded)
      void app.run(() => api("/support/image/remove", { path: uploaded }));
    setEditing(null);
    setUploaded("");
  };
  const save = async (row: Row, action = "support_card_save") => {
    const result = await api("/support/save", {
      action,
      p: { ...row, card_id: row.id, reason: "Update support hub" },
    });
    app.refresh();
    if (result.cleanup_pending)
      app.notify("Settings saved. Old-image cleanup will retry automatically.");
    return result;
  };
  const move = async (row: Row, direction: number) => {
    await app.mutate("support_card_move", { card_id: row.id, direction });
  };
  const fields: Field[] = [
    { name: "title", label: "Card title", required: true, maxLength: 100 },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      maxLength: 1000,
    },
    {
      name: "type",
      label: "Card type",
      required: true,
      options: [
        { value: "link", label: "Website or community link" },
        { value: "email", label: "Email" },
      ],
    },
    { name: "url", label: "HTTPS destination URL", type: "url" },
    { name: "email", label: "Support email address", type: "email" },
    {
      name: "button_text",
      label: "Button text",
      required: true,
      maxLength: 80,
    },
    {
      name: "qr_alt",
      label: "QR image description",
      maxLength: 200,
      hint: "Describe the destination when using a QR image.",
    },
    {
      name: "display_order",
      label: "Display order",
      type: "number",
      required: true,
      min: 1,
      max: 1000,
    },
    {
      name: "icon",
      label: "Icon",
      options: Object.keys(icons).map((value) => ({ value, label: value })),
      required: true,
    },
    { name: "active", label: "Show this option to reps", type: "checkbox" },
  ];
  return (
    <Card title="Support hub settings">
      <p>
        Add, reorder, hide or update the support options reps see. Direct links
        remain available alongside optional QR images.
      </p>
      <button
        className="primary"
        onClick={() =>
          edit({
            title: "",
            type: "link",
            active: true,
            icon: "help",
            display_order: Math.min(
              1000,
              (state.data?.rows?.length || 0) * 10 + 10,
            ),
          })
        }
      >
        <Plus size={16} /> Add support option
      </button>
      <State {...state}>
        <Table
          rows={state.data?.rows || []}
          columns={[
            ["title", "Support option"],
            ["type", "Type"],
            ["display_order", "Order"],
            ["active", "Visible"],
          ]}
          actions={(r) => (
            <>
              <button onClick={() => edit(r)}>Edit</button>
              <button
                onClick={() => app.run(() => save({ ...r, active: !r.active }))}
              >
                {r.active ? "Hide" : "Reactivate"}
              </button>
              <button
                aria-label={`Move ${r.title} up`}
                disabled={state.data?.rows?.[0]?.id === r.id}
                onClick={() => app.run(() => move(r, -1))}
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label={`Move ${r.title} down`}
                disabled={state.data?.rows?.at(-1)?.id === r.id}
                onClick={() => app.run(() => move(r, 1))}
              >
                <ArrowDown size={15} />
              </button>
              <button onClick={() => setRemoving(r)}>Delete</button>
            </>
          )}
        />
      </State>
      {editing && (
        <Modal
          title={editing.id ? "Edit support option" : "Add support option"}
          onClose={close}
        >
          <label className="field">
            Optional QR image · PNG, JPEG or WebP · 2 MB
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const data = new FormData();
                  data.set("image", file);
                  const result = await api("/support/image", data);
                  if (uploaded)
                    await api("/support/image/remove", { path: uploaded });
                  setUploaded(result.path);
                  setQr(result.path);
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {qr && (
            <p>
              QR image selected.{" "}
              <button disabled={busy} onClick={() => setQr("")}>
                Remove QR image
              </button>
            </p>
          )}
          {busy && <p role="status">Uploading image…</p>}
          {error && <State error={error} />}
          <Form
            fields={fields}
            initial={editing}
            submit="Save support option"
            onSubmit={async (p) => {
              if (busy) throw Error("Wait for the image upload to finish.");
              await save({ ...p, id: editing.id, qr_path: qr });
              if (uploaded && uploaded !== qr)
                await api("/support/image/remove", { path: uploaded });
              setUploaded("");
              setEditing(null);
            }}
          />
        </Modal>
      )}
      {removing && (
        <Modal title="Delete support option?" onClose={() => setRemoving(null)}>
          <p>
            Remove “{removing.title}” from the support hub. Existing tickets are
            preserved.
          </p>
          <Form
            fields={[
              {
                name: "confirm",
                label: "Remove this support option",
                type: "checkbox",
                required: true,
              },
            ]}
            submit="Delete support option"
            onSubmit={async () => {
              await save(removing, "support_card_delete");
              setRemoving(null);
            }}
          />
        </Modal>
      )}
    </Card>
  );
}
