import { useState } from "react";
import { useApp, Heading, Listing, Modal, Form, type Field } from "./lib";
import { label, type Row } from "../shared/core";
type Question = { question: string; options: string[]; answer: string };
export function ContentAdmin() {
  const app = useApp(),
    [item, setItem] = useState<Row | null>(null),
    [kind, setKind] = useState("lesson"),
    [questions, setQuestions] = useState<Question[]>([]);
  const open = (r: Row = {}) => {
    setItem(r);
    setKind(r.kind || "lesson");
    setQuestions(
      r.kind === "quiz"
        ? JSON.parse(r.body).map((q: Question) => ({ ...q, answer: "" }))
        : [{ question: "", options: ["", ""], answer: "" }],
    );
  };
  const update = (i: number, change: Partial<Question>) =>
    setQuestions((v) => v.map((q, j) => (i === j ? { ...q, ...change } : q)));
  const fields: Field[] = [
    {
      name: "slug",
      label: "Reference name",
      required: true,
      hint: "Lowercase words separated by hyphens. Reuse the reference to publish a new version.",
    },
    { name: "title", label: "Title", required: true, minLength: 3 },
    ...(kind === "quiz"
      ? []
      : [
          {
            name: "body",
            label: "Content",
            type: "textarea",
            required: true,
            minLength: 10,
          },
        ]),
    { name: "required", label: "Required for onboarding", type: "checkbox" },
    {
      name: "reason",
      label: "Publication reason",
      type: "textarea",
      required: true,
      minLength: 5,
    },
  ];
  return (
    <>
      <Heading
        title="Training & content"
        description="Publish new versions while preserving past completions and agreement acceptances."
      >
        <button className="primary" onClick={() => open()}>
          Publish content
        </button>
      </Heading>
      <Listing
        name="content"
        columns={[
          ["kind", "Kind"],
          ["title", "Title"],
          ["version", "Version"],
          ["required", "Required"],
          ["active", "Current"],
        ]}
        actions={(r) => (
          <>
            <button onClick={() => open(r)}>Read / publish revision</button>
            {r.active && (
              <button
                onClick={() =>
                  app.run(() =>
                    app.mutate("content_archive", {
                      id: r.id,
                      reason: "Archive content from current publication",
                    }),
                  )
                }
              >
                Archive
              </button>
            )}
          </>
        )}
      />
      {item && (
        <Modal
          title={item.id ? "Publish a content revision" : "Publish content"}
          onClose={() => setItem(null)}
        >
          <label className="field">
            Content type
            <select
              value={kind}
              disabled={!!item.id}
              onChange={(e) => setKind(e.target.value)}
            >
              {[
                "lesson",
                "script",
                "knowledge",
                "announcement",
                "quiz",
                ...(app.has("owner") ? ["agreement"] : []),
              ].map((k) => (
                <option key={k} value={k}>
                  {label(k)}
                </option>
              ))}
            </select>
          </label>
          {kind === "quiz" && (
            <div className="quiz-builder">
              <p>
                Choose the correct answer for every question. Answer keys stay
                private. Revisions require a fresh answer key.
              </p>
              {questions.map((q, i) => (
                <fieldset key={i}>
                  <legend>Question {i + 1}</legend>
                  <label className="field">
                    Question
                    <input
                      value={q.question}
                      maxLength={1000}
                      onChange={(e) => update(i, { question: e.target.value })}
                    />
                  </label>
                  {q.options.map((o, j) => (
                    <label className="field" key={j}>
                      Answer {j + 1}
                      <input
                        value={o}
                        maxLength={500}
                        onChange={(e) =>
                          update(i, {
                            options: q.options.map((v, k) =>
                              k === j ? e.target.value : v,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                  <label className="field">
                    Correct answer
                    <select
                      aria-label={`Correct answer ${i + 1}`}
                      value={q.answer}
                      onChange={(e) => update(i, { answer: e.target.value })}
                    >
                      <option value="">Choose the correct answer</option>
                      {q.options.map((o, j) => (
                        <option key={j} value={j}>
                          {j + 1}. {o || "Enter answer text"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="actions">
                    <button
                      disabled={q.options.length >= 8}
                      onClick={() => update(i, { options: [...q.options, ""] })}
                    >
                      Add answer
                    </button>
                    <button
                      disabled={q.options.length <= 2}
                      onClick={() =>
                        update(i, {
                          options: q.options.slice(0, -1),
                          answer: "",
                        })
                      }
                    >
                      Remove last answer
                    </button>
                    <button
                      disabled={questions.length <= 1}
                      onClick={() =>
                        setQuestions(questions.filter((_, j) => j !== i))
                      }
                    >
                      Remove question
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                disabled={questions.length >= 50}
                onClick={() =>
                  setQuestions([
                    ...questions,
                    { question: "", options: ["", ""], answer: "" },
                  ])
                }
              >
                Add question
              </button>
            </div>
          )}
          <Form
            key={kind + item.id}
            initial={item}
            fields={fields}
            submit="Publish version"
            onSubmit={async (p) => {
              if (kind === "quiz") {
                if (
                  questions.some(
                    (q) =>
                      q.question.trim().length < 3 ||
                      q.options.some((o) => !o.trim()) ||
                      q.answer === "",
                  )
                )
                  throw Error(
                    "Complete each question, its answers and the correct answer.",
                  );
                p.body = JSON.stringify(
                  questions.map((q) => ({
                    question: q.question.trim(),
                    options: q.options.map((o) => o.trim()),
                  })),
                );
                p.answers = questions.map((q) => Number(q.answer));
              }
              await app.mutate("content", { ...p, kind });
              setItem(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
