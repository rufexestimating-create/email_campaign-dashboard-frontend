"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Mail, Newspaper, Plus, Trash2, X } from "lucide-react";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { callApi } from "@/lib/insights";
import type { ConfirmRequest } from "@/components/dashboard/ConfirmDialog";
import type { ChatMailbox } from "./ChatPanel";

interface CatalogItem { name: string; topic: string; url: string; domains: string[] }
interface Subscription {
  id: string;
  mailbox_id: string;
  name: string;
  signup_url: string | null;
  sender_domains: string;
  status: "pending" | "confirmed";
  subscribed_at: string;
  confirmed_at: string | null;
  last_received_at: string | null;
  received_count: number;
  rescued_count: number;
}
interface Data { catalog: CatalogItem[]; subscriptions: Subscription[] }

/** Newsletters: a person subscribes each mailbox (signup forms block robots); the inbox check then confirms the
 *  subscription, opens every issue and takes it out of spam, so the mailbox receives ordinary outside mail. */
export function NewslettersPanel({
  mailboxes, notify, confirm,
}: {
  mailboxes: ChatMailbox[];
  notify: (msg: string, isError?: boolean) => void;
  confirm: (r: ConfirmRequest) => void;
}) {
  const [me, setMe] = useState(mailboxes[0]?.id ?? "");
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState({ name: "", sender_domains: "", signup_url: "" });
  const [showCustom, setShowCustom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState<Subscription | null>(null);
  const current = mailboxes.some((m) => m.id === me) ? me : mailboxes[0]?.id ?? "";
  // The dashboard re-renders every 10 s with a new `notify`; a ref keeps load() (and its timer) stable
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  });

  const load = useCallback(async () => {
    const res = await callApi<Data>("/mailboxes/newsletters");
    if (res.data) setData(res.data);
    else if (res.error) notifyRef.current(res.error, true);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const call = async (key: string, path: string, method: string, body?: object, done?: string) => {
    setBusy(key);
    try {
      const res = await apiFetch(path, { method, body: body ? JSON.stringify(body) : undefined });
      const json = res.status === 204 ? {} : await res.json();
      if (!res.ok) {
        notify(errorMessage(json, "That didn't work. Please try again."), true);
        return false;
      }
      if (done) notify(done);
      await load();
      return true;
    } catch {
      notify(NETWORK_ERROR, true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!mailboxes.length) return null;
  const box = mailboxes.find((m) => m.id === current)!;
  const subs = (data?.subscriptions ?? []).filter((s) => s.mailbox_id === current);
  const byName = new Map(subs.map((s) => [s.name, s]));
  const extra = subs.filter((s) => !data?.catalog.some((c) => c.name === s.name));

  const subscribed = (name: string, domains: string, url: string | null) =>
    call(`add-${name}`, `/mailboxes/${current}/newsletters`, "POST", { name, sender_domains: domains, signup_url: url },
      `${name} saved for ${box.email}. Its confirmation email is clicked and each issue is opened automatically.`);

  const status = (s: Subscription) => (
    <div className="nl-status">
      <span className={`pill no-dot ${s.status === "confirmed" ? "tone-success" : "tone-warning"}`}>
        {s.status === "confirmed" ? "Receiving" : "Waiting for the first email"}
      </span>
      <span className="mb-sub">
        {s.received_count} received{s.rescued_count ? ` · ${s.rescued_count} out of spam` : ""}
        {s.last_received_at ? ` · last ${formatDateTime(s.last_received_at)}` : ""}
      </span>
      {s.received_count > 0 && (
        <button className="link-btn nl-view" onClick={() => setReading(s)}><Mail size={13} /> View emails</button>
      )}
    </div>
  );

  const remove = (s: Subscription) => confirm({
    title: `Stop handling ${s.name}?`,
    message: `Its emails to ${box.email} won't be opened or taken out of spam any more. To stop receiving them, unsubscribe from inside one of its emails.`,
    confirmLabel: "Stop",
    danger: true,
    onConfirm: () => call(`del-${s.id}`, `/mailboxes/newsletters/${s.id}`, "DELETE", undefined, `${s.name} removed.`),
  });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Newspaper size={17} /> Newsletters</h2>
          <p className="card-sub">
            A real inbox also receives newsletters. Subscribe each mailbox to a few; from then on their emails are opened and taken out of spam by themselves.
          </p>
        </div>
        <select className="input nl-select" value={current} onChange={(e) => setMe(e.target.value)} aria-label="Mailbox">
          {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
        </select>
      </div>

      <ol className="nl-steps">
        <li>
          Copy the address{" "}
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            try {
              await navigator.clipboard.writeText(box.email);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              notify(`Copy this address: ${box.email}`);
            }
          }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {box.email}
          </button>
        </li>
        <li>Open a newsletter&apos;s signup page and subscribe with it.</li>
        <li>Press <strong>I&apos;ve subscribed</strong>. Its confirmation email is clicked for you within a few minutes.</li>
      </ol>

      {!data ? (
        <div className="loader" />
      ) : (
        <>
          <div className="nl-grid">
            {data.catalog.map((c) => {
              const s = byName.get(c.name);
              return (
                <div key={c.name} className={`nl-card${s ? " is-on" : ""}`}>
                  <div>
                    <strong>{c.name}</strong>
                    <span className="mb-sub">{c.topic} · from {c.domains[0]}</span>
                  </div>
                  {s && status(s)}
                  <div className="nl-actions">
                    <a className="btn btn-secondary btn-sm" href={c.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} /> Signup page
                    </a>
                    {s ? (
                      <button className="icon-btn danger" aria-label={`Stop handling ${c.name}`} title="Stop" onClick={() => remove(s)}>
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <button className="btn btn-primary btn-sm" disabled={busy === `add-${c.name}`}
                        onClick={() => subscribed(c.name, c.domains.join(","), c.url)}>
                        <Check size={14} /> I&apos;ve subscribed
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {extra.map((s) => (
              <div key={s.id} className="nl-card is-on">
                <div>
                  <strong>{s.name}</strong>
                  <span className="mb-sub">Your own · from {s.sender_domains.split(",")[0]}</span>
                </div>
                {status(s)}
                <div className="nl-actions">
                  {s.signup_url && (
                    <a className="btn btn-secondary btn-sm" href={s.signup_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Signup page</a>
                  )}
                  <button className="icon-btn danger" aria-label={`Stop handling ${s.name}`} title="Stop" onClick={() => remove(s)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>

          {showCustom ? (
            <form
              className="nl-custom"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await subscribed(custom.name.trim(), custom.sender_domains, custom.signup_url.trim() || null)) {
                  setCustom({ name: "", sender_domains: "", signup_url: "" });
                  setShowCustom(false);
                }
              }}
            >
              <label className="field">
                <span className="field-label">Name</span>
                <input className="input" required maxLength={120} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Interior Design Weekly" />
              </label>
              <label className="field">
                <span className="field-label">Its emails come from</span>
                <input className="input" required value={custom.sender_domains} onChange={(e) => setCustom({ ...custom, sender_domains: e.target.value })} placeholder="example.com" />
              </label>
              <label className="field">
                <span className="field-label">Signup page <span className="mb-muted">(optional)</span></span>
                <input className="input" type="url" value={custom.signup_url} onChange={(e) => setCustom({ ...custom, signup_url: e.target.value })} placeholder="https://example.com/newsletter" />
              </label>
              <div className="nl-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCustom(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={busy?.startsWith("add-")}><Check size={14} /> I&apos;ve subscribed</button>
              </div>
            </form>
          ) : (
            <button className="btn btn-secondary btn-sm nl-more" onClick={() => setShowCustom(true)}><Plus size={14} /> Another newsletter</button>
          )}
        </>
      )}
      {reading && <NewsletterReader sub={reading} mailbox={box.email} onClose={() => setReading(null)} />}
    </div>
  );
}

interface EmailRow { uid: string; from: string; subject: string; date: string | null; seen: boolean }
interface EmailFull { uid: string; from: string; subject: string; date: string | null; html: string }

/** A newsletter's emails, read straight from the mailbox's inbox. The email runs in a sandboxed frame (no scripts). */
function NewsletterReader({ sub, mailbox, onClose }: { sub: Subscription; mailbox: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<EmailRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<EmailFull | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  useDialogFocus(ref, true);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Once per newsletter. It must not depend on onClose: that changes on every dashboard refresh (every 10 s), which
  // restarted the request before the mailbox answered, so the list never appeared.
  useEffect(() => {
    let live = true;
    callApi<EmailRow[]>(`/mailboxes/newsletters/${sub.id}/emails`).then((res) => {
      if (!live) return;
      setRows(res.data ?? []);
      setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [sub.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const show = async (uid: string) => {
    setLoading(uid);
    const res = await callApi<EmailFull>(`/mailboxes/newsletters/${sub.id}/emails/${uid}`);
    setLoading(null);
    if (res.data) setOpen(res.data);
    else setError(res.error);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={ref} className="dialog nl-reader" role="dialog" aria-modal="true" aria-labelledby="nl-reader-title" onClick={(e) => e.stopPropagation()}>
        <div className="nl-reader-head">
          <div>
            <h3 id="nl-reader-title">{sub.name}</h3>
            <p>Emails in {mailbox}&apos;s inbox, last 30 days</p>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {error && <p className="field-hint mb-error">{error}</p>}
        <div className="nl-reader-body">
          <ul className="nl-reader-list">
            {!rows ? <li><div className="loader" /></li> : rows.length === 0 ? (
              <li className="field-hint">No emails from {sub.name} in the inbox yet.</li>
            ) : rows.map((r) => (
              <li key={r.uid}>
                <button className={`nl-reader-item${open?.uid === r.uid ? " is-active" : ""}`} onClick={() => show(r.uid)} disabled={loading === r.uid}>
                  <strong className="truncate">{r.subject}</strong>
                  <span className="truncate">{r.date ? formatDateTime(r.date) : ""}{r.seen ? " · read" : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="nl-reader-view">
            {open ? (
              <>
                <div className="nl-reader-meta">
                  <strong>{open.subject}</strong>
                  <span>{open.from}{open.date ? ` · ${formatDateTime(open.date)}` : ""}</span>
                </div>
                <iframe title={open.subject} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={open.html} />
              </>
            ) : (
              <p className="chat-empty-line">{loading ? "Opening…" : "Pick an email on the left to read it."}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
