import { useState } from "react";
import {
  useApp,
  useData,
  Heading,
  Card,
  State,
  Form,
  Listing,
  LinkButton,
  ActionDialog,
  PersonLink,
} from "./lib";
import { label } from "../shared/core";
export function ApplicantDetail({ id }: { id: string }) {
  const app = useApp(),
    state = useData(`/table?name=applicants&id=${encodeURIComponent(id)}`),
    applicant = state.data?.rows?.[0],
    [approve, setApprove] = useState(false);
  return (
    <>
      <Heading title={applicant?.name || "Application"}>
        <LinkButton to="/admin/recruiting">All applicants</LinkButton>
      </Heading>
      <State {...state}>
        {applicant && (
          <>
            {applicant.rep_id && (
              <Card title="Rep account created">
                <PersonLink row={applicant}>Manage {applicant.name}</PersonLink>
                <p>The original application is retained below.</p>
              </Card>
            )}
            <Card title="Original application">
              <dl className="detail-grid">
                {Object.entries({
                  email: applicant.email,
                  stage: applicant.stage,
                  applied_at: applicant.created_at,
                  ...applicant.details,
                }).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>{String(value ?? "Not provided")}</dd>
                  </div>
                ))}
              </dl>
              {!applicant.rep_id && (
                <button onClick={() => setApprove(true)}>
                  Approve & invite
                </button>
              )}
            </Card>
            <Card title="Review notes">
              <Form
                fields={[
                  {
                    name: "body",
                    label: "Internal review note",
                    type: "textarea",
                    required: true,
                  },
                ]}
                submit="Add note"
                onSubmit={(p) =>
                  app.mutate("applicant_note", {
                    ...p,
                    id: applicant.id,
                    reason: "Applicant review note",
                  })
                }
              />
              <Listing
                name="applicant_notes"
                query={`&applicant=${applicant.id}`}
                columns={[
                  ["body", "Review note"],
                  ["created_at", "Added"],
                ]}
              />
            </Card>
            {approve && (
              <ActionDialog
                title="Approve & invite"
                action=""
                endpoint="/approve"
                initial={applicant}
                onClose={() => setApprove(false)}
              />
            )}
          </>
        )}
      </State>
    </>
  );
}
