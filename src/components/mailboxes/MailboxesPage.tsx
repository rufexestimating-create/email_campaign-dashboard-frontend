"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownLeft, CheckCircle2, Send, Smile, X, ArrowUpRight, Flame, Inbox, KeyRound, Mail, Plus, RefreshCw, ShieldCheck, Trash2,
} from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { callApi } from "@/lib/insights";
import type { ConfirmRequest } from "@/components/dashboard/ConfirmDialog";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";
import { NewslettersPanel } from "./NewslettersPanel";

type Health = "healthy" | "fair" | "poor" | "starting" | "paused" | "error";

interface MailboxRow {
  id: string;
  email: string;
  display_name: string | null;
  status: "active" | "paused" | "error";
  last_error: string | null;
  last_checked_at: string | null;
  daily_limit: number;
  warmup_increase: number | null;
  warmup_reply_rate: number | null;
  warmup_weekdays_only: boolean;
  warmup_started_on: string;
  warmup_settings: Advanced;
  sent_7d: number;
  received_7d: number;
  failed_7d: number;
  last_failure: { at: string; error: string } | null;
  last_activity_at: string | null;
  warmup_day: number;
  target_today: number;
  sent_today: number;
  initial_today: number;
  scheduled_today: number;
  received_today: number;
  inbox_7d: number;
  spam_7d: number;
  inbox_rate_7d: number | null;
  rescued_7d: number;
  replies_7d: number;
  waiting: number;
  health: Health;
  ready: boolean;
  series: { date: string; sent: number; inbox: number; spam: number }[];
}

interface Advanced {
  slow_ramp: boolean;
  random_daily: boolean;
  open_rate: number;
  spam_protection: number;
  important_rate: number;
  read_emulation: boolean;
  timezone: string | null;
  window_start: number;
  window_end: number;
  topic: string;
  custom_subjects: string[];
  custom_messages: string[];
}

interface Overview {
  timezone: string;
  window: { start: number; end: number };
  ramp: { until_day: number; per_day: number }[];
  max_mailboxes: number;
  defaults: { smtp_host: string; smtp_port: number; imap_host: string; imap_port: number };
  summary: {
    mailboxes: number; active: number; paused: number; failing: number; sent_today: number; sent_7d: number; received_7d: number;
    inbox_rate_7d: number | null; spam_rate_7d: number | null; rescued_7d: number; inbox_7d: number; spam_7d: number; failed_7d: number;
  };
  mailboxes: MailboxRow[];
}

interface ActivityRow {
  id: string;
  direction: "in" | "out";
  other: string;
  kind: "initial" | "reply";
  subject: string;
  status: "scheduled" | "sent" | "failed";
  scheduled_at: string;
  sent_at: string | null;
  found_at: string | null;
  landed_in: "inbox" | "spam" | null;
  rescued: boolean;
  error: string | null;
}

const HEALTH: Record<Health, { label: string; tone: string; hint: string }> = {
  healthy: { label: "Healthy", tone: "tone-success", hint: "8 in 10 or more of its emails reach the inbox." },
  fair: { label: "Fair", tone: "tone-warning", hint: "Some of its emails land in spam. Keep warming up." },
  poor: { label: "Needs time", tone: "tone-danger", hint: "Most of its emails land in spam. Don't use it for clients yet." },
  starting: { label: "Starting", tone: "tone-info", hint: "Not enough emails yet to judge." },
  paused: { label: "Paused", tone: "tone-neutral", hint: "Not sending or answering." },
  error: { label: "Can't connect", tone: "tone-danger", hint: "" },
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const hour = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

/** Mailbox warm-up: the team's own mailboxes email each other, rescue each other from spam and reply */
export function MailboxesPage({ notify, confirm }: { notify: (msg: string, isError?: boolean) => void; confirm: (r: ConfirmRequest) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [passwordFor, setPasswordFor] = useState<MailboxRow | null>(null);
  const [tab, setTab] = useState<"analytics" | "settings" | "emails">("analytics");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "error">("all");

  const load = useCallback(async () => {
    const res = await callApi<Overview>("/mailboxes");
    setData(res.data);
    setError(res.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    const refresh = setInterval(load, 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(refresh);
    };
  }, [load]);

  const request = async (key: string, path: string, method: string, body?: object, done?: string) => {
    setBusy(key);
    try {
      const res = await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      const json = res.status === 204 ? {} : await res.json();
      if (!res.ok) {
        notify(errorMessage(json, "That didn't work. Please try again."), true);
        return null;
      }
      if (done) notify(done);
      await load();
      return json;
    } catch {
      notify(NETWORK_ERROR, true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <AlertCircle size={18} />
        <div>{error} <button className="link-btn" onClick={load}>Try again</button></div>
      </div>
    );
  }
  if (!data) return <div className="card empty"><div className="loader" /></div>;

  const shown = data.mailboxes.filter((m) => statusFilter === "all" || m.status === statusFilter);
  const picked = selected.filter((id) => data.mailboxes.some((m) => m.id === id));
  const allShown = shown.length > 0 && shown.every((m) => picked.includes(m.id));

  /** Bulk enable / pause: one mailbox after another, so a wrong login on one doesn't stop the others */
  const bulk = async (status: "active" | "paused") => {
    setBusy("bulk");
    let done = 0;
    const failed: string[] = [];
    for (const id of picked) {
      const mb = data.mailboxes.find((m) => m.id === id);
      if (!mb || mb.status === "error" || mb.status === status) continue;
      try {
        const res = await apiFetch(`/mailboxes/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
        if (res.ok) done += 1;
        else failed.push(mb.email);
      } catch {
        failed.push(mb.email);
      }
    }
    setBusy(null);
    setSelected([]);
    notify(
      failed.length ? `${done} updated. Couldn't change: ${failed.join(", ")}.` : done ? `Warm-up ${status === "active" ? "enabled" : "paused"} for ${done} mailbox${done === 1 ? "" : "es"}.` : "Nothing to change for the selected mailboxes.",
      failed.length > 0,
    );
    await load();
  };

  const openRow = data.mailboxes.find((m) => m.id === open) ?? null;
  const s = data.summary;
  const full = data.mailboxes.length >= data.max_mailboxes;
  const active = data.mailboxes.filter((m) => m.status === "active");
  const failing = data.mailboxes.filter((m) => m.status === "error");
  const allReady = active.length > 0 && active.every((m) => m.ready);
  const daysLeft = active.length ? Math.max(0, ...active.map((m) => (m.ready ? 0 : READY_DAY - m.warmup_day + 1))) : 0;
  const n = data.mailboxes.length;
  const status =
    n === 0 ? { tone: "info", title: "Let's start: add your company mailboxes", text: "Add two or more mailboxes (for example from Hostinger or Gmail). After that the warm-up runs on its own." }
    : n === 1 ? { tone: "info", title: "Add one more mailbox to start", text: "Warm-up works by your mailboxes emailing each other, so it needs at least two." }
    : failing.length ? { tone: "danger", title: `${failing.length} mailbox${failing.length === 1 ? " can't" : "es can't"} log in`, text: "Its password probably changed. Click \"Fix login\" next to it and enter the new password." }
    : !active.length ? { tone: "warning", title: "Warm-up is switched off", text: "Turn on the switch next to a mailbox." }
    : allReady ? { tone: "success", title: "Your mailboxes are ready for campaigns", text: "They have warmed up long enough and their emails reach the inbox. Keep the warm-up on while you send campaigns." }
    : { tone: "success", title: "Warm-up is running. You don't need to do anything.", text: `Your mailboxes email each other every day by themselves. They should be ready for campaigns in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` };

  return (
    <div className="lab-stack">
      <section className={`card wu-hero wu-hero--${status.tone}`} aria-label="Warm-up status">
        <div className="wu-hero-main">
          <h2>{status.title}</h2>
          <p>{status.text}</p>
          {s.inbox_7d + s.spam_7d > 0 && (
            <p className="wu-hero-week">This week: <strong>{s.sent_7d}</strong> warm-up emails sent, <strong>{pct(s.inbox_rate_7d)}</strong> reached the inbox.</p>
          )}
          {n < 2 && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add a mailbox</button>}
        </div>
        <ol className="wu-steps-simple">
          <li className={n >= 2 ? "done" : ""}><CheckCircle2 size={18} /><span><strong>Add 2 or more mailboxes</strong>Your company email addresses.</span></li>
          <li className={active.length >= 2 ? "done" : ""}><CheckCircle2 size={18} /><span><strong>Warm-up runs by itself</strong>Every day between {hour(data.window.start)} and {hour(data.window.end)}.</span></li>
          <li className={allReady ? "done" : ""}><CheckCircle2 size={18} /><span><strong>Wait about 2 weeks</strong>Until each mailbox shows &quot;Ready&quot;. Then send your campaigns.</span></li>
        </ol>
        <details className="wu-what">
          <summary>What is warm-up, and why do I need it?</summary>
          <p>
            A new email address that suddenly sends many emails looks like spam to Gmail and Outlook, so its emails land in the spam folder.
            Warm-up fixes that slowly: your mailboxes send each other a few ordinary emails every day, open them, reply and take them out of spam.
            After about two weeks Gmail and Outlook trust them, and your real campaigns reach the inbox.
          </p>
        </details>
      </section>

      <section className="stats stats--5" aria-label="Warm-up summary">
        <div className="stat stat--feature">
          <div className="stat-top">Email accounts<span className="stat-icon"><Mail size={17} /></span></div>
          <div className="stat-value">{s.active}<span className="stat-of"> of {s.mailboxes}</span></div>
          <div className="stat-foot">Warming up{s.paused ? ` · ${s.paused} paused` : ""}{s.failing ? ` · ${s.failing} can't connect` : ""}</div>
        </div>
        <div className="stat stat--info">
          <div className="stat-top">Warm-up emails<span className="stat-icon"><ArrowUpRight size={17} /></span></div>
          <div className="stat-value">{s.sent_today}<span className="stat-of"> today</span></div>
          <div className="stat-foot">{s.sent_7d} sent · {s.received_7d} received, last 7 days</div>
        </div>
        <div className="stat stat--success">
          <div className="stat-top">Inbox placement<span className="stat-icon"><Inbox size={17} /></span></div>
          <div className="stat-value">{pct(s.inbox_rate_7d)}</div>
          <div className="stat-foot">{s.inbox_7d + s.spam_7d ? `${s.inbox_7d} of ${s.inbox_7d + s.spam_7d} landed in inbox, 7 days` : "Shows once emails arrive"}</div>
        </div>
        <div className="stat stat--danger">
          <div className="stat-top">Spam placement<span className="stat-icon"><AlertCircle size={17} /></span></div>
          <div className="stat-value">{pct(s.spam_rate_7d)}</div>
          <div className="stat-foot">{s.inbox_7d + s.spam_7d ? `${s.spam_7d} landed in spam, 7 days` : "Shows once emails arrive"}</div>
        </div>
        <div className="stat stat--violet">
          <div className="stat-top">Saved from spam<span className="stat-icon"><ShieldCheck size={17} /></span></div>
          <div className="stat-value">{s.rescued_7d}</div>
          <div className="stat-foot">Moved to the inbox, 7 days</div>
        </div>
      </section>

      {s.failed_7d > 0 && (
        <div className="alert alert-warning" role="status">
          <AlertCircle size={18} />
          <div>
            <strong>{s.failed_7d} warm-up email{s.failed_7d === 1 ? "" : "s"} couldn&apos;t be sent in the last 7 days.</strong>{" "}
            Open the mailbox to see the error. A wrong password or a full daily sending limit at the provider are the usual causes.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Flame size={17} /> Your mailboxes</h2>
            <p className="card-sub">
              Click a mailbox to see its progress and settings. The switch turns its warm-up on (green) or off (grey).
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={full} title={full ? `You can add up to ${data.max_mailboxes} mailboxes` : undefined}>
            <Plus size={16} /> Add mailbox
          </button>
        </div>

        {data.mailboxes.length < 2 && (
          <div className="alert alert-info" style={{ marginBottom: "1rem" }}>
            <Inbox size={18} />
            <div>
              <strong>{data.mailboxes.length ? "Add one more mailbox to start." : "Add at least two mailboxes to start."}</strong>{" "}
              They warm up by writing to each other, so one on its own has no one to write to. Use your company mailboxes, for example from Hostinger.
            </div>
          </div>
        )}

        {data.mailboxes.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Mail size={24} /></div>
            <h3>No mailboxes yet</h3>
            <p>Add a mailbox with its email and password. We check the login before saving it, and the password is stored encrypted.</p>
            <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={15} /> Add your first mailbox</button>
          </div>
        ) : (
          <>
          <div className="wu-toolbar">
            <label className="wu-filter">
              <span className="sr-only">Filter by warm-up status</span>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">All statuses</option>
                <option value="active">Warming up</option>
                <option value="paused">Paused</option>
                <option value="error">Can&apos;t connect</option>
              </select>
            </label>
            {picked.length > 0 && (
              <div className="wu-bulk">
                <strong>{picked.length} selected</strong>
                <button className="btn btn-secondary btn-sm" disabled={busy === "bulk"} onClick={() => bulk("active")}>Bulk enable warm-up</button>
                <button className="btn btn-secondary btn-sm" disabled={busy === "bulk"} onClick={() => bulk("paused")}>Bulk pause warm-up</button>
                <button className="link-btn" onClick={() => setSelected([])}>Clear</button>
              </div>
            )}
          </div>
          <div className="wu-list">
            <div className="wu-row wu-head">
              <input type="checkbox" aria-label="Select all mailboxes" checked={allShown}
                onChange={() => setSelected(allShown ? [] : shown.map((m) => m.id))} />
              <span>Name</span>
              <span>Emails sent today</span>
              <span>Reaching inbox</span>
              <span>On / off</span>
            </div>
            {shown.map((m) => (
              <div
                key={m.id}
                className={`wu-row wu-acc${open === m.id ? " is-open" : ""}`}
                onClick={() => { setOpen(m.id); setTab("analytics"); }}
              >
                <input type="checkbox" aria-label={`Select ${m.email}`} checked={picked.includes(m.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => setSelected((sel) => (sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id]))} />
                <div className="mb-who">
                  <span className="mb-avatar" aria-hidden="true">{(m.display_name || m.email)[0].toUpperCase()}</span>
                  <div className="mb-who-text">
                    <button type="button" className="wu-acc-open truncate" onClick={(e) => { e.stopPropagation(); setOpen(m.id); setTab("analytics"); }}>
                      {m.email}
                    </button>
                    <span className="truncate">
                      {m.display_name || "—"}{m.last_activity_at ? ` · Last activity ${formatDateTime(m.last_activity_at)}` : " · No activity yet"}
                    </span>
                    <span className="wu-progress-row">
                      <span className="wu-progress" aria-hidden="true">
                        <i style={{ width: `${m.ready ? 100 : Math.min(100, (m.warmup_day / READY_DAY) * 100)}%` }} className={m.ready ? "done" : ""} />
                      </span>
                      <span className="wu-progress-text">
                        {m.ready ? "Ready for campaigns"
                          : m.status === "paused" ? `Paused on day ${m.warmup_day}`
                          : m.status === "error" ? "Can't log in"
                          : `Day ${m.warmup_day} of ${READY_DAY} · about ${Math.max(1, READY_DAY - m.warmup_day + 1)} days to go`}
                      </span>
                    </span>
                    {m.failed_7d > 0 && (
                      <span className="wu-acc-tags"><span className="pill tone-warning">{m.failed_7d} failed to send</span></span>
                    )}
                  </div>
                </div>
                <div><strong>{m.initial_today}</strong> <span className="mb-muted">sent · goal {m.target_today}</span>{m.sent_today > m.initial_today && <span className="mb-sub">+ {m.sent_today - m.initial_today} repl{m.sent_today - m.initial_today === 1 ? "y" : "ies"}</span>}</div>
                <div><span className={`wu-score wu-score--${m.health}`} title={HEALTH[m.health].hint}>{pct(m.inbox_rate_7d)}</span></div>
                <div>
                  {m.status === "error" ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setPasswordFor(m); }}>
                      <KeyRound size={14} /> Fix login
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.status === "active"}
                        aria-label={`Warm-up for ${m.email}`}
                        className={`wu-switch wu-switch--lg${m.status === "active" ? " on" : ""}`}
                        disabled={busy === m.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          request(m.id, `/mailboxes/${m.id}`, "PATCH", { status: m.status === "active" ? "paused" : "active" },
                            m.status === "active" ? `${m.email} paused. Its planned emails were cancelled.` : `${m.email} is warming up again.`);
                        }}
                      >
                        <span />
                      </button>
                      <span className="wu-switch-label">{busy === m.id ? "…" : m.status === "active" ? "On" : "Off"}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {shown.length === 0 && <p className="field-hint" style={{ padding: "0.8rem" }}>No mailboxes with this status.</p>}
          </>
        )}
      </div>

      {/* Manual chat is hidden: warm-up is fully automatic, like Instantly. ChatPanel and /chat stay in the code. */}
      <details className="wu-extra">
        <summary>Optional extra: let your mailboxes receive newsletters, like a real inbox</summary>
        <NewslettersPanel mailboxes={data.mailboxes} notify={notify} confirm={confirm} />
      </details>

      <details className="wu-extra">
        <summary>How the warm-up works, in detail</summary>
      <div className="card">
        <h2 className="card-title"><ShieldCheck size={17} /> How the warm-up works</h2>
        <ol className="mb-steps">
          {data.ramp.map((r, i) => (
            <li key={r.until_day}>
              <span>Days {i === 0 ? 1 : data.ramp[i - 1].until_day + 1}–{r.until_day}</span>
              <strong>{r.per_day}<em>/day</em></strong>
            </li>
          ))}
          <li>
            <span>After day {data.ramp[data.ramp.length - 1].until_day}</span>
            <strong>Its limit<em> (up to 50)</em></strong>
          </li>
        </ol>
        <ul className="mb-tips">
          <li>Emails go out at random times between {hour(data.window.start)} and {hour(data.window.end)} ({data.timezone}), and read like ordinary work emails.</li>
          <li>Every few minutes each mailbox is checked. Warm-up emails in Spam are moved to the Inbox, marked read, sometimes starred, and about half get a reply.</li>
          <li>When a mailbox shows <strong>Healthy</strong> for a week, it&apos;s ready to email clients.</li>
          <li>If a login stops working, that mailbox pauses itself and shows <strong>Can&apos;t connect</strong>.</li>
        </ul>
      </div>
      </details>

      {/* Mounted only while open, so each opening starts with an empty form and nothing later (saving, the
          minute refresh) clears what was typed */}
      {adding && (
        <MailboxDialog
          open
          defaults={data.defaults}
          onClose={() => setAdding(false)}
          onSave={async (body) => {
            const ok = await request("add", "/mailboxes", "POST", body, `${body.email} added. Its warm-up starts with the next plan, within a few minutes.`);
            if (ok) setAdding(false);
          }}
          saving={busy === "add"}
        />
      )}
      {openRow && (
        <WarmupPanel
          key={openRow.id}
          mailbox={openRow}
          tab={tab}
          setTab={setTab}
          busy={busy}
          onClose={() => setOpen(null)}
          onStatus={(status) => request(openRow.id, `/mailboxes/${openRow.id}`, "PATCH", { status },
            status === "paused" ? `${openRow.email} paused. Its planned emails were cancelled.` : `${openRow.email} is warming up again.`)}
          onFixLogin={() => setPasswordFor(openRow)}
          onSave={async (body, applyAll) => {
            const saved = await request("settings", `/mailboxes/${openRow.id}`, "PATCH", body, applyAll ? undefined : `Warm-up settings of ${openRow.email} saved.`);
            if (!saved || !applyAll) return saved;
            const adv = (body as { warmup_settings: Advanced }).warmup_settings;
            const content = { topic: adv.topic, custom_subjects: adv.custom_subjects, custom_messages: adv.custom_messages };
            const others = data.mailboxes.filter((m) => m.id !== openRow.id);
            const results = await Promise.all(others.map((m) =>
              apiFetch(`/mailboxes/${m.id}`, { method: "PATCH", body: JSON.stringify({ warmup_settings: content }) }).then((r) => r.ok).catch(() => false)));
            const failed = results.filter((ok) => !ok).length;
            notify(failed ? `Saved, but ${failed} other mailbox${failed === 1 ? "" : "es"} couldn't be updated.` : `Saved. All ${others.length + 1} mailboxes now use this email content.`, failed > 0);
            await load();
            return saved;
          }}
          onSendTest={async () => {
            const sent = await request("sendtest", `/mailboxes/${openRow.id}/send-test`, "POST");
            if (!sent) return;
            notify(`Test email "${sent.subject}" is going to ${sent.to}. Within about 2 minutes it shows here as Inbox or Spam.`);
            // it goes out within 30 s and the other inbox is read about a minute later
            setTimeout(load, 70_000);
            setTimeout(load, 130_000);
          }}
          onTest={() => request(`test-${openRow.id}`, `/mailboxes/${openRow.id}/test`, "POST", undefined, `${openRow.email} can log in to send and read.`)}
          onRemove={() => confirm({
            title: `Remove ${openRow.email}?`,
            message: "Its warm-up stops and its history is deleted. The mailbox itself and its emails are not touched.",
            confirmLabel: "Remove mailbox",
            danger: true,
            onConfirm: async () => {
              await request(`del-${openRow.id}`, `/mailboxes/${openRow.id}`, "DELETE", undefined, `${openRow.email} removed.`);
              setOpen(null);
            },
          })}
        />
      )}
      {passwordFor && (
        <PasswordDialog
          key={passwordFor.id}
          mailbox={passwordFor}
          onClose={() => setPasswordFor(null)}
          saving={busy === "pw"}
          onSave={async (password) => {
            const ok = await request("pw", `/mailboxes/${passwordFor.id}`, "PATCH", { password }, `${passwordFor.email} is connected again.`);
            if (ok) setPasswordFor(null);
          }}
        />
      )}
    </div>
  );
}

interface DomainResult { domain: string; spf: boolean; dkim: boolean; dkim_selector: string | null; dmarc: boolean; dmarc_policy: string | null }

/** SPF / DKIM / DMARC of the mailbox's domain: missing records are a common reason mail lands in spam */
function DomainCheck({ mailboxId }: { mailboxId: string }) {
  const [res, setRes] = useState<DomainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await callApi<DomainResult>(`/mailboxes/${mailboxId}/domain-check`);
    setRes(r.data);
    setError(r.error);
    setBusy(false);
  };
  const row = (ok: boolean, label: string, fix: string) => (
    <li key={label} style={{ color: ok ? "var(--success)" : "var(--danger, #b42318)" }}>
      <strong>{ok ? "✓" : "✗"} {label}</strong> <span className="mb-muted">{ok ? "found" : fix}</span>
    </li>
  );
  return (
    <div style={{ marginBottom: "0.8rem" }}>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={run}>
        <ShieldCheck size={14} /> {busy ? "Checking…" : "Check domain setup (SPF, DKIM, DMARC)"}
      </button>
      {error && <p className="field-hint" role="alert">{error}</p>}
      {res && (
        <ul className="mb-tips" style={{ marginTop: "0.5rem" }}>
          {row(res.spf, `SPF for ${res.domain}`, "missing: add it in your domain's DNS (Hostinger shows the exact record).")}
          {row(res.dkim, "DKIM", "not found under the usual names. Check Hostinger's email settings; it may use another name.")}
          {row(res.dmarc, "DMARC", `missing: add a TXT record at _dmarc.${res.domain} such as v=DMARC1; p=none`)}
        </ul>
      )}
    </div>
  );
}

function Activity({ mailboxId }: { mailboxId: string }) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    callApi<ActivityRow[]>(`/mailboxes/${mailboxId}/activity`).then((res) => {
      if (!live) return;
      setRows(res.data);
      setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [mailboxId]);

  if (error) return <p className="field-hint">{error}</p>;
  if (!rows) return <div className="loader" />;
  if (!rows.length) return <p className="field-hint">No warm-up emails yet. The first ones are planned within a few minutes during office hours.</p>;
  return (
    <ul className="mb-activity">
      {rows.map((r) => (
        <li key={r.id}>
          <span className={`mb-dir ${r.direction}`} aria-label={r.direction === "out" ? "Sent" : "Received"}>
            {r.direction === "out" ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
          </span>
          <div className="mb-activity-main">
            <strong className="truncate">{r.subject}</strong>
            <span className="truncate">{r.direction === "out" ? "To" : "From"} {r.other}{r.kind === "reply" ? " · reply" : ""}</span>
          </div>
          <span className="mb-activity-state">
            {r.status === "scheduled" ? (
              <span className="pill no-dot tone-neutral">Planned {formatDateTime(r.scheduled_at)}</span>
            ) : r.status === "failed" ? (
              <span className="pill no-dot tone-danger" title={r.error ?? ""}>Failed</span>
            ) : r.landed_in === "spam" ? (
              <span className="pill no-dot tone-warning">{r.rescued ? "Spam → moved to inbox" : "Landed in spam"}</span>
            ) : r.landed_in === "inbox" ? (
              <span className="pill no-dot tone-success">Inbox</span>
            ) : (
              <span className="pill no-dot tone-info">Sent {r.sent_at ? formatDateTime(r.sent_at) : ""}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface MailboxBody {
  email: string;
  password: string;
  display_name?: string;
  daily_limit: number;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  username?: string;
}

function MailboxDialog({
  open, defaults, onClose, onSave, saving,
}: {
  open: boolean;
  defaults: Overview["defaults"];
  onClose: () => void;
  onSave: (body: MailboxBody) => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The form starts empty once, when the dialog opens (it is mounted only while open). Resetting it in an effect
  // cleared what was typed as soon as Save was pressed, since `saving` and `onClose` change on every render.
  const [form, setForm] = useState(() => ({ email: "", password: "", display_name: "", daily_limit: 30, username: "", ...defaults }));
  const [provider, setProvider] = useState<"hostinger" | "gmail" | "other">("hostinger");
  const pickProvider = (p: "hostinger" | "gmail" | "other") => {
    setProvider(p);
    if (p === "hostinger") setForm((f) => ({ ...f, ...defaults }));
    if (p === "gmail") setForm((f) => ({ ...f, smtp_host: "smtp.gmail.com", smtp_port: 465, imap_host: "imap.gmail.com", imap_port: 993 }));
    if (p === "other") setForm((f) => ({ ...f, smtp_host: "", imap_host: "" }));
  };
  useDialogFocus(ref, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) return null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));

  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div ref={ref} className="dialog write-email" role="dialog" aria-modal="true" aria-labelledby="add-mailbox-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="add-mailbox-title">Add a mailbox</h3>
        <p>We log in to check it works before saving. The password is stored encrypted.</p>
        <div className="field">
          <span className="field-label">Where is this mailbox?</span>
          <div className="segmented wu-providers" role="radiogroup" aria-label="Email provider">
            {([["hostinger", "Hostinger"], ["gmail", "Gmail / Google Workspace"], ["other", "Other"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={provider === id} className={provider === id ? "active" : ""} onClick={() => pickProvider(id)}>{label}</button>
            ))}
          </div>
        </div>
        {provider === "gmail" && (
          <div className="alert alert-info" style={{ margin: "0 0 0.8rem" }}>
            <AlertCircle size={18} />
            <div>
              <strong>Gmail needs an &quot;app password&quot;, not your normal password:</strong>
              <ol className="wu-gmail-steps">
                <li>Turn on 2-Step Verification in your Google account.</li>
                <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>, create one and copy the 16 letters.</li>
                <li>In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP.</li>
              </ol>
            </div>
          </div>
        )}
        {provider === "other" && (
          <p className="field-hint">Open &quot;Server settings&quot; below and type the servers your email provider gives you.</p>
        )}
        <form
          className="write-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ ...form, email: form.email.trim(), display_name: form.display_name.trim() || undefined, username: form.username.trim() || undefined });
          }}
        >
          <label className="field">
            <span className="field-label">Email address</span>
            <input className="input" type="email" required value={form.email} onChange={set("email")} placeholder="ali@arvistry.com" autoComplete="off" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input className="input" type="password" required value={form.password} onChange={set("password")} autoComplete="new-password" />
            <span className="field-hint">{provider === "gmail" ? "The 16-letter app password from Google." : provider === "hostinger" ? "The password you use to log in to Hostinger Mail." : "The mailbox's own password."}</span>
          </label>
          <label className="field">
            <span className="field-label">Your name <span className="mb-muted">(optional, shown in the emails)</span></span>
            <input className="input" value={form.display_name} onChange={set("display_name")} placeholder="Ali Khan" maxLength={80} />
          </label>
          <details className="mb-servers" open={provider === "other"}>
            <summary>Server settings <span className="mb-muted">({provider === "other" ? "fill these in" : "already filled in"})</span></summary>
            <label className="field">
              <span className="field-label">Most warm-up emails a day</span>
              <input className="input" type="number" min={2} max={50} required value={form.daily_limit} onChange={set("daily_limit")} />
            </label>
            <div className="grid-2">
              <label className="field">
                <span className="field-label">Sending server (SMTP)</span>
                <input className="input" required value={form.smtp_host} onChange={set("smtp_host")} />
              </label>
              <label className="field">
                <span className="field-label">Port</span>
                <input className="input" type="number" required value={form.smtp_port} onChange={set("smtp_port")} />
              </label>
              <label className="field">
                <span className="field-label">Inbox server (IMAP)</span>
                <input className="input" required value={form.imap_host} onChange={set("imap_host")} />
              </label>
              <label className="field">
                <span className="field-label">Port</span>
                <input className="input" type="number" required value={form.imap_port} onChange={set("imap_port")} />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Login name <span className="mb-muted">(if not the email address)</span></span>
              <input className="input" value={form.username} onChange={set("username")} autoComplete="off" />
            </label>
          </details>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}>
              <Plus size={15} /> {saving ? "Checking the login…" : "Add mailbox"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordDialog({
  mailbox, onClose, onSave, saving,
}: {
  mailbox: MailboxRow | null;
  onClose: () => void;
  onSave: (password: string) => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Starts empty when the dialog opens (mounted per mailbox); not reset again while saving
  const [password, setPassword] = useState("");
  useDialogFocus(ref, !!mailbox);

  useEffect(() => {
    if (!mailbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mailbox, onClose, saving]);

  if (!mailbox) return null;
  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="fix-login-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="fix-login-title">Fix the login for {mailbox.email}</h3>
        <p>{mailbox.last_error || "We couldn't log in to this mailbox."} If its password was changed, enter the new one.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(password);
          }}
        >
          <label className="field">
            <span className="field-label">Password</span>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !password}>{saving ? "Checking…" : "Save and reconnect"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


/** Common timezones for the sending window; the server accepts any IANA name */
const TIMEZONES = [
  "Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Asia/Riyadh", "Asia/Singapore", "Europe/London", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "Australia/Sydney", "UTC",
];
const weekday = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });

/** Side panel of one mailbox, like Instantly's: analytics for the past week, its settings, its latest emails */
function WarmupPanel({
  mailbox: m, tab, setTab, busy, onClose, onStatus, onFixLogin, onSave, onSendTest, onTest, onRemove,
}: {
  mailbox: MailboxRow;
  tab: "analytics" | "settings" | "emails";
  setTab: (t: "analytics" | "settings" | "emails") => void;
  busy: string | null;
  onClose: () => void;
  onStatus: (status: "active" | "paused") => void;
  onFixLogin: () => void;
  onSave: (body: object, applyAll?: boolean) => Promise<unknown>;
  onSendTest: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const started = new Date(`${m.warmup_started_on}T12:00:00`);
  const days = m.warmup_day - 1; // the server counts warm-up days in its own timezone
  const [range, setRange] = useState<7 | 30>(7);
  const week = m.series.slice(-range);
  const top = Math.max(1, ...week.map((d) => d.sent));
  const landed = m.inbox_7d + m.spam_7d;
  const tone = m.health === "healthy" ? "good" : m.health === "fair" ? "fair" : m.health === "poor" ? "poor" : "none";

  return (
    <div className="wu-drawer-backdrop" onClick={onClose}>
      <aside ref={ref} className="wu-drawer" role="dialog" aria-modal="true" aria-labelledby="wu-drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="wu-drawer-head">
          <div className="wu-started">
            <Smile size={20} className={`wu-face wu-face--${tone}`} />
            <div>
              <strong id="wu-drawer-title" className="truncate">{m.email}</strong>
              <span>Started on {started.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} | {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}</span>
              <span>
                Sends {hour(m.warmup_settings.window_start)}–{hour(m.warmup_settings.window_end)} {m.warmup_settings.timezone || "(server time)"}
                {m.warmup_settings.slow_ramp ? "" : " · no slow ramp"}{m.warmup_weekdays_only ? " · weekdays only" : ""}
              </span>
            </div>
          </div>
          <div className="wu-onoff">
            {m.status === "error" ? (
              <button className="btn btn-secondary btn-sm" onClick={onFixLogin}><KeyRound size={14} /> Fix login</button>
            ) : (
              <>
                <button className={`btn btn-sm ${m.status === "paused" ? "btn-danger-soft is-on" : "btn-secondary"}`} disabled={busy === m.id || m.status === "paused"} onClick={() => onStatus("paused")}>Disable</button>
                <button className={`btn btn-sm ${m.status === "active" ? "btn-success is-on" : "btn-secondary"}`} disabled={busy === m.id || m.status === "active"} onClick={() => onStatus("active")}>Enable</button>
              </>
            )}
            <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="segmented wu-tabs" role="tablist">
          {(["analytics", "settings", "emails"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "analytics" ? "Progress" : t === "settings" ? "Settings" : "Emails & checks"}
            </button>
          ))}
        </div>

        {tab === "analytics" && (
          <div className="wu-drawer-body">
            {m.status === "error" && m.last_error && <div className="alert alert-danger"><AlertCircle size={18} /><div>{m.last_error}</div></div>}
            <div className="wu-test">
              <div>
                <strong>Try it now</strong>
                <span>Send one warm-up email straight away, at any time of day, and see where it lands.</span>
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy === "sendtest" || m.status !== "active"} onClick={onSendTest}
                title={m.status !== "active" ? "Turn the warm-up on first" : undefined}>
                <Send size={14} /> {busy === "sendtest" ? "Sending…" : "Send a test email now"}
              </button>
            </div>
            <div className={`wu-banner wu-banner--${tone}`}>
              <Smile size={34} />
              <span>
                {landed ? <><strong>{pct(m.inbox_rate_7d)}</strong> of your warm-up emails landed in inbox</> : "No results yet: the first warm-up emails are on their way"}
              </span>
            </div>
            <div className="wu-tiles">
              <div className="wu-tile"><span className="wu-tile-icon wu-blue"><Send size={18} /></span><div><em>Warm-up emails sent</em><strong>{m.sent_7d}</strong></div></div>
              <div className="wu-tile"><span className="wu-tile-icon wu-green"><Inbox size={18} /></span><div><em>Landed in inbox</em><strong>{m.inbox_7d}</strong></div></div>
              <div className="wu-tile"><span className="wu-tile-icon wu-violet"><ShieldCheck size={18} /></span><div><em>Saved from spam</em><strong>{m.rescued_7d}</strong></div></div>
              <div className="wu-tile"><span className="wu-tile-icon wu-red"><ArrowDownLeft size={18} /></span><div><em>Warm-up received</em><strong>{m.received_7d}</strong></div></div>
            </div>
            <p className="field-hint">
              Summary for the past week. Today: {m.initial_today} new emails sent (daily goal {m.target_today}, test emails come on top){m.sent_today > m.initial_today ? ` plus ${m.sent_today - m.initial_today} replies` : ""}, {m.scheduled_today} still to go.
              {m.last_activity_at ? ` Last activity ${formatDateTime(m.last_activity_at)}.` : ""}
            </p>
            {m.failed_7d > 0 && (
              <div className="alert alert-warning" role="status">
                <AlertCircle size={18} />
                <div>
                  <strong>{m.failed_7d} email{m.failed_7d === 1 ? "" : "s"} failed to send in the last 7 days.</strong>
                  {m.last_failure && <> Latest ({formatDateTime(m.last_failure.at)}): <code className="wu-err">{m.last_failure.error.replace(/^\[try \d+\]\s*/, "")}</code></>}
                </div>
              </div>
            )}
            <div className="card wu-chart-card">
              <div className="wu-chart-head">
                <h3>Warm-up emails sent</h3>
                <div className="segmented" role="group" aria-label="Chart range">
                  {([7, 30] as const).map((r) => (
                    <button key={r} type="button" className={range === r ? "active" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>{r} days</button>
                  ))}
                </div>
              </div>
              <div className={`wu-chart${range === 30 ? " wu-chart--30" : ""}`} role="img" aria-label={`Warm-up emails sent per day, last ${range} days`}>
                {week.map((d) => (
                  <div key={d.date} className="wu-chart-col" title={`${d.date}: ${d.sent} sent, ${d.inbox} inbox, ${d.spam} spam`}>
                    <span className="wu-chart-num">{d.sent || ""}</span>
                    <div className="wu-chart-bar" style={{ height: `${(d.sent / top) * 100}%` }}>
                      <i className="wu-chart-spam" style={{ height: d.sent ? `${(d.spam / d.sent) * 100}%` : 0 }} />
                    </div>
                    <span className="wu-chart-day">{range === 7 ? weekday(d.date) : Number(d.date.slice(8))}</span>
                  </div>
                ))}
              </div>
              <p className="field-hint"><span className="wu-key wu-key--inbox" /> Inbox <span className="wu-key wu-key--spam" /> Spam</p>
            </div>
          </div>
        )}

        {tab === "settings" && <WarmupSettings mailbox={m} saving={busy === "settings"} onSave={onSave} />}

        {tab === "emails" && (
          <div className="wu-drawer-body">
            <div className="wu-row-actions">
              <button className="btn btn-secondary btn-sm" disabled={busy === `test-${m.id}`} onClick={onTest}>
                <RefreshCw size={14} className={busy === `test-${m.id}` ? "spin" : ""} /> Check the login
              </button>
              <button className="btn btn-secondary btn-sm danger-text" onClick={onRemove}><Trash2 size={14} /> Remove mailbox</button>
            </div>
            <DomainCheck mailboxId={m.id} />
            <h3 className="wu-sub-title">Latest warm-up emails</h3>
            <Activity mailboxId={m.id} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`wu-switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** Instantly's warm-up settings: basic (ramp, limit, reply rate) and advanced (human-like behaviour) */
/** A mailbox counts as ready for campaigns after this many healthy warm-up days (server: READY_DAY) */
const READY_DAY = 14;

/** Simple speed choices (Instantly's suggestion for new mailboxes is 1 more a day, up to 10, 30% replies) */
const SPEEDS = [
  { id: "slow", label: "Slow & safe", hint: "Best for new mailboxes. 1 email on day one, up to 10 a day.", increase: 1, limit: 10, reply: 30 },
  { id: "normal", label: "Normal", hint: "Up to 20 a day.", increase: 2, limit: 20, reply: 30 },
  { id: "fast", label: "Fast", hint: "Only for mailboxes that already send email. Up to 40 a day.", increase: 4, limit: 40, reply: 30 },
];

/** What warm-up emails can be about (same ids as the server's warmup_content.TOPICS) */
const CONTENT_TOPICS = [
  { id: "architecture", label: "Architecture & design" },
  { id: "general", label: "General business / office" },
  { id: "construction", label: "Construction & contracting" },
  { id: "real_estate", label: "Real estate" },
  { id: "marketing", label: "Marketing agency" },
  { id: "software", label: "Software / IT" },
  { id: "finance", label: "Accounting / finance" },
  { id: "custom", label: "Only my own subjects and messages" },
];
const MESSAGE_SEPARATOR = "---";

function WarmupSettings({ mailbox: m, saving, onSave }: { mailbox: MailboxRow; saving: boolean; onSave: (body: object, applyAll?: boolean) => Promise<unknown> }) {
  const [increase, setIncrease] = useState(String(m.warmup_increase ?? 1));
  const [limit, setLimit] = useState(String(m.daily_limit));
  const [reply, setReply] = useState(String(m.warmup_reply_rate ?? 30));
  const [weekdays, setWeekdays] = useState(m.warmup_weekdays_only);
  const [adv, setAdv] = useState<Advanced>(m.warmup_settings);
  const [subjectsText, setSubjectsText] = useState((m.warmup_settings.custom_subjects ?? []).join("\n"));
  const [messagesText, setMessagesText] = useState((m.warmup_settings.custom_messages ?? []).join(`\n${MESSAGE_SEPARATOR}\n`));
  const [applyAll, setApplyAll] = useState(false);
  const [samples, setSamples] = useState<{ subject: string; body: string }[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const ownSubjects = subjectsText.split("\n").map((x) => x.trim()).filter(Boolean);
  const ownMessages = messagesText.split(new RegExp(`^\\s*${MESSAGE_SEPARATOR}\\s*$`, "m")).map((x) => x.trim()).filter(Boolean);
  const contentOk = ownSubjects.length <= 50 && ownSubjects.every((x) => x.length <= 150) && ownMessages.length <= 30 && ownMessages.every((x) => x.length <= 2000)
    && (adv.topic !== "custom" || ownSubjects.length > 0 || ownMessages.length > 0);
  const preview = async () => {
    setPreviewing(true);
    const res = await callApi<{ subject: string; body: string }[]>("/mailboxes/content-preview",
      { mailbox_id: m.id, topic: adv.topic, custom_subjects: ownSubjects, custom_messages: ownMessages });
    setSamples(res.data ?? []);
    setPreviewing(false);
  };
  const set = <K extends keyof Advanced>(k: K, v: Advanced[K]) => setAdv((a) => ({ ...a, [k]: v }));
  // "Server time" is sent as an empty timezone, which clears one chosen before
  const toSave = (a: Advanced) => ({ ...a, timezone: a.timezone || "", custom_subjects: ownSubjects, custom_messages: ownMessages });

  const inc = Number(increase), lim = Number(limit), rep = Number(reply);
  const pctOk = (v: number) => Number.isInteger(v) && v >= 0 && v <= 100;
  const valid = Number.isInteger(inc) && inc >= 1 && inc <= 10 && Number.isInteger(lim) && lim >= 2 && lim <= 50 && pctOk(rep)
    && pctOk(adv.open_rate) && pctOk(adv.spam_protection) && pctOk(adv.important_rate) && adv.window_start !== adv.window_end && contentOk;
  const reach = valid ? Math.ceil((lim - 1) / inc) + 1 : 0;
  const percent = (k: "open_rate" | "spam_protection" | "important_rate") => (
    <input className="input wu-pct" type="number" min={0} max={100} value={adv[k]} onChange={(e) => set(k, Number(e.target.value))} aria-label={k} />
  );

  return (
    <form className="wu-drawer-body" onSubmit={(e) => {
      e.preventDefault();
      if (valid) onSave({ warmup_increase: inc, daily_limit: lim, warmup_reply_rate: rep, warmup_weekdays_only: weekdays, warmup_settings: toSave(adv) }, applyAll);
    }}>
      <h3 className="wu-sub-title">How fast should it warm up?</h3>
      <div className="wu-speeds" role="radiogroup" aria-label="Warm-up speed">
        {SPEEDS.map((sp) => {
          const on = inc === sp.increase && lim === sp.limit && rep === sp.reply;
          return (
            <button key={sp.id} type="button" role="radio" aria-checked={on} className={`wu-speed${on ? " on" : ""}`}
              onClick={() => { setIncrease(String(sp.increase)); setLimit(String(sp.limit)); setReply(String(sp.reply)); }}>
              <strong>{sp.label}</strong>
              <span>{sp.hint}</span>
            </button>
          );
        })}
      </div>
      {!SPEEDS.some((sp) => inc === sp.increase && lim === sp.limit && rep === sp.reply) && (
        <p className="field-hint">Custom speed: {inc} more a day, up to {lim} a day. Pick one above to reset.</p>
      )}

      <h3 className="wu-sub-title">What should the emails be about?</h3>
      <p className="field-hint" style={{ marginTop: "-0.3rem" }}>
        What the warm-up emails talk about. Every email is put together on its own from the topic and your lines, with a greeting and sign-off, so no two are the same.
      </p>
      <label className="field">
        <span className="field-label">Topic</span>
        <select className="input" value={adv.topic || "architecture"} onChange={(e) => { set("topic", e.target.value); setSamples(null); }}>
          {CONTENT_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span className="field-hint">Pick the one closest to your business, so the warm-up reads like your real mail.</span>
      </label>
      <label className="field">
        <span className="field-label">Your own subject lines <em className="mb-muted">(optional, one per line)</em></span>
        <textarea className="input" rows={3} value={subjectsText} onChange={(e) => { setSubjectsText(e.target.value); setSamples(null); }}
          placeholder={"Kitchen drawings for review\nSite visit on Friday"} />
      </label>
      <label className="field">
        <span className="field-label">Your own messages <em className="mb-muted">(optional, put a line with --- between messages)</em></span>
        <textarea className="input" rows={5} value={messagesText} onChange={(e) => { setMessagesText(e.target.value); setSamples(null); }}
          placeholder={"The 3D views for the client are ready. Can you check them before Friday?\n---\nI've updated the material list with the new tile prices."} />
        <span className="field-hint">
          Write only the message: the greeting (Hi …,) and sign-off are added. Use {"{first_name}"} for the other person&apos;s name.
          {ownSubjects.length || ownMessages.length ? ` ${ownSubjects.length} subject${ownSubjects.length === 1 ? "" : "s"}, ${ownMessages.length} message${ownMessages.length === 1 ? "" : "s"}.` : ""}
          {adv.topic !== "custom" && (ownSubjects.length || ownMessages.length) ? " About 6 in 10 emails use your lines, the rest come from the topic." : ""}
        </span>
      </label>
      {adv.topic === "custom" && !ownSubjects.length && !ownMessages.length && (
        <p className="cell-error" role="alert">Add at least one subject or message, or pick a topic.</p>
      )}
      <div className="wu-preview-bar">
        <button type="button" className="btn btn-secondary btn-sm" disabled={previewing || !contentOk} onClick={preview}>
          {previewing ? "Writing samples…" : samples ? "Show 3 more samples" : "Preview 3 sample emails"}
        </button>
        <label className="chat-pick-row">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
          <span>Use this email content for all my mailboxes</span>
        </label>
      </div>
      {samples && (
        <div className="wu-samples">
          {samples.map((x, i) => (
            <div key={i} className="wu-sample">
              <strong>{x.subject}</strong>
              <pre>{x.body}</pre>
            </div>
          ))}
        </div>
      )}

      <details className="wu-more">
        <summary>More settings (optional)</summary>
      <h3 className="wu-sub-title">Warm-up settings</h3>
      <div className="wu-set-grid">
        <label className="field">
          <span className="field-label">Increase per day</span>
          <input className="input" type="number" min={1} max={10} value={increase} onChange={(e) => setIncrease(e.target.value)} />
          <span className="field-hint">Suggested: 1</span>
        </label>
        <label className="field">
          <span className="field-label">Daily warm-up limit</span>
          <input className="input" type="number" min={2} max={50} value={limit} onChange={(e) => setLimit(e.target.value)} />
          <span className="field-hint">Suggested: 10{valid && adv.slow_ramp ? `. Reached on day ${reach}` : ""}</span>
        </label>
        <label className="field">
          <span className="field-label">Reply rate %</span>
          <input className="input" type="number" min={0} max={100} value={reply} onChange={(e) => setReply(e.target.value)} />
          <span className="field-hint">Suggested: 30</span>
        </label>
      </div>
      <div className="wu-set-grid">
        <label className="field">
          <span className="field-label">Send from</span>
          <select className="input" value={adv.window_start} onChange={(e) => set("window_start", Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Until</span>
          <select className="input" value={adv.window_end} onChange={(e) => set("window_end", Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h === 24 ? "Midnight" : `${hour(h)}${h <= adv.window_start ? " (next day)" : ""}`}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Timezone</span>
          <select className="input" value={adv.timezone || ""} onChange={(e) => set("timezone", e.target.value || null)}>
            <option value="">Server time (default)</option>
            {TIMEZONES.concat(adv.timezone && !TIMEZONES.includes(adv.timezone) ? [adv.timezone] : []).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>
      {adv.window_start === adv.window_end && <p className="cell-error" role="alert">&quot;Send from&quot; and &quot;Until&quot; can&apos;t be the same hour.</p>}
      {adv.window_start > adv.window_end && <p className="field-hint">Runs overnight: from {hour(adv.window_start)} until {hour(adv.window_end)} the next morning.</p>}
      <div className="wu-set-row">
        <div><strong>Slow ramp</strong><span>Start with 1 email and add the increase each day. Turn off only for mailboxes that are already warm.</span></div>
        <Toggle on={adv.slow_ramp} onChange={(v) => set("slow_ramp", v)} label="Slow ramp" />
      </div>
      <div className="wu-set-row">
        <div><strong>Weekdays only</strong><span>No warm-up emails on Saturday and Sunday. It still receives and answers on weekends.</span></div>
        <Toggle on={weekdays} onChange={setWeekdays} label="Weekdays only" />
      </div>

      <h3 className="wu-sub-title">Advanced warm-up settings</h3>
      <p className="field-hint" style={{ marginTop: "-0.3rem" }}>Make the warm-up behave more like a person.</p>
      <div className="wu-set-row">
        <div><strong>Read emulation</strong><span>Open each warm-up email in full before marking it read, like a mail app does.</span></div>
        <Toggle on={adv.read_emulation} onChange={(v) => set("read_emulation", v)} label="Read emulation" />
      </div>
      <div className="wu-set-row">
        <div><strong>Random number each day</strong><span>Send a random number of warm-up emails each day (60–100% of the day&apos;s amount).</span></div>
        <Toggle on={adv.random_daily} onChange={(v) => set("random_daily", v)} label="Random number each day" />
      </div>
      <div className="wu-set-row">
        <div><strong>Open rate</strong><span>% of the warm-up emails it receives that it opens.</span></div>
        {percent("open_rate")}
      </div>
      <div className="wu-set-row">
        <div><strong>Spam protection</strong><span>% of warm-up emails found in spam that it moves to the inbox.</span></div>
        {percent("spam_protection")}
      </div>
      <div className="wu-set-row">
        <div><strong>Mark important</strong><span>% of the warm-up emails it receives that it marks important (starred).</span></div>
        {percent("important_rate")}
      </div>
      </details>
      <div className="dialog-actions">
        <button className="btn btn-primary" disabled={saving || !valid}>{saving ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}
