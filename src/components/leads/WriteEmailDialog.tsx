"use client";

import React, { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { callApi } from "@/lib/insights";
import { useDialogFocus } from "@/components/dashboard/useDialogFocus";

/** Who to write to and what to start from. `replyId` answers that reply, so the email joins their conversation. */
export interface WriteEmailRequest {
  leadId: string;
  to: string;
  name: string | null;
  title: string;
  subject: string;
  body: string;
  replyId?: string;
}

/** A hand-written email to one lead: answer their reply, or follow up whenever you choose. Sends right away. */
export function WriteEmailDialog({
  request,
  onClose,
  notify,
}: {
  request: WriteEmailRequest | null;
  onClose: () => void;
  notify: (msg: string, isError?: boolean) => void;
}) {
  if (!request) return null;
  // A new form for each email: its fields are filled once, from this request, and nothing later refills them
  return <WriteEmailForm key={`${request.leadId}:${request.replyId ?? ""}:${request.title}`} request={request} onClose={onClose} notify={notify} />;
}

/** The same form, written right under an opened email instead of in a window (like replying in Gmail) */
export function WriteEmailInline({
  request,
  onClose,
  onSent,
  notify,
}: {
  request: WriteEmailRequest;
  onClose: () => void;
  onSent?: () => void;
  notify: (msg: string, isError?: boolean) => void;
}) {
  return <WriteEmailForm inline request={request} onClose={onClose} onSent={onSent} notify={notify} />;
}

function WriteEmailForm({
  request,
  onClose,
  onSent,
  notify,
  inline = false,
}: {
  request: WriteEmailRequest;
  onClose: () => void;
  onSent?: () => void;
  notify: (msg: string, isError?: boolean) => void;
  inline?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Filled once when the form opens. The dashboard refreshes every few seconds and hands down a new onClose each
  // time; an effect that depended on it put the original subject and message back over what was typed.
  const [subject, setSubject] = useState(request.subject);
  const [body, setBody] = useState(request.body);
  const [sending, setSending] = useState(false);
  const closeRef = useRef(onClose);
  const sendingRef = useRef(false);
  // Where the mouse went down: selecting text and letting go outside the form must not close it
  const downOnBackdrop = useRef(false);
  useDialogFocus(ref, !inline);

  useEffect(() => {
    closeRef.current = onClose;
    sendingRef.current = sending;
  });

  useEffect(() => {
    if (inline) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sendingRef.current && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inline]);

  const who = request.name || request.to;

  const send = async () => {
    setSending(true);
    const res = await callApi<{ status: string }>(`/leads/${request.leadId}/email`, {
      subject: subject.trim(),
      body,
      reply_id: request.replyId ?? null,
    });
    setSending(false);
    if (res.error) return notify(res.error, true);
    notify(`Email sent to ${who}. It shows in Sent emails, and their reply will appear here.`);
    onSent?.();
    onClose();
  };

  const fields = (
    <>
      <div className="write-email-form">
        <label className="field">
          <span className="field-label">To</span>
          <input className="input" value={request.name ? `${request.name} <${request.to}>` : request.to} readOnly />
        </label>
        <label className="field">
          <span className="field-label">Subject</span>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={255} />
        </label>
        <label className="field">
          <span className="field-label">Message</span>
          <textarea className="input textarea" rows={inline ? 8 : 9} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
          <span className="field-hint">{"{{first_name}}"} becomes their first name.</span>
        </label>
      </div>
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose} disabled={sending}>{inline ? "Discard" : "Cancel"}</button>
        <button className="btn btn-primary" onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
          <Send size={15} aria-hidden="true" /> {sending ? "Sending…" : "Send email"}
        </button>
      </div>
    </>
  );

  if (inline) {
    return (
      <section ref={ref} className="card composer" aria-label={`Reply to ${who}`}>
        <h3 className="composer-title">{request.title}</h3>
        {fields}
      </section>
    );
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only a click that started and ended on the backdrop closes it
        if (e.target === e.currentTarget && downOnBackdrop.current && !sending) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div ref={ref} className="dialog write-email" role="dialog" aria-modal="true" aria-labelledby="write-email-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="write-email-title">{request.title}</h3>
        <p>Goes out now from your company address. {request.replyId ? "It joins your conversation with them." : ""}</p>
        {fields}
      </div>
    </div>
  );
}
