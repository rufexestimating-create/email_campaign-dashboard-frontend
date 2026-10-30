"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleDashed, RefreshCw } from "lucide-react";
import { TrackingSummary, callApi } from "@/lib/insights";

const EVENT_LABELS: [keyof TrackingSummary["events"], string][] = [
  ["delivered", "Delivered"], ["opened", "Opened"], ["clicked", "Clicked"], ["replied", "Replied"], ["bounced", "Bounced"], ["complained", "Marked as spam"],
];
const LABELS_NEEDED = 200;

/** What engagement data the account has collected, plus the two things Resend can't see: replies and inbox-test results */
export function TrackingPanel({ notify }: { notify: (msg: string, isError?: boolean) => void }) {
  const [summary, setSummary] = useState<TrackingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState({ recipient: "", replied_at: "" });
  const [label, setLabel] = useState({ recipient: "", placement: "inbox", notes: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await callApi<TrackingSummary>("/insights/tracking-summary");
    setError(res.error);
    if (res.data) setSummary(res.data);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const submit = async (path: string, body: object, done: string, reset: () => void) => {
    setBusy(true);
    const { error } = await callApi(path, body);
    setBusy(false);
    if (error) return notify(error, true);
    notify(done);
    reset();
    load();
  };

  const connected = summary ? summary.events.delivered + summary.events.opened + summary.events.clicked > 0 : false;
  return (
    <div className="lab-stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Engagement data</h2>
            <p className="card-sub">Deliveries, opens, clicks, bounces and spam reports come from Resend automatically. Replies and inbox tests are logged below.</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        {summary && (
          <>
            <div className={`ins-status ${connected ? "is-on" : ""}`}>
              {connected ? <CircleCheck size={16} /> : <CircleDashed size={16} />}
              {connected ? "Receiving events from Resend" : "Waiting for the first events from Resend"}
            </div>
            <div className="lab-tiles">
              {EVENT_LABELS.map(([k, name]) => (
                <div key={k} className="lab-tile"><span>{name}</span><strong>{summary.events[k].toLocaleString()}</strong></div>
              ))}
              <div className="lab-tile">
                <span>Inbox tests logged</span>
                <strong>{summary.usable_labels}</strong>
                <em>{summary.usable_labels >= LABELS_NEEDED ? "Enough to train the prediction model" : `${LABELS_NEEDED - summary.usable_labels} more to train the prediction model`}</em>
              </div>
            </div>
            {!connected && (
              <p className="field-hint" style={{ marginTop: "0.9rem" }}>
                Opens, clicks and bounces start showing here once the app is online and connected to Resend. Ask your developer to switch on delivery tracking; it takes a few minutes.
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid-2 lab-grid">
        <form
          className="card lab-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit("/events/reply", { recipient: reply.recipient, replied_at: reply.replied_at ? new Date(reply.replied_at).toISOString() : null },
              "Reply logged.", () => setReply({ recipient: "", replied_at: "" }));
          }}
        >
          <div>
            <h2 className="card-title">Log a reply</h2>
            <p className="card-sub">Replies land in your own inbox, so log them here. They improve send-time advice and lead scores.</p>
          </div>
          <label className="field">
            <span className="field-label">Who replied</span>
            <input className="input" type="email" required value={reply.recipient} onChange={(e) => setReply({ ...reply, recipient: e.target.value })} placeholder="name@company.com" />
          </label>
          <label className="field">
            <span className="field-label">When</span>
            <input className="input" type="datetime-local" value={reply.replied_at} onChange={(e) => setReply({ ...reply, replied_at: e.target.value })} />
            <span className="field-hint">Leave empty for now.</span>
          </label>
          <div><button className="btn btn-primary" disabled={busy}>Log reply</button></div>
        </form>

        <form
          className="card lab-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit("/placement-labels", { ...label, source: "seed_test", notes: label.notes || null }, "Inbox test logged.",
              () => setLabel({ ...label, recipient: "", notes: "" }));
          }}
        >
          <div>
            <h2 className="card-title">Log an inbox test</h2>
            <p className="card-sub">Include your own Gmail, Outlook and Yahoo addresses in a campaign, then record where it arrived. This teaches the prediction model.</p>
          </div>
          <label className="field">
            <span className="field-label">Test inbox</span>
            <input className="input" type="email" required value={label.recipient} onChange={(e) => setLabel({ ...label, recipient: e.target.value })} placeholder="yourname@gmail.com" />
          </label>
          <label className="field">
            <span className="field-label">Where it arrived</span>
            <select className="input" value={label.placement} onChange={(e) => setLabel({ ...label, placement: e.target.value })}>
              <option value="inbox">Inbox</option>
              <option value="promotions">Promotions tab</option>
              <option value="spam">Spam folder</option>
              <option value="missing">Didn&apos;t arrive</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Note</span>
            <input className="input" value={label.notes} maxLength={500} placeholder="Optional" onChange={(e) => setLabel({ ...label, notes: e.target.value })} />
          </label>
          <div><button className="btn btn-primary" disabled={busy}>Log result</button></div>
        </form>
      </div>
    </div>
  );
}
