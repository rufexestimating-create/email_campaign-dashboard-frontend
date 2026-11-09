"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, MailOpen, Reply } from "lucide-react";
import { callApi } from "@/lib/insights";
import { apiFetch } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { WriteEmailInline, type WriteEmailRequest } from "./WriteEmailDialog";

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
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s/;

/** Plain-text email is hard-wrapped at ~75 characters. Join those lines back into flowing paragraphs, but keep short
 *  lines (greetings, signatures, addresses) and list items on their own lines. */
export function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      let out = lines[0] ?? "";
      for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1].trim();
        const soft = prev.length >= 55 && !/[:;]$/.test(prev) && !LIST_ITEM.test(lines[i]);
        out += soft ? ` ${lines[i].trim()}` : `\n${lines[i]}`;
      }
      return out.trim();
    })
    .filter(Boolean);
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(LINK_RE).map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow">{p.length > 60 ? `${p.slice(0, 60)}…` : p}</a>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

/** A reply opened like an email in Gmail: on its own page, the whole message, and the answer written right below it */
export function ReplyView({
  replyId,
  replyTo,
  onBack,
  notify,
  timeAgo,
}: {
  replyId: string;
  replyTo: string | null;
  onBack: () => void;
  notify: (msg: string, isError?: boolean) => void;
  timeAgo: (iso: string) => string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [reply, setReply] = useState<FullReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState(false);
  const backRef = useRef(onBack);

  useEffect(() => {
    backRef.current = onBack;
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    let live = true;
    callApi<FullReply>(`/replies/${replyId}`).then((res) => {
      if (!live) return;
      if (res.data) setReply(res.data);
      else setError(res.error ?? "This reply couldn't be opened.");
    });
    return () => {
      live = false;
    };
  }, [replyId]);

  useEffect(() => {
    // Esc goes back to the list, unless they're typing an answer
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === "Escape" && !typing) backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const who = reply ? reply.lead_name || reply.from_name || reply.recipient : "";
  const subject = reply?.subject?.trim() || "(no subject)";
  const answer: WriteEmailRequest | null = reply?.lead_id
    ? {
        leadId: reply.lead_id, to: reply.recipient, name: reply.lead_name, title: `Reply to ${who}`, replyId: reply.id,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
        body: "Hi {{first_name}},\n\nThanks for getting back to me. \n\nBest regards,",
      }
    : null;

  return (
    <section ref={ref} className="mail-view" aria-label="Reply">
      <div className="mail-toolbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to Leads</button>
        {reply && (
          <button className="btn btn-ghost btn-sm" onClick={async () => {
            await apiFetch(`/replies/${reply.id}/unread`, { method: "POST" }).catch(() => null);
            onBack();
          }}>
            <MailOpen size={15} aria-hidden="true" /> Mark as unread
          </button>
        )}
      </div>

      <div className="card mail-card">
        {error && <p className="field-hint mb-error" role="alert">{error}</p>}
        {!reply && !error && <div className="loader" />}
        {reply && (
          <>
            <h2 className="mail-subject">{subject}</h2>
            <div className="mail-from">
              <span className="mail-avatar" aria-hidden="true">{who[0]?.toUpperCase()}</span>
              <div className="mail-from-text">
                <span><strong>{who}</strong> <span className="text-2">&lt;{reply.recipient}&gt;</span></span>
                <span className="text-2 mail-to">
                  to {replyTo ?? "you"}{reply.campaign_name ? ` · reply to your email “${reply.campaign_name}”` : ""}
                </span>
              </div>
              <span className="mail-date" title={formatDateTime(reply.received_at)}>
                {formatDateTime(reply.received_at)}{timeAgo(reply.received_at) ? ` (${timeAgo(reply.received_at)})` : ""}
              </span>
            </div>
            <div className="mail-body">
              {reply.body ? paragraphs(reply.body).map((p, i) => <p key={i}><Linked text={p} /></p>) : (
                <p className="text-2"><em>No text, maybe just an attachment.</em></p>
              )}
            </div>
            {!writing && answer && (
              <div className="mail-actions">
                <button className="btn btn-primary mail-reply-btn" onClick={() => { setWriting(true); setSent(false); }}>
                  <Reply size={16} aria-hidden="true" /> Reply
                </button>
                {sent && <span className="mail-sent">✓ Your answer was sent</span>}
              </div>
            )}
          </>
        )}
      </div>

      {writing && answer && (
        <WriteEmailInline
          key={reply?.id}
          request={answer}
          notify={notify}
          onSent={() => setSent(true)}
          onClose={() => setWriting(false)}
        />
      )}
    </section>
  );
}
