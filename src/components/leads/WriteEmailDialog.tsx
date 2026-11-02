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
  const ref = useRef<HTMLDivElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  useDialogFocus(ref, !!request);

  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      setSubject(request.subject);
      setBody(request.body);
    }, 0);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [request, onClose, sending]);

  if (!request) return null;
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
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={() => !sending && onClose()}>
      <div ref={ref} className="dialog write-email" role="dialog" aria-modal="true" aria-labelledby="write-email-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="write-email-title">{request.title}</h3>
        <p>Goes out now from your company address. {request.replyId ? "It joins your conversation with them." : ""}</p>
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
            <textarea className="input textarea" rows={9} value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
            <span className="field-hint">{"{{first_name}}"} becomes their first name.</span>
          </label>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
            <Send size={15} aria-hidden="true" /> {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}
