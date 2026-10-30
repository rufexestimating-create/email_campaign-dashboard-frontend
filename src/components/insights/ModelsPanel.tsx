"use client";

import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { apiFetch } from "@/lib/auth";
import { LeadScoresOverview, MODEL_NAMES, ModelInfo, callApi } from "@/lib/insights";
import { LoadError } from "./LoadError";

const TARGETS = [
  ["reply", "Will they reply?"],
  ["mql", "Will they become marketing-qualified?"],
  ["sql", "Will they become sales-ready?"],
] as const;

/** "numeric__kw_high" -> "High-risk phrases", "subject__free" -> `"free" in the subject` */
const SIGNAL_NAMES: Record<string, string> = {
  kw_high: "High-risk phrases", kw_medium: "Medium-risk phrases", kw_low: "Low-risk phrases", kw_in_subject: "Risky words in the subject",
  has_unsubscribe: "Unsubscribe line", has_address: "Postal address", personalised: "Personal greeting", caps_ratio: "Capital letters",
  exclamations: "Exclamation marks", money_signs: "Prices ($)", links: "Number of links", images: "Images", word_count: "Length of message",
  subject_length: "Length of subject",
};
function signalName(f: string) {
  const [kind, name] = f.split("__");
  if (kind === "numeric") return SIGNAL_NAMES[name] ?? name.replace(/^issue_/, "").replace(/_/g, " ");
  return `"${name}" in the ${kind === "subject" ? "subject" : "message"}`;
}

/** Quality as a word, so the numbers mean something to non-specialists (PR-AUC / ROC-AUC style scores, 0-1) */
const quality = (v: number | null | undefined) => (v === null || v === undefined ? "Not measured" : v >= 0.85 ? "Strong" : v >= 0.7 ? "Good" : v >= 0.55 ? "Fair" : "Weak");

/** How the two prediction models (inbox placement and lead scoring) are doing, and what they learned from */
export function ModelsPanel() {
  const [spam, setSpam] = useState<ModelInfo | null>(null);
  const [leads, setLeads] = useState<LeadScoresOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plot, setPlot] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let url: string | null = null;
    const timer = setTimeout(async () => {
      setError(null);
      const [s, l] = await Promise.all([callApi<ModelInfo>("/insights/model"), callApi<LeadScoresOverview>("/leads/scores")]);
      setError(s.error ?? l.error);
      setSpam(s.data);
      setLeads(l.data);
      if (!s.data?.available) return;
      // The image needs the login token, so it's fetched rather than linked
      const res = await apiFetch("/insights/model/calibration.png").catch(() => null);
      if (res?.ok) {
        url = URL.createObjectURL(await res.blob());
        setPlot(url);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [attempt]);

  if (error) return <LoadError message={error} onRetry={() => setAttempt((a) => a + 1)} />;
  if (!spam || !leads) return <div className="card empty"><div className="loader" /></div>;
  const leadModel = leads.model;
  const starter = spam.data_source === "synthetic" || leadModel?.data_source === "synthetic";

  return (
    <div className="lab-stack">
      {starter && (
        <div className="alert alert-info" role="status">
          <Info size={18} />
          <div>
            <strong>Starter models in use.</strong> Both models currently learn from sample data, so treat their numbers as rough guides.
            They switch to your own results automatically once you&apos;ve logged 200 inbox tests and set the stage on enough leads.
          </div>
        </div>
      )}

      <div className="lab-split">
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Inbox prediction</h2>
              <p className="card-sub">Estimates the chance an email lands in spam. Part of every inbox score and pre-send review.</p>
            </div>
            {spam.available && (
              <span className={`pill no-dot ${spam.data_source === "synthetic" ? "tone-neutral" : "tone-success"}`}>
                {spam.data_source === "synthetic" ? "Starter model" : "Learned from your tests"}
              </span>
            )}
          </div>
          {!spam.available ? (
            <p className="field-hint">Not set up yet. Inbox scores use the writing checks only.</p>
          ) : (
            <>
              <div className="lab-tiles">
                <div className="lab-tile"><span>Accuracy at ranking</span><strong>{quality(spam.metrics?.roc_auc)}</strong><em>score {spam.metrics?.roc_auc?.toFixed(2) ?? "—"}</em></div>
                <div className="lab-tile"><span>Catching spam</span><strong>{quality(spam.metrics?.pr_auc)}</strong><em>score {spam.metrics?.pr_auc?.toFixed(2) ?? "—"}</em></div>
                <div className="lab-tile"><span>Share of inbox score</span><strong>{Math.round((spam.weight ?? 0) * 100)}%</strong><em>the rest is the writing checks</em></div>
              </div>
              <dl className="lab-facts" style={{ marginTop: "1rem" }}>
                <div><dt>Version</dt><dd>{spam.version}, updated {spam.trained_at ? new Date(spam.trained_at).toLocaleDateString() : "—"}</dd></div>
                <div><dt>Learned from</dt><dd>{spam.rows?.total.toLocaleString()} emails</dd></div>
              </dl>
            </>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">Are the percentages honest?</h2>
          <p className="card-sub">When the dots follow the dashed line, a predicted 30% really does mean about 3 in 10 emails land in spam.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, which next/image can't optimise */}
          {plot ? <img src={plot} alt="Predicted spam chance compared with how often emails really landed in spam" className="lab-plot" /> : <p className="field-hint">Not available yet.</p>}
        </div>
      </div>

      {spam.available && spam.top_coefficients && (
        <div className="grid-2 lab-grid">
          {(["toward_spam", "toward_inbox"] as const).map((side) => (
            <div key={side} className="card">
              <h2 className="card-title">{side === "toward_spam" ? "What pushes emails toward spam" : "What helps emails reach the inbox"}</h2>
              <ol className="lab-coefs">
                {spam.top_coefficients![side].slice(0, 8).map((c) => (
                  <li key={c.feature}>
                    <span>{signalName(c.feature)}</span>
                    <span className={`pill no-dot ${side === "toward_spam" ? "tone-danger" : "tone-success"}`}>{side === "toward_spam" ? "Hurts" : "Helps"}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      <div className="card card-flush">
        <div className="lab-pad card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 className="card-title">Lead scoring</h2>
            <p className="card-sub">For each question, two kinds of model are tested on your most recent leads and the more accurate one is used.</p>
          </div>
          {leadModel && <span className={`pill no-dot ${leadModel.data_source === "synthetic" ? "tone-neutral" : "tone-success"}`}>{leadModel.data_source === "synthetic" ? "Starter model" : "Learned from your leads"}</span>}
        </div>
        {!leadModel ? (
          <p className="field-hint lab-pad">Not set up yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Question</th><th>Model in use</th><th>Accuracy</th><th>Explains its scores</th></tr></thead>
              <tbody>
                {TARGETS.map(([t, question]) => {
                  const c = leadModel.comparison[t];
                  const used = c.winner === "logistic_regression" ? c.logistic_regression : c.lightgbm ?? c.hist_gradient_boosting;
                  return (
                    <tr key={t}>
                      <td>{question}</td>
                      <td>{MODEL_NAMES[c.winner]}</td>
                      <td>{quality(used?.pr_auc)} <span className="field-hint">({used?.pr_auc?.toFixed(2) ?? "—"})</span></td>
                      <td>{c.explanations === "none" ? "No" : "Yes"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
