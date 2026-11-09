"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, RefreshCw, Mail, Newspaper, Plus, Trash2, X } from "lucide-react";
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
interface FeedItem { sub_id: string; newsletter: string; mailbox_id: string; mailbox: string; uid: string; from: string; subject: string; date: string | null; seen: boolean }

/** Newsletters each mailbox should get (once) */
const RECOMMENDED = 3;

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
  const [reading, setReading] = useState<{ sub: Subscription; uid?: string } | null>(null);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [feedAt, setFeedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Newsletters whose page was opened from here, waiting for "Yes, done" (per mailbox)
  const [opened, setOpened] = useState<Record<string, boolean>>({});
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

  // The live list: newsletter emails in the mailboxes' inboxes, read again every minute
  const loadFeed = useCallback(async (fresh = false) => {
    const res = await callApi<FeedItem[]>(`/mailboxes/newsletters/feed${fresh ? "?fresh=true" : ""}`);
    if (res.data) {
      setFeed(res.data);
      setFeedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => loadFeed(), 0);
    const timer = setInterval(() => loadFeed(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadFeed]);

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

  const countFor = (id: string) => (data?.subscriptions ?? []).filter((x) => x.mailbox_id === id).length;
  const key = (name: string) => `${current}:${name}`;

  /** Step 1 in one click: the address goes to the clipboard and the newsletter's signup page opens */
  const startSubscribe = async (c: CatalogItem) => {
    let copiedOk = true;
    try {
      await navigator.clipboard.writeText(box.email);
    } catch {
      copiedOk = false;
    }
    window.open(c.url, "_blank", "noopener,noreferrer");
    setOpened((o) => ({ ...o, [key(c.name)]: true }));
    notify(copiedOk
      ? `${box.email} is copied. Paste it on the ${c.name} page that just opened and subscribe, then come back and click "Yes, done".`
      : `Type ${box.email} on the ${c.name} page that just opened and subscribe, then come back and click "Yes, done".`);
  };

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
        <button className="link-btn nl-view" onClick={() => setReading({ sub: s })}><Mail size={13} /> View emails</button>
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
            A real person&apos;s inbox also gets newsletters from well-known websites. Give each mailbox {RECOMMENDED} or more, once.
            After that everything is automatic: the confirmation link is clicked, every issue is opened and taken out of spam.
          </p>
        </div>
      </div>

      <div className="nl-tabs" role="tablist" aria-label="Mailbox">
        {mailboxes.map((m) => {
          const n = countFor(m.id);
          return (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === current} className={`nl-tab${m.id === current ? " active" : ""}`} onClick={() => setMe(m.id)}>
              <strong>{m.display_name || m.email.split("@")[0]}</strong>
              <span className={n >= RECOMMENDED ? "nl-done" : ""}>{n >= RECOMMENDED ? `✓ ${n} newsletters` : `${n} of ${RECOMMENDED}`}</span>
            </button>
          );
        })}
      </div>

      <div className="nl-progress">
        <span className="wu-progress wu-progress--wide" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (subs.length / RECOMMENDED) * 100)}%` }} className={subs.length >= RECOMMENDED ? "done" : ""} />
        </span>
        <span>
          {subs.length >= RECOMMENDED
            ? <><strong>{box.email}</strong> has enough newsletters. Nothing else to do.</>
            : <><strong>{box.email}</strong>: {subs.length} of {RECOMMENDED}. Pick {RECOMMENDED - subs.length} more below.</>}
        </span>
      </div>

      <div className="nl-live">
        <div className="nl-live-head">
          <h3><span className="nl-live-dot" aria-hidden="true" /> Arriving in {box.email.split("@")[0]}&apos;s inbox</h3>
          <span className="mb-sub">
            {feedAt ? `Checked ${formatDateTime(feedAt)}` : "Checking…"} · updates every minute
          </span>
          <button className="btn btn-secondary btn-sm" disabled={refreshing} onClick={async () => {
            setRefreshing(true);
            await loadFeed(true);
            setRefreshing(false);
          }}>
            <RefreshCw size={14} className={refreshing ? "spin" : ""} /> Check now
          </button>
        </div>
        {!feed ? <div className="loader" /> : (() => {
          const mine = feed.filter((f) => f.mailbox_id === current);
          if (!mine.length) {
            return (
              <p className="field-hint nl-empty">
                {subs.length
                  ? "No newsletter emails yet. The first ones usually arrive within a day of subscribing."
                  : "No newsletters yet. Add a few below: their emails will show up here as they arrive."}
              </p>
            );
          }
          return (
            <ul className="nl-feed">
              {mine.slice(0, 8).map((f) => {
                const s = (data?.subscriptions ?? []).find((x) => x.id === f.sub_id);
                return (
                  <li key={`${f.sub_id}-${f.uid}`}>
                    <button type="button" className="nl-feed-row" disabled={!s} onClick={() => s && setReading({ sub: s, uid: f.uid })}>
                      <span className="nl-feed-name">{f.newsletter}</span>
                      <span className="nl-feed-subject truncate">{f.subject}</span>
                      <span className="nl-feed-meta">
                        <span className="pill no-dot tone-success">{f.seen ? "Opened" : "New"}</span>
                        {f.date ? formatDateTime(f.date) : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          );
        })()}
      </div>

      <details className="nl-add" open={subs.length < RECOMMENDED}>
        <summary>Add newsletters ({subs.length} of {RECOMMENDED} for this mailbox)</summary>
      <ol className="nl-steps">
        <li>Click <strong>Subscribe</strong> on a newsletter. We copy <strong>{box.email}</strong> and open its website.</li>
        <li>On that website, paste the address and subscribe.</li>
        <li>Come back here and click <strong>Yes, done</strong>.</li>
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
                  {s ? (
                    <div className="nl-actions">
                      <a className="btn btn-secondary btn-sm" href={c.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} /> Website
                      </a>
                      <button className="icon-btn danger" aria-label={`Stop handling ${c.name}`} title="Stop" onClick={() => remove(s)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : opened[key(c.name)] ? (
                    <div className="nl-confirm">
                      <span>Subscribed on their website?</span>
                      <div className="nl-actions">
                        <button className="btn btn-primary btn-sm" disabled={busy === `add-${c.name}`}
                          onClick={async () => {
                            const ok = await subscribed(c.name, c.domains.join(","), c.url);
                            if (ok) setOpened((o) => ({ ...o, [key(c.name)]: false }));
                          }}>
                          <Check size={14} /> Yes, done
                        </button>
                        <button className="link-btn" onClick={() => startSubscribe(c)}>Open again</button>
                        <button className="link-btn" onClick={() => setOpened((o) => ({ ...o, [key(c.name)]: false }))}>Not now</button>
                      </div>
                    </div>
                  ) : (
                    <div className="nl-actions">
                      <button className="btn btn-primary btn-sm" onClick={() => startSubscribe(c)}>
                        <ExternalLink size={14} /> Subscribe
                      </button>
                    </div>
                  )}
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
      </details>

      {reading && (
        <NewsletterReader
          sub={reading.sub}
          startUid={reading.uid}
          mailbox={mailboxes.find((m) => m.id === reading.sub.mailbox_id)?.email ?? box.email}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}

interface EmailRow { uid: string; from: string; subject: string; date: string | null; seen: boolean }
interface EmailFull { uid: string; from: string; subject: string; date: string | null; html: string }

/** A newsletter's emails, read straight from the mailbox's inbox. The email runs in a sandboxed frame (no scripts). */
function NewsletterReader({ sub, mailbox, onClose, startUid }: { sub: Subscription; mailbox: string; onClose: () => void; startUid?: string }) {
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
    if (startUid) {
      // Opened from the live list: show that email right away
      callApi<EmailFull>(`/mailboxes/newsletters/${sub.id}/emails/${startUid}`).then((res) => {
        if (live && res.data) setOpen(res.data);
      });
    }
    return () => {
      live = false;
    };
  }, [sub.id, startUid]);

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
