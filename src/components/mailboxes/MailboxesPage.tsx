"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownLeft, Settings, ArrowUpRight, ChevronDown, Flame, Inbox, KeyRound, Mail, Plus, RefreshCw, ShieldCheck, Trash2,
} from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { callApi } from "@/lib/insights";
import type { ConfirmRequest } from "@/components/dashboard/ConfirmDialog";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";
import { ChatPanel } from "./ChatPanel";
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
  warmup_day: number;
  target_today: number;
  sent_today: number;
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

interface Overview {
  timezone: string;
  window: { start: number; end: number };
  ramp: { until_day: number; per_day: number }[];
  max_mailboxes: number;
  defaults: { smtp_host: string; smtp_port: number; imap_host: string; imap_port: number };
  summary: { mailboxes: number; active: number; sent_today: number; inbox_rate_7d: number | null; rescued_7d: number; inbox_7d: number; spam_7d: number };
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
  const [settingsFor, setSettingsFor] = useState<MailboxRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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

  const s = data.summary;
  const full = data.mailboxes.length >= data.max_mailboxes;
  return (
    <div className="lab-stack">
      <section className="stats" aria-label="Warm-up summary">
        <div className="stat stat--feature">
          <div className="stat-top">Mailboxes<span className="stat-icon"><Mail size={17} /></span></div>
          <div className="stat-value">{s.active}<span className="stat-of"> of {s.mailboxes}</span></div>
          <div className="stat-foot">Warming up now</div>
        </div>
        <div className="stat stat--info">
          <div className="stat-top">Sent today<span className="stat-icon"><ArrowUpRight size={17} /></span></div>
          <div className="stat-value">{s.sent_today}</div>
          <div className="stat-foot">Between your mailboxes, {hour(data.window.start)}–{hour(data.window.end)}</div>
        </div>
        <div className="stat stat--success">
          <div className="stat-top">Landed in inbox<span className="stat-icon"><Inbox size={17} /></span></div>
          <div className="stat-value">{pct(s.inbox_rate_7d)}</div>
          <div className="stat-foot">{s.inbox_7d + s.spam_7d ? `${s.inbox_7d} of ${s.inbox_7d + s.spam_7d} emails, last 7 days` : "Shows once emails arrive"}</div>
        </div>
        <div className="stat stat--violet">
          <div className="stat-top">Saved from spam<span className="stat-icon"><ShieldCheck size={17} /></span></div>
          <div className="stat-value">{s.rescued_7d}</div>
          <div className="stat-foot">Rescued from the spam folder, last 7 days</div>
        </div>
      </section>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Flame size={17} /> Your mailboxes</h2>
            <p className="card-sub">
              Warm-up is automatic: they email each other, open each other&apos;s mail, save it from spam and reply. Use the gear to set how fast each one builds up.
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
          <div className="table-wrap">
            <table className="table mb-table">
              <thead>
                <tr>
                  <th>Mailbox</th>
                  <th>Warm-up</th>
                  <th>Warm-up emails (14 days)</th>
                  <th>Health score</th>
                  <th>Last 14 days</th>
                  <th>Warm-up on / off</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.mailboxes.map((m) => {
                  const h = HEALTH[m.health];
                  const isOpen = open === m.id;
                  return (
                    <React.Fragment key={m.id}>
                      <tr className={isOpen ? "is-open" : ""}>
                        <td>
                          <div className="mb-who">
                            <span className="mb-avatar" aria-hidden="true">{(m.display_name || m.email)[0].toUpperCase()}</span>
                            <div className="mb-who-text">
                              <strong className="truncate">{m.display_name || m.email.split("@")[0]}</strong>
                              <span className="truncate">{m.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>Day {m.warmup_day}</strong>
                          <span className="mb-sub">{m.target_today} a day now</span>
                        </td>
                        <td>
                          <strong>{m.series.reduce((n, d) => n + d.sent, 0)}</strong> <span className="mb-muted">sent</span>
                          <span className="mb-sub">{m.inbox_7d} in inbox · {m.rescued_7d} saved from spam</span>
                          <span className="mb-sub">Today: {m.sent_today} sent · {m.received_today} received · {m.scheduled_today} to go</span>
                        </td>
                        <td>
                          <span className={`wu-score wu-score--${m.health}`} title={h.hint}>{pct(m.inbox_rate_7d)}</span>
                          <span className="mb-sub">{m.inbox_7d + m.spam_7d ? `${m.spam_7d} in spam` : "No results yet"}</span>
                        </td>
                        <td><Spark series={m.series} /></td>
                        <td>
                          {m.status === "error" ? (
                            <>
                              <button className="btn btn-secondary btn-sm" onClick={() => setPasswordFor(m)}><KeyRound size={14} /> Fix login</button>
                              {m.last_error && <span className="mb-sub mb-error">{m.last_error}</span>}
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={m.status === "active"}
                                aria-label={`Warm-up for ${m.email}`}
                                className={`wu-switch${m.status === "active" ? " on" : ""}`}
                                disabled={busy === m.id}
                                onClick={() => m.status === "active"
                                  ? request(m.id, `/mailboxes/${m.id}`, "PATCH", { status: "paused" }, `${m.email} paused. Its planned emails were cancelled.`)
                                  : request(m.id, `/mailboxes/${m.id}`, "PATCH", { status: "active" }, `${m.email} is warming up again.`)}
                              >
                                <span />
                              </button>
                              <span className="mb-sub">{busy === m.id ? "Checking…" : m.status === "active" ? "Warming up" : "Paused"}</span>
                            </>
                          )}
                          {m.ready && <span className="pill tone-success" style={{ marginTop: 4 }} title="Healthy for 2+ weeks: it's ready to send your campaigns.">Ready for campaigns</span>}
                        </td>
                        <td>
                          <div className="mb-actions">
                            <button className="icon-btn" aria-label={`Check the login of ${m.email}`} title="Check the login" disabled={busy === `test-${m.id}`}
                              onClick={() => request(`test-${m.id}`, `/mailboxes/${m.id}/test`, "POST", undefined, `${m.email} can log in to send and read.`)}>
                              <RefreshCw size={15} className={busy === `test-${m.id}` ? "spin" : ""} />
                            </button>
                            <button className="icon-btn" aria-label={`Warm-up settings of ${m.email}`} title="Warm-up settings" onClick={() => setSettingsFor(m)}>
                              <Settings size={15} />
                            </button>
                            <button className="icon-btn danger" aria-label={`Remove ${m.email}`} title="Remove"
                              onClick={() => confirm({
                                title: `Remove ${m.email}?`,
                                message: "Its warm-up stops and its history is deleted. The mailbox itself and its emails are not touched.",
                                confirmLabel: "Remove mailbox",
                                danger: true,
                                onConfirm: () => request(`del-${m.id}`, `/mailboxes/${m.id}`, "DELETE", undefined, `${m.email} removed.`),
                              })}>
                              <Trash2 size={15} />
                            </button>
                            <button className="icon-btn" aria-expanded={isOpen} aria-label={`Latest emails of ${m.email}`} title="Latest emails"
                              onClick={() => setOpen(isOpen ? null : m.id)}>
                              <ChevronDown size={16} className={isOpen ? "rot-180" : ""} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="mb-detail">
                          <td colSpan={7}><DomainCheck mailboxId={m.id} /><Activity mailboxId={m.id} /></td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ChatPanel mailboxes={data.mailboxes} notify={notify} />
      <NewslettersPanel mailboxes={data.mailboxes} notify={notify} confirm={confirm} />

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
      {settingsFor && (
        <SettingsDialog
          key={settingsFor.id}
          mailbox={settingsFor}
          onClose={() => setSettingsFor(null)}
          saving={busy === "settings"}
          onSave={async (body) => {
            const ok = await request("settings", `/mailboxes/${settingsFor.id}`, "PATCH", body, `Warm-up settings of ${settingsFor.email} saved.`);
            if (ok) setSettingsFor(null);
          }}
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

/** 14 small bars: inbox (green) and spam (red) of each day's emails, sent-but-not-yet-seen in grey */
function Spark({ series }: { series: MailboxRow["series"] }) {
  const max = Math.max(1, ...series.map((d) => d.sent));
  const total = series.reduce((n, d) => n + d.sent, 0);
  return (
    <div className="mb-spark" role="img" aria-label={`${total} emails sent in the last 14 days`}>
      {series.map((d) => {
        const other = Math.max(0, d.sent - d.inbox - d.spam);
        return (
          <span key={d.date} className="mb-spark-day" title={`${d.date}: ${d.sent} sent, ${d.inbox} inbox, ${d.spam} spam`}>
            <i className="is-spam" style={{ height: `${(d.spam / max) * 100}%` }} />
            <i className="is-other" style={{ height: `${(other / max) * 100}%` }} />
            <i className="is-inbox" style={{ height: `${(d.inbox / max) * 100}%` }} />
          </span>
        );
      })}
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
            <span className="field-hint">The mailbox&apos;s own password, the one you use to log in to Hostinger Mail.</span>
          </label>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Name in emails <span className="mb-muted">(optional)</span></span>
              <input className="input" value={form.display_name} onChange={set("display_name")} placeholder="Ali Khan" maxLength={80} />
            </label>
            <label className="field">
              <span className="field-label">Most emails a day</span>
              <input className="input" type="number" min={2} max={50} required value={form.daily_limit} onChange={set("daily_limit")} />
            </label>
          </div>
          <details className="mb-servers">
            <summary>Server settings <span className="mb-muted">(Hostinger is filled in)</span></summary>
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


/** Instantly-style settings: how fast the daily number grows, its ceiling, and how many received emails get answered */
function SettingsDialog({
  mailbox, onClose, onSave, saving,
}: {
  mailbox: MailboxRow;
  onClose: () => void;
  onSave: (body: { warmup_increase: number; daily_limit: number; warmup_reply_rate: number }) => void;
  saving: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [increase, setIncrease] = useState(String(mailbox.warmup_increase ?? 1));
  const [limit, setLimit] = useState(String(mailbox.daily_limit));
  const [reply, setReply] = useState(String(mailbox.warmup_reply_rate ?? 30));
  useDialogFocus(ref, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const inc = Number(increase), lim = Number(limit), rep = Number(reply);
  const valid = Number.isInteger(inc) && inc >= 1 && inc <= 10 && Number.isInteger(lim) && lim >= 2 && lim <= 50 && Number.isInteger(rep) && rep >= 0 && rep <= 100;
  const days = valid ? Math.ceil((lim - 1) / inc) + 1 : 0;
  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="wu-settings-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="wu-settings-title">Warm-up settings for {mailbox.email}</h3>
        <p>
          {mailbox.warmup_increase ? "" : "Right now this mailbox uses the standard ramp (3, 6, 12, then 20 a day). "}
          Saving these switches it to a gradual ramp: 1 email on day 1, then a few more each day.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ warmup_increase: inc, daily_limit: lim, warmup_reply_rate: rep }); }}>
          <label className="field">
            <span className="field-label">Increase per day</span>
            <input className="input" type="number" min={1} max={10} required value={increase} onChange={(e) => setIncrease(e.target.value)} />
            <span className="field-hint">How many more emails it sends each day (1 to 10). Instantly suggests 1.</span>
          </label>
          <label className="field">
            <span className="field-label">Daily warm-up limit</span>
            <input className="input" type="number" min={2} max={50} required value={limit} onChange={(e) => setLimit(e.target.value)} />
            <span className="field-hint">The most it sends in a day (2 to 50). {valid ? `It reaches this on day ${days}.` : ""}</span>
          </label>
          <label className="field">
            <span className="field-label">Reply rate (%)</span>
            <input className="input" type="number" min={0} max={100} required value={reply} onChange={(e) => setReply(e.target.value)} />
            <span className="field-hint">Share of the warm-up emails it receives that it answers (0 to 100). Instantly suggests 30.</span>
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !valid}>{saving ? "Saving…" : "Save settings"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
