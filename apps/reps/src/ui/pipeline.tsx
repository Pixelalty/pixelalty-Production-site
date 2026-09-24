import { useState } from "react";
import { api, useApp, Heading, Listing, ActionDialog, type Field } from "./lib";
import { BusinessDetails } from "./details";
import type { Row } from "../shared/core";
export function Pipeline({ admin = false }: { admin?: boolean }) {
  const app = useApp(),
    [business, setBusiness] = useState<string | null>(null),
    [dialog, setDialog] = useState<{
      title: string;
      action: string;
      initial: Row;
      fields: Field[];
    } | null>(null);
  const show = (
    title: string,
    action: string,
    initial: Row,
    fields: Field[] = [],
  ) => setDialog({ title, action, initial, fields });
  return (
    <>
      <Heading
        title={admin ? "Sales pipeline" : "Your pipeline"}
        description="Track opportunities and verified customer payments. A reported sale becomes paid only after payment verification."
      >
        {admin && (
          <button
            className="primary"
            onClick={() =>
              show("Create an attributed deal", "admin_deal", {}, [
                {
                  name: "rep_id",
                  label: "Rep",
                  searchTable: "reps",
                  searchQuery: "&status=active",
                  required: true,
                },
                {
                  name: "business_id",
                  label: "Assigned business",
                  searchTable: "businesses",
                  required: true,
                },
                {
                  name: "package_id",
                  label: "Package",
                  searchTable: "packages",
                  searchQuery: "&active=true",
                  required: true,
                },
                {
                  name: "customer_email",
                  label: "Customer email",
                  type: "email",
                  required: true,
                },
                {
                  name: "price_cents",
                  label: "Approved Advanced quote ($)",
                  type: "currency",
                  hint: "Optional. Standard packages use their published price. Advanced quotes must meet its minimum.",
                },
                {
                  name: "quote_notes",
                  label: "Scope and quote notes",
                  type: "textarea",
                },
              ])
            }
          >
            Create deal
          </button>
        )}
      </Heading>
      <h2>Opportunities</h2>
      <Listing
        name="businesses"
        query={admin ? "" : "&own=true"}
        columns={[
          ["name", "Business"],
          ["stage", "Stage"],
          ["contact", "Decision maker"],
          ["expires_at", "Ownership until"],
        ]}
        actions={(r) => (
          <button onClick={() => setBusiness(r.id)}>Update opportunity</button>
        )}
      />
      <h2>Deals & customer checkout</h2>
      <Listing
        name="deals"
        query={admin ? "" : "&own=true"}
        columns={[
          ["code", "Deal"],
          ["business_name", "Business"],
          ["package_name", "Package"],
          ["price_cents", "Customer price"],
          ["commission_cents", "Commission"],
          ["stage", "Stage"],
        ]}
        actions={(r) => (
          <>
            {!["paid", "cancelled"].includes(r.stage) && (
              <button
                onClick={() =>
                  app.run(async () => {
                    const result = await api("/checkout", { id: r.id });
                    app.setLink(result.url);
                    app.refresh();
                  })
                }
              >
                Create / view checkout
              </button>
            )}
            <button onClick={() => setBusiness(r.business_id)}>
              Business details
            </button>
            {r.stage === "proposal" && !r.checkout_started_at && (
              <button
                onClick={() => show("Cancel draft deal", "deal_cancel", r)}
              >
                Cancel draft
              </button>
            )}
          </>
        )}
      />
      <h2>Advanced quote requests</h2>
      <Listing
        name="quote_requests"
        query={admin ? "" : "&own=true"}
        columns={[
          ["business_name", "Business"],
          ["customer_email", "Customer"],
          ["requirements", "Requested scope"],
          ["status", "Status"],
          ["created_at", "Requested"],
        ]}
        actions={(r) =>
          admin && r.status === "pending" ? (
            <>
              <button
                onClick={() =>
                  show("Approve Advanced quote", "quote_approve", r, [
                    {
                      name: "price_cents",
                      label: "Approved customer price ($)",
                      type: "currency",
                      required: true,
                    },
                  ])
                }
              >
                Approve quote
              </button>
              <button onClick={() => show("Decline quote", "quote_decline", r)}>
                Decline
              </button>
            </>
          ) : null
        }
      />
      {business && (
        <BusinessDetails id={business} onClose={() => setBusiness(null)} />
      )}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
