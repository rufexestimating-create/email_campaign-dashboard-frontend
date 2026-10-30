"use client";

import React, { useState } from "react";
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Clock, FileText, Inbox, Mail, Repeat, Send, ShieldCheck, Sparkles, TrendingUp, Users,
} from "lucide-react";
import { CheckStatus, PreflightAction, PreflightResult, STATUS_LABEL, STATUS_TONE, browserTimezone, callApi, parseEmails } from "@/lib/insights";
import { applyFix } from "@/lib/spam";
import type { CampaignDraft } from "@/components/dashboard/CampaignComposer";

const ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 size={18} />,
  warn: <AlertTriangle size={18} />,
  fail: <AlertOctagon size={18} />,
};
const VERDICT: Record<CheckStatus, { title: string; text: string }> = {
  pass: { title: "Ready to send", text: "Everything looks good. This email should reach the inbox." },
  warn: { title: "Good, with a few things to improve", text: "You can send it, but fixing the items below will help it reach more inboxes." },
  fail: { title: "Fix this before sending", text: "Something here is likely to hurt delivery. Use the fix buttons below." },
};
const ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

/** The 8 checks, in plain words, shown before the first run so people know what they'll get */
const CHECKS_PREVIEW: { id: string; icon: React.ReactNode; title: string; text: string }[] = [
  { id: "audience_health", icon: <Users size={17} />, title: "Who it's going to", text: "Bounced, complaining or shared inboxes like info@" },
  { id: "send_time", icon: <Clock size={17} />, title: "Timing", text: "Arrives when each person usually reads email" },
  { id: "frequency_fatigue", icon: <Repeat size={17} />, title: "How often", text: "People you've emailed too recently" },
  { id: "gmail_domain_risk", icon: <Mail size={17} />, title: "Gmail rules", text: "Spam reports and unsubscribe requirements" },
  { id: "volume_spike", icon: <TrendingUp size={17} />, title: "Volume", text: "Sudden jumps and your daily limit" },
  { id: "predicted_placement", icon: <Inbox size={17} />, title: "Inbox chance", text: "Estimated for Gmail, Outlook, Yahoo and others" },
  { id: "authentication", icon: <ShieldCheck size={17} />, title: "Your domain", text: "Security settings that prove the email really comes from you" },
  { id: "content_fit", icon: <FileText size={17} />, title: "The words", text: "Spam risk, unsubscribe line and address" },
];
const CHECK_ICON = Object.fromEntries(CHECKS_PREVIEW.map((c) => [c.id, c.icon]));

const EXAMPLE = {
  recipients: "delivered@resend.dev\ninfo@somefirm.com",
  subject: "Ideas for your kitchen remodel",
  body:
    "Hi {{first_name}},\n\nWe just finished a kitchen remodel near you and wrote up the layout ideas. Would a short call this week help?\n\n" +
    "Best,\nHamza, Arvistry",
};

/** datetime-local value ("2026-10-29T09:00") for an ISO time, in the browser's timezone */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "7 of 8 passed" as a ring, coloured by the verdict */
function ScoreRing({ passed, total, verdict }: { passed: number; total: number; verdict: CheckStatus }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className={`dl-ring is-${verdict}`} role="img" aria-label={`${passed} of ${total} checks passed`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="dl-ring-track" cx="36" cy="36" r={r} />
        <circle className="dl-ring-fill" cx="36" cy="36" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - passed / total)} />
      </svg>
      <div className="dl-ring-text"><strong>{passed}/{total}</strong><span>passed</span></div>
    </div>
  );
}

/** Check an email before sending: the same 8 checks as the review before sending, on any list and message. Nothing is sent. */
export function DeliverabilityPanel({ defaultFrom, onUseDraft }: { defaultFrom: string; onUseDraft: (draft: CampaignDraft) => void }) {
  const [form, setForm] = useState({
    from_email: defaultFrom || "Arvistry <hello@arvistry.com>",
    subject: "",
    body: "",
    recipients: "",
    scheduleType: "now" as "now" | "once",
    sendAt: "",
  });
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);

  const run = async (next = form) => {
    setRunning(true);
    setError(null);
    const res = await callApi<PreflightResult>("/campaign/preflight", {
      from_email: next.from_email,
      subject: next.subject,
      body: next.body,
      content_type: "text",
      recipients: parseEmails(next.recipients),
      schedule: { type: next.scheduleType, send_at: next.scheduleType === "once" && next.sendAt ? new Date(next.sendAt).toISOString() : null, timezone: browserTimezone() },
    });
    setRunning(false);
    setResult(res.data);
    setError(res.error);
  };

  const act = (action: PreflightAction) => {
    let next = form;
    if (action.type === "remove_recipients") {
      const drop = new Set(action.emails);
      next = { ...form, recipients: parseEmails(form.recipients).filter((e) => !drop.has(e)).join("\n") };
    } else if (action.type === "schedule_at") {
      next = { ...form, scheduleType: "once", sendAt: toLocalInput(action.at) };
    } else {
      next = { ...form, ...applyFix({ subject: form.subject, body: form.body }, action.fix) };
    }
    setForm(next);
    setApplied((a) => [...a, action.label]);
    if (parseEmails(next.recipients).length === 0) {
      // Nobody left to check: say so instead of running the checks on an empty list
      setResult(null);
      setError("That removed everyone on the list. Add at least one email address, then check again.");
      return;
    }
    run(next);
  };

  const count = parseEmails(form.recipients).length;
  const missing = count === 0 ? "Add at least one email address" : !form.subject.trim() ? "Add a subject line" : !form.body.trim() ? "Write the message" : null;
  const checks = result ? [...result.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]) : [];
  const issues = checks.filter((c) => c.status !== "pass");
  const passed = checks.filter((c) => c.status === "pass");

  return (
    <div className="lab-split">
      <form className="card dl-form" onSubmit={(e) => { e.preventDefault(); if (!missing) run(); }}>
        <div className="dl-form-head">
          <div>
            <h2 className="card-title">Check an email before you send it</h2>
            <p className="card-sub">Fill in three things and get an instant report. Nothing is sent.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...form, ...EXAMPLE }); setResult(null); setError(null); }}>
            <Sparkles size={14} /> Try an example
          </button>
        </div>

        <div className="dl-step">
          <span className="dl-step-num">1</span>
          <div className="dl-step-body">
            <label className="field-label" htmlFor="dl-recipients">Who will get it?</label>
            <textarea id="dl-recipients" className="input textarea" rows={3} value={form.recipients}
              onChange={(e) => setForm({ ...form, recipients: e.target.value })}
              placeholder={"name@company.com\nanother@gmail.com"} />
            <span className="field-hint">One email address per line. {count > 0 && <strong>{count} recipient{count === 1 ? "" : "s"}</strong>}</span>
          </div>
        </div>

        <div className="dl-step">
          <span className="dl-step-num">2</span>
          <div className="dl-step-body">
            <label className="field-label" htmlFor="dl-subject">What does it say?</label>
            <input id="dl-subject" className="input" placeholder="Subject line" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <textarea className="input textarea" rows={6} aria-label="Message" placeholder="Your message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
        </div>

        <div className="dl-step">
          <span className="dl-step-num">3</span>
          <div className="dl-step-body">
            <span className="field-label" id="dl-when">When will it go out?</span>
            <div className="segmented dl-when" role="radiogroup" aria-labelledby="dl-when">
              {(["now", "once"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.scheduleType === t} className={form.scheduleType === t ? "active" : ""}
                  onClick={() => setForm({ ...form, scheduleType: t })}>
                  {t === "now" ? "Right away" : "Later"}
                </button>
              ))}
            </div>
            {form.scheduleType === "once" && (
              <input className="input" type="datetime-local" required aria-label={`Date and time (${browserTimezone().replace(/_/g, " ")})`}
                value={form.sendAt} onChange={(e) => setForm({ ...form, sendAt: e.target.value })} />
            )}
          </div>
        </div>

        <details className="dl-advanced">
          <summary>Sender: {form.from_email}</summary>
          <label className="field">
            <span className="field-label">From</span>
            <input className="input" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} />
          </label>
        </details>

        <button className="btn btn-primary dl-submit" disabled={running || !!missing}>
          <ShieldCheck size={16} /> {running ? "Checking…" : "Check my email"}
        </button>
        {missing && <p className="field-hint dl-missing">{missing} to run the check.</p>}
      </form>

      <div className="lab-stack">
        {error && <div className="alert alert-danger" role="alert">{error}</div>}

        {!result && !running && (
          <div className="card">
            <h2 className="card-title">8 things we check</h2>
            <p className="card-sub">The same checks run automatically every time you send a campaign.</p>
            <ul className="dl-preview">
              {CHECKS_PREVIEW.map((c) => (
                <li key={c.id}>
                  <span className="dl-preview-icon">{c.icon}</span>
                  <div><strong>{c.title}</strong><span>{c.text}</span></div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {running && !result && (
          <div className="card empty">
            <div className="loader" />
            <p>Checking 8 things…</p>
          </div>
        )}

        {result && (
          <>
            <div className={`card dl-summary is-${result.verdict}`}>
              <ScoreRing passed={result.counts.pass} total={result.checks.length} verdict={result.verdict} />
              <div className="dl-summary-text">
                <strong>{VERDICT[result.verdict].title}</strong>
                <p>{VERDICT[result.verdict].text}</p>
                <div className="dl-summary-pills">
                  {result.counts.fail > 0 && <span className="pill no-dot tone-danger">{result.counts.fail} to fix</span>}
                  {result.counts.warn > 0 && <span className="pill no-dot tone-warning">{result.counts.warn} to improve</span>}
                  <span className="pill no-dot tone-success">{result.counts.pass} fine</span>
                </div>
              </div>
            </div>

            {issues.length > 0 && (
              <div className="card">
                <h2 className="card-title">What to look at</h2>
                <ul className="lab-checks">
                  {issues.map((c) => (
                    <li key={c.id} className={`lab-check is-${c.status}`}>
                      <span className={`lab-check-icon ${STATUS_TONE[c.status]}`}>{CHECK_ICON[c.id] ?? ICON[c.status]}</span>
                      <div className="lab-check-body">
                        <div className="lab-check-head">
                          <strong>{c.name}</strong>
                          <span className={`pill no-dot ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                        </div>
                        <p className="lab-check-msg">{c.message}</p>
                        {c.detail && <p className="field-hint">{c.detail}</p>}
                        {c.id === "predicted_placement" && Array.isArray(c.data.providers) && (
                          <ul className="lab-providers">
                            {(c.data.providers as { provider: string; name: string; recipients: number; inbox_probability: number }[]).map((p) => (
                              <li key={p.provider}>
                                <span>{p.name} ({p.recipients})</span>
                                <span className="lab-bar" aria-hidden="true"><i style={{ transform: `scaleX(${p.inbox_probability})` }} /></span>
                                <span>~{Math.round(p.inbox_probability * 100)}% inbox</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {c.action && (
                          <button type="button" className="btn btn-secondary btn-sm act-accent" onClick={() => act(c.action!)} disabled={running}>
                            {c.action.label}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {applied.length > 0 && <p className="field-hint" style={{ marginTop: "0.6rem" }}>Fixed so far: {applied.join(" · ")}</p>}
              </div>
            )}

            {passed.length > 0 && (
              <details className="card dl-passed">
                <summary><CheckCircle2 size={16} /> {passed.length} check{passed.length === 1 ? "" : "s"} passed</summary>
                <ul>
                  {passed.map((c) => (
                    <li key={c.id}><span className="dl-preview-icon is-pass">{CHECK_ICON[c.id] ?? ICON.pass}</span><div><strong>{c.name}</strong><span>{c.message}</span></div></li>
                  ))}
                </ul>
              </details>
            )}

            {/* This page only checks; sending happens in New campaign. Hand the draft over so nothing is retyped. */}
            <div className="dl-next">
              <p>
                This was only a check, so <strong>nothing has been sent</strong>.
                {result.verdict === "fail" ? " Fix the item above first, or send it anyway from New campaign with a reason." : " Happy with it? Turn it into a campaign."}
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => onUseDraft({ subject: form.subject, body: form.body, recipients: parseEmails(form.recipients).join("\n") })}>
                <Send size={14} /> Create campaign from this
              </button>
            </div>
            <p className="field-hint">{result.note}</p>
          </>
        )}
      </div>
    </div>
  );
}
