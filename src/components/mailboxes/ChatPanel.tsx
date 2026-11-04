"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CornerUpLeft, MessageSquare, Plus, Send, Users, X } from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { callApi } from "@/lib/insights";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";

interface Member { id: string; email: string; name: string; status: string }
interface Preview { text: string; at: string; from_mailbox_id: string; auto: boolean }
interface ThreadRow { id: string | null; kind: "direct" | "group"; title?: string; with?: Member; members: Member[]; last: Preview | null }
interface ThreadList { groups: ThreadRow[]; direct: ThreadRow[] }
interface Receipt { mailbox_id: string; landed_in: "inbox" | "spam" | null; rescued: boolean; found_at: string | null }
interface Msg {
  id: string;
  source: "chat" | "auto";
  from_mailbox_id: string;
  subject: string;
  body: string;
  quote: string | null;
  at: string;
  receipts: Receipt[];
}
interface ThreadData { thread: { id: string; kind: "direct" | "group"; title: string | null; members: Member[] }; messages: Msg[] }

export interface ChatMailbox { id: string; email: string; display_name: string | null }

const nameOf = (m: ChatMailbox) => m.display_name || m.email.split("@")[0];

/** Where a sent message landed, from its receipts: "Inbox", "Spam → moved to inbox", or still on its way */
function delivery(receipts: Receipt[]): { text: string; tone: string } | null {
  if (!receipts.length) return null;
  const seen = receipts.filter((r) => r.landed_in);
  if (!seen.length) return { text: "Sent · checked within 5 minutes", tone: "" };
  const spam = seen.filter((r) => r.landed_in === "spam").length;
  const where = spam ? `${spam} in spam, moved to inbox` : "Inbox";
  return { text: receipts.length > 1 ? `${where} · ${seen.length}/${receipts.length} seen` : where, tone: spam ? "is-warn" : "is-ok" };
}

/** Chat between the warm-up mailboxes: one to one and in groups. Every message is a real email from that mailbox. */
export function ChatPanel({ mailboxes, notify }: { mailboxes: ChatMailbox[]; notify: (msg: string, isError?: boolean) => void }) {
  const [me, setMe] = useState(mailboxes[0]?.id ?? "");
  const [list, setList] = useState<ThreadList | null>(null);
  const [active, setActive] = useState<{ key: string; id: string } | null>(null);
  const [data, setData] = useState<ThreadData | null>(null);
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const meValid = mailboxes.some((m) => m.id === me);
  const current = meValid ? me : mailboxes[0]?.id ?? "";

  const loadList = useCallback(async () => {
    if (!current) return;
    const res = await callApi<ThreadList>(`/chat/threads?mailbox_id=${current}`);
    if (res.data) setList(res.data);
  }, [current]);

  const loadThread = useCallback(async (id: string) => {
    const res = await callApi<ThreadData>(`/chat/threads/${id}/messages`);
    if (res.data) setData(res.data);
    else if (res.error) notify(res.error, true);
  }, [notify]);

  useEffect(() => {
    const first = setTimeout(loadList, 0);
    const timer = setInterval(loadList, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loadList]);

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => loadThread(active.id), 0);
    const timer = setInterval(() => loadThread(active.id), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, loadThread]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [data?.messages.length, active?.id]);

  const switchMe = (id: string) => {
    setMe(id);
    setActive(null);
    setData(null);
    setList(null);
    setQuote(null);
  };

  const openDirect = async (otherId: string, withQuote: string | null = null) => {
    const res = await callApi<{ id: string }>("/chat/direct", { mailbox_id: current, with_mailbox_id: otherId });
    if (!res.data) return notify(res.error ?? NETWORK_ERROR, true);
    setData(null);
    setActive({ key: `d:${otherId}`, id: res.data.id });
    setQuote(withQuote);
  };

  const openGroup = (id: string) => {
    setData(null);
    setActive({ key: `g:${id}`, id });
    setQuote(null);
  };

  const send = async () => {
    if (!active || !draft.trim() || sending) return;
    setSending(true);
    try {
      const res = await apiFetch(`/chat/threads/${active.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ from_mailbox_id: current, body: draft, quote }),
      });
      const json = await res.json();
      if (!res.ok) return notify(errorMessage(json, "The message couldn't be sent."), true);
      setData((d) => (d ? { ...d, messages: [...d.messages, json as Msg] } : d));
      setDraft("");
      setQuote(null);
      loadList();
    } catch {
      notify(NETWORK_ERROR, true);
    } finally {
      setSending(false);
    }
  };

  if (mailboxes.length < 2) return null;
  const meBox = mailboxes.find((m) => m.id === current)!;
  const memberName = (id: string) => {
    const m = data?.thread.members.find((x) => x.id === id) ?? mailboxes.find((x) => x.id === id);
    return m ? ("name" in m ? m.name : nameOf(m)) : "Removed mailbox";
  };
  const title = data
    ? data.thread.kind === "group"
      ? data.thread.title
      : data.thread.members.find((m) => m.id !== current)?.name
    : null;

  const item = (t: ThreadRow) => {
    const key = t.kind === "group" ? `g:${t.id}` : `d:${t.with!.id}`;
    const label = t.kind === "group" ? t.title! : t.with!.name;
    const last = t.last;
    return (
      <li key={key}>
        <button className={`chat-item${active?.key === key ? " is-active" : ""}`}
          onClick={() => (t.kind === "group" ? openGroup(t.id!) : openDirect(t.with!.id))}>
          <span className={`mb-avatar${t.kind === "group" ? " is-group" : ""}`} aria-hidden="true">
            {t.kind === "group" ? <Users size={15} /> : label[0].toUpperCase()}
          </span>
          <span className="chat-item-text">
            <strong className="truncate">{label}</strong>
            <span className="truncate">
              {last
                ? `${last.from_mailbox_id === current ? "You: " : ""}${last.auto ? "Auto · " : ""}${last.text}`
                : t.kind === "group" ? `${t.members.length} mailboxes` : "No messages yet"}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title"><MessageSquare size={17} /> Chat between your mailboxes</h2>
          <p className="card-sub">
            Write as any of your mailboxes, one to one or in a group. Each message is sent as a real email from that mailbox,
            so it counts for the warm-up, and it&apos;s opened and taken out of spam on the other side.
          </p>
        </div>
        <div className="chat-new-group">
          <button className="btn btn-secondary btn-sm" onClick={() => setGrouping(true)} disabled={mailboxes.length < 3}>
            <Plus size={15} /> New group
          </button>
          {mailboxes.length < 3 && <span className="field-hint">Groups need 3 or more mailboxes. With two, use their private chat.</span>}
        </div>
      </div>

      <div className={`chat${active ? " has-active" : ""}`}>
        <aside className="chat-side">
          <label className="field chat-me">
            <span className="field-label">Chatting as</span>
            <select className="input" value={current} onChange={(e) => switchMe(e.target.value)}>
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{nameOf(m)} ({m.email})</option>)}
            </select>
          </label>
          {!list ? (
            <div className="loader" />
          ) : (
            <>
              {list.groups.length > 0 && (
                <>
                  <p className="chat-list-label">Groups</p>
                  <ul className="chat-list">{list.groups.map(item)}</ul>
                </>
              )}
              <p className="chat-list-label">Private</p>
              <ul className="chat-list">{list.direct.map(item)}</ul>
            </>
          )}
        </aside>

        <section className="chat-main" aria-label="Conversation">
          {!active ? (
            <div className="chat-empty">
              <MessageSquare size={22} />
              <p>Pick a mailbox or group on the left to start chatting as {nameOf(meBox)}.</p>
            </div>
          ) : (
            <>
              <header className="chat-head">
                <button className="icon-btn chat-back" aria-label="Back to conversations" onClick={() => setActive(null)}><X size={16} /></button>
                <div className="chat-head-text">
                  <strong className="truncate">{title ?? "…"}</strong>
                  {data && <span className="truncate">{data.thread.members.map((m) => (m.id === current ? "You" : m.name)).join(", ")}</span>}
                </div>
              </header>
              <div className="chat-msgs" ref={scroller}>
                {!data ? (
                  <div className="loader" />
                ) : data.messages.length === 0 ? (
                  <p className="chat-empty-line">No messages yet. Say hello.</p>
                ) : (
                  data.messages.map((m) => {
                    const mine = m.from_mailbox_id === current;
                    const state = mine ? delivery(m.receipts) : null;
                    return (
                      <div key={`${m.source}-${m.id}`} className={`chat-msg${mine ? " mine" : ""}`}>
                        {!mine && <span className="chat-from">{memberName(m.from_mailbox_id)}</span>}
                        <div className={`chat-bubble${m.source === "auto" ? " auto" : ""}`}>
                          {m.source === "auto" && <span className="chat-auto">Automatic warm-up · {m.subject}</span>}
                          {m.quote && <blockquote className="chat-quote">{m.quote}</blockquote>}
                          {m.body}
                        </div>
                        <span className="chat-meta">
                          {formatDateTime(m.at)}
                          {state && <span className={state.tone}> · {state.text}</span>}
                          {!mine && data.thread.kind === "group" && (
                            <button className="link-btn chat-private" onClick={() => openDirect(m.from_mailbox_id, m.body)}>
                              <CornerUpLeft size={12} /> Reply privately
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              {data && data.thread.kind === "group" && (
                <p className="chat-hint">
                  {data.thread.members.length < 3
                    ? "This group has the same two mailboxes as their private chat. Groups are for 3 or more mailboxes: one message reaches everyone."
                    : data.messages.some((m) => m.from_mailbox_id !== current)
                      ? "Every message here goes to all members. Use “Reply privately” under someone's message to answer only them."
                      : "Every message here goes to all members. “Reply privately” shows under other members' messages: switch “Chatting as” to see it."}
                </p>
              )}
              <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
                {quote && (
                  <div className="chat-quoting">
                    <span className="truncate">Replying privately to: {quote}</span>
                    <button type="button" className="icon-btn" aria-label="Don't quote" onClick={() => setQuote(null)}><X size={14} /></button>
                  </div>
                )}
                <div className="chat-compose-row">
                  <textarea
                    className="input"
                    rows={2}
                    value={draft}
                    placeholder={`Message as ${nameOf(meBox)}… (Enter to send, Shift+Enter for a new line)`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    maxLength={5000}
                    aria-label="Message"
                  />
                  <button className="btn btn-primary" disabled={sending || !draft.trim()}>
                    <Send size={15} /> {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {grouping && (
        <GroupDialog
          mailboxes={mailboxes}
          me={current}
          onClose={() => setGrouping(false)}
          onCreated={(id) => {
            setGrouping(false);
            loadList();
            openGroup(id);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function GroupDialog({
  mailboxes, me, onClose, onCreated, notify,
}: {
  mailboxes: ChatMailbox[];
  me: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  notify: (msg: string, isError?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>(() => mailboxes.map((m) => m.id));
  const [saving, setSaving] = useState(false);
  useDialogFocus(ref, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const ids = picked.includes(me) ? picked : [me, ...picked];

  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-group-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="new-group-title">New group</h3>
        <p>Each message in the group goes to every other member as one email.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            const res = await callApi<{ id: string }>("/chat/groups", { title, mailbox_ids: ids });
            setSaving(false);
            if (res.data) onCreated(res.data.id);
            else notify(res.error ?? NETWORK_ERROR, true);
          }}
        >
          <label className="field">
            <span className="field-label">Group name</span>
            <input className="input" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design team" autoFocus />
          </label>
          <fieldset className="chat-pick">
            <legend className="field-label">Members</legend>
            {mailboxes.map((m) => (
              <label key={m.id} className="chat-pick-row">
                <input type="checkbox" checked={ids.includes(m.id)} disabled={m.id === me} onChange={() => toggle(m.id)} />
                <span>{nameOf(m)} <span className="mb-muted">{m.email}{m.id === me ? " · you" : ""}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || ids.length < 2 || !title.trim()}>{saving ? "Creating…" : "Create group"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
