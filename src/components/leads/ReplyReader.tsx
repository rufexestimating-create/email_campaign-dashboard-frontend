"use client";

import React, { useEffect, useRef, useState } from "react";
import { MailOpen, Reply, X } from "lucide-react";
import { callApi } from "@/lib/insights";
import { apiFetch } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";

/** One reply as returned by GET /replies/{id}: the whole message */
export interface FullReply {
  id: string;
  recipient: string;
  from_name: string | null;
  lead_id: string | null;
  lead_name: string | null;
  subject: string | null;
  body: string;
  received_at: string;
  campaign_name: string | null;
}

const LINK_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** The message text with its line breaks, and web addresses as links that open in a new tab */
function MessageText({ text }: { text: string }) {
  const parts = text.split(LINK_RE);
  return (
    <div className="reader-body">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">{p.length > 70 ? `${p.slice(0, 70)}…` : p}</a>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </div>
  );
}

/** Opening a reply, like opening an email in Gmail: the whole message, then Reply or mark it unread again */
export function ReplyReader({
  replyId,
  onClose,
  onReply,
  onRead,
  onUnread,
}: {
  replyId: string;
  onClose: () => void;
  onReply: (r: FullReply) => void;
  onRead: (id: string) => void;
  onUnread: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState<FullReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The dashboard refreshes every few seconds and hands down new callbacks: keep the latest in refs
  const cb = useRef({ onClose, onRead });
  const downOnBackdrop = useRef(false);
  useDialogFocus(ref, true);

  useEffect(() => {
    cb.current = { onClose, onRead };
  });

  useEffect(() => {
    let live = true;
    callApi<FullReply>(`/replies/${replyId}`).then((res) => {
      if (!live) return;
      if (res.data) {
        setReply(res.data);
        cb.current.onRead(replyId);
      } else {
        setError(res.error ?? "This reply couldn't be opened.");
      }
    });
    return () => {
      live = false;
    };
  }, [replyId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cb.current.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const who = reply ? reply.lead_name || reply.from_name || reply.recipient : "";

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div ref={ref} className="dialog reader" role="dialog" aria-modal="true" aria-labelledby="reader-title" onClick={(e) => e.stopPropagation()}>
        <div className="reader-head">
          <h3 id="reader-title">{reply ? reply.subject || "(no subject)" : "Opening…"}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        {error && <p className="field-hint mb-error" role="alert">{error}</p>}
        {!reply && !error && <div className="loader" />}
        {reply && (
          <>
            <div className="reader-meta">
              <span className="reader-avatar" aria-hidden="true">{who[0]?.toUpperCase()}</span>
              <div>
                <strong>{who}</strong> <span className="text-2">&lt;{reply.recipient}&gt;</span>
                <span className="text-2 reader-sub">
                  {formatDateTime(reply.received_at)}
                  {reply.campaign_name ? ` · reply to “${reply.campaign_name}”` : ""}
                </span>
              </div>
            </div>
            {reply.body ? <MessageText text={reply.body} /> : <p className="field-hint">No text, maybe just an attachment.</p>}
            <div className="dialog-actions reader-actions">
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                await apiFetch(`/replies/${reply.id}/unread`, { method: "POST" }).catch(() => null);
                onUnread(reply.id);
                onClose();
              }}>
                <MailOpen size={14} aria-hidden="true" /> Mark as unread
              </button>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              {reply.lead_id && (
                <button className="btn btn-primary" onClick={() => onReply(reply)}>
                  <Reply size={15} aria-hidden="true" /> Reply
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
