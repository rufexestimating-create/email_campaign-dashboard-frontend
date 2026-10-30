"use client";

import React, { useEffect, useRef, useState } from "react";
import { SpamCheck } from "@/components/dashboard/SpamCheck";
import { callApi } from "@/lib/insights";
import { SpamField, SpamResult, SpamSpan, applyFix } from "@/lib/spam";

const DEBOUNCE_MS = 800;

const EXAMPLES = {
  spammy: {
    subject: "FREE QUOTE!!! Act now",
    body: "Get your FREE QUOTE TODAY!! Click here https://bit.ly/3xRemodel and save $500, prices from $99!\n\nLIMITED TIME offer for the first 10 homeowners only!!!",
  },
  clean: {
    subject: "{{first_name}}, ideas for your bathroom remodel",
    body:
      "Hi {{first_name}},\n\nWe recently finished a bathroom remodel a few streets from you and put together a short case study of the layout and lighting choices.\n\n" +
      "Would a 15-minute call on Tuesday or Wednesday work to talk through your project?\n\nBest regards,\nHamza, Arvistry\n\n" +
      "Don't want these emails? Reply \"unsubscribe\" and we'll take you off our list.\nArvistry Design Studio, 1200 Example Street, Suite 300, Austin, TX 78701",
  },
};

/** Paste any email to see its spam risk, with the same checks and fixes as the campaign editor. Nothing is saved. */
export function EmailChecker({ onOpenGuide }: { onOpenGuide: () => void }) {
  const [content, setContent] = useState<Record<SpamField, string>>({ subject: "", body: "" });
  const [result, setResult] = useState<SpamResult | null>(null);
  const [checked, setChecked] = useState<Record<SpamField, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!content.subject.trim() && !content.body.trim()) return;
    const snapshot = content;
    const timer = setTimeout(async () => {
      setLoading(true);
      const { data, error } = await callApi<SpamResult>("/template/score", { ...snapshot, content_type: "text" });
      setLoading(false);
      setError(error);
      if (data) {
        setResult(data);
        setChecked(snapshot);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [content]);

  const stale = !checked || checked.subject !== content.subject || checked.body !== content.body;
  const show = (span: SpamSpan) => {
    const el = span.field === "subject" ? subjectRef.current : bodyRef.current;
    el?.focus();
    el?.setSelectionRange(span.start, span.end);
  };

  return (
    <div className="lab-split">
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Check an email</h2>
            <p className="card-sub">Paste a subject and message to see how likely it is to reach the inbox. Nothing is saved or sent.</p>
          </div>
          <div className="lab-row">
            <button className="btn btn-ghost btn-sm" onClick={() => setContent(EXAMPLES.spammy)}>Load a risky example</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setContent(EXAMPLES.clean)}>Load a good example</button>
          </div>
        </div>
        <div className="lab-form">
          <label className="field">
            <span className="field-label">Subject line</span>
            <input ref={subjectRef} className="input" placeholder="e.g. {{first_name}}, ideas for your kitchen remodel" value={content.subject} onChange={(e) => setContent({ ...content, subject: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea ref={bodyRef} className="input textarea" rows={10} placeholder="Paste or write your email here" value={content.body} onChange={(e) => setContent({ ...content, body: e.target.value })} />
          </label>
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          {result && (
            <dl className="lab-facts">
              <div><dt>Spam risk</dt><dd>{result.score} / 100</dd></div>
              <div><dt>From the writing checks</dt><dd>{result.rule_score ?? result.score} / 100</dd></div>
              <div><dt>From the prediction model</dt><dd>{result.model ? `${result.model.spam_percent}% chance of spam` : "Not available"}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <SpamCheck
        result={result}
        loading={loading}
        stale={stale}
        title="Inbox score"
        onFix={(fix) => setContent(applyFix(content, fix))}
        onShow={show}
        onOpenGuide={onOpenGuide}
      />
    </div>
  );
}
