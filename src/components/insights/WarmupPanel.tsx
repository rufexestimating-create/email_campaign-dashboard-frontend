"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Flame, Inbox, Info, Mail, Plus, Trash2 } from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { WarmupStatus, callApi } from "@/lib/insights";

const PROVIDER: Record<string, string> = { gmail: "Gmail", outlook: "Outlook", yahoo: "Yahoo", icloud: "iCloud", other: "Other" };
const PLACEMENTS = [
  { id: "inbox", label: "Inbox" },
  { id: "promotions", label: "Promotions" },
  { id: "spam", label: "Spam" },
] as const;
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Domain warm-up: a daily limit that grows week by week, and the team's own test inboxes for checking where emails land */
export function WarmupPanel({ notify }: { notify: (msg: string, isError?: boolean) => void }) {
  const [data, setData] = useState<WarmupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await callApi<WarmupStatus>("/insights/warmup");
    setData(res.data);
    setError(res.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const request = async (key: string, path: string, method: string, body?: object, done?: string) => {
    setBusy(key);
    try {
      const res = await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (!res.ok) return notify(errorMessage(json, "That didn't work. Please try again."), true);
      if (done) notify(done);
      await load();
      return json;
    } catch {
      notify(NETWORK_ERROR, true);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <div>{error} <button className="link-btn" onClick={load}>Try again</button></div>
      </div>
    );
  }
  if (!data) return <div className="card empty"><div className="loader" /></div>;

  const used = Math.min(data.sent_today / Math.max(data.limit, 1), 1);
  const lastWeek = data.schedule.length - 1;
  return (
    <div className="lab-stack">
      {/* Where the domain is today */}
      <section className="wu-hero">
        <div className="wu-hero-main">
          <span className="wu-hero-icon"><Flame size={20} /></span>
          <div>
            <h2>
              {!data.enabled ? "Warm-up is switched off" : data.warming ? `Week ${data.week} of ${lastWeek}: building trust` : "Warm-up complete"}
            </h2>
            <p>
              {!data.enabled
                ? `You can send up to your plan's ${data.account_limit} emails a day. Switch the warm-up on if arvistry.com is still new.`
                : data.warming
                  ? `Gmail and Outlook trust a new domain when its volume grows slowly. Today you can send ${data.limit} emails; this rises every week.`
                  : `Your domain has finished warming up. You can send up to ${data.account_limit} emails a day.`}
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy === "toggle"}
            onClick={() => request("toggle", "/insights/warmup", "PUT", { enabled: !data.enabled }, data.enabled ? "Warm-up switched off." : "Warm-up switched on.")}
          >
            {data.enabled ? "Switch off" : "Switch on"}
          </button>
        </div>
        <div className="wu-today">
          <div className="wu-today-top">
            <span>Sent today</span>
            <strong>{data.sent_today} <em>of {data.limit}</em></strong>
          </div>
          <div className="wu-bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.limit} aria-valuenow={data.sent_today} aria-label="Emails sent today">
            <i style={{ transform: `scaleX(${used})` }} className={used >= 1 ? "is-full" : ""} />
          </div>
          <span className="field-hint">
            {data.remaining_today > 0 ? `${data.remaining_today} more can go out today. The review before sending stops anything over the limit.` : "Today's limit is reached. New sends will be asked to wait until tomorrow."}
          </span>
        </div>
      </section>

      {/* The schedule */}
      {data.enabled && (
        <div className="card">
          <div className="card-head" style={{ marginBottom: "1rem" }}>
            <div>
              <h2 className="card-title">Your warm-up plan</h2>
              <p className="card-sub">The daily limit doubles roughly every week. Started {fmtDate(data.start_date)}.</p>
            </div>
            <label className="wu-start">
              <span>Start date</span>
              <input
                type="date"
                className="input"
                value={data.start_date}
                onChange={(e) => e.target.value && request("start", "/insights/warmup", "PUT", { start_date: e.target.value }, "Start date updated.")}
              />
            </label>
          </div>
          <ol className="wu-steps">
            {data.schedule.map((s) => (
              <li key={s.week} className={`${s.current ? "is-current" : ""} ${data.week && s.week < data.week && !s.full ? "is-done" : ""}`}>
                <span className="wu-step-week">{s.full ? "After" : `Week ${s.week}`}</span>
                <strong>{s.per_day}<em>/day</em></strong>
                <span className="wu-step-date">{s.full ? "Full volume" : `from ${fmtDate(s.from)}`}</span>
                {s.current && <span className="pill no-dot tone-primary">Now</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid-2 lab-grid">
        {/* Seed inboxes */}
        <div className="card">
          <h2 className="card-title"><Inbox size={17} /> Your test inboxes</h2>
          <p className="card-sub">
            Add your own Gmail, Outlook and Yahoo addresses. They receive every campaign, so you can see where it landed. They never get follow-ups and never count as leads.
          </p>
          <form
            className="wu-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await request("add", "/insights/warmup/seeds", "POST", { email: seed.trim() }, "Test inbox added.")) setSeed("");
            }}
          >
            <input className="input" type="email" required placeholder="yourname@gmail.com" aria-label="Test inbox address" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <button className="btn btn-primary" disabled={busy === "add" || data.seeds.length >= data.seed_limit}><Plus size={15} /> Add</button>
          </form>
          <label className="wu-toggle">
            <input
              type="checkbox"
              checked={data.seeds_enabled}
              onChange={(e) => request("seeds", "/insights/warmup", "PUT", { seeds_enabled: e.target.checked }, e.target.checked ? "Test inboxes will get every campaign." : "Test inboxes paused.")}
            />
            Add them to every campaign automatically
          </label>

          {data.seeds.length === 0 ? (
            <p className="field-hint" style={{ marginTop: "0.9rem" }}>No test inboxes yet. One each for Gmail, Outlook and Yahoo is ideal.</p>
          ) : (
            <ul className="wu-seeds">
              {data.seeds.map((s) => (
                <li key={s.id}>
                  <div className="wu-seed-who">
                    <Mail size={15} aria-hidden="true" />
                    <span className="truncate">{s.email}</span>
                    <span className="pill no-dot tone-neutral">{PROVIDER[s.provider]}</span>
                  </div>
                  <div className="wu-seed-log" role="group" aria-label={`Where did the last campaign land for ${s.email}?`}>
                    <span>Last email landed in:</span>
                    {PLACEMENTS.map((p) => (
                      <button
                        key={p.id}
                        className={`btn btn-secondary btn-sm wu-place-${p.id}`}
                        disabled={busy === `log-${s.id}`}
                        onClick={() => request(`log-${s.id}`, "/placement-labels", "POST", { recipient: s.email, placement: p.id, source: "seed_test" }, `Logged: ${p.label} for ${PROVIDER[s.provider]}.`)}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button className="icon-btn" aria-label={`Remove ${s.email}`} disabled={busy === `del-${s.id}`}
                      onClick={() => request(`del-${s.id}`, `/insights/warmup/seeds/${s.id}`, "DELETE", undefined, "Test inbox removed.")}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* How it works */}
        <div className="card">
          <h2 className="card-title"><Info size={17} /> How to warm up the right way</h2>
          <ul className="wu-tips">
            <li><CheckCircle2 size={16} /><span><strong>Start small and grow.</strong> The plan above does this for you, and the review before sending blocks anything over today&apos;s limit.</span></li>
            <li><CheckCircle2 size={16} /><span><strong>Email people who expect you.</strong> Clients and contacts who know Arvistry open and reply, and that is what builds trust.</span></li>
            <li><CheckCircle2 size={16} /><span><strong>Ask for replies.</strong> A question at the end of an email (&ldquo;Would Tuesday suit a call?&rdquo;) is the strongest signal to Gmail.</span></li>
            <li><CheckCircle2 size={16} /><span><strong>Check your test inboxes after each campaign</strong> and click where it landed. If it went to Spam, open it, click &ldquo;Not spam&rdquo;, and reply.</span></li>
            <li><CheckCircle2 size={16} /><span><strong>Every result you log teaches the inbox prediction</strong>, so it learns from your real emails instead of sample data.</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
