"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { AlertOctagon, AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { CheckStatus, PreflightAction, PreflightResult, STATUS_LABEL, STATUS_TONE } from "@/lib/insights";
import { SpamScore } from "./SpamCheck";

const MIN_REASON = 5;

const ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 size={18} />,
  warn: <AlertTriangle size={18} />,
  fail: <AlertOctagon size={18} />,
};

const VERDICT: Record<CheckStatus, { icon: React.ReactNode; title: string; sub: string }> = {
  pass: { icon: <ShieldCheck size={22} />, title: "Ready to send", sub: "All eight checks pass." },
  warn: { icon: <ShieldAlert size={22} />, title: "Review before sending", sub: "Some checks have warnings. You can fix them in one click, or send as it is." },
  fail: { icon: <AlertOctagon size={22} />, title: "Sending is blocked", sub: "At least one check failed. Fix it, or override with a reason." },
};

/** The pre-send review, built on the preflight checks. A failed check blocks Send until it is fixed or overridden with a reason. */
export function PreflightDialog({
  open,
  loading,
  error,
  result,
  accepted,
  sendLabel,
  sending,
  onAction,
  onEdit,
  onSend,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  result: PreflightResult | null;
  /** Check ids whose action was applied in this pop-up */
  accepted: string[];
  sendLabel: string;
  sending: boolean;
  onAction: (checkId: string, action: PreflightAction) => void;
  onEdit: () => void;
  onSend: (overrideReason: string | null) => void;
}) {
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEdit();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onEdit]);

  // A fresh pop-up starts without an override
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      setOverriding(false);
      setReason("");
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;
  const blocked = result?.verdict === "fail";
  const reasonOk = reason.trim().length >= MIN_REASON;
  const verdict = result ? VERDICT[result.verdict] : null;
  const versions = result ? (Object.entries(result.spam) as ["A" | "B", NonNullable<PreflightResult["spam"]["A"]>][]) : [];
  const issues = result?.checks.filter((c) => c.status !== "pass") ?? [];
  const passed = result?.checks.filter((c) => c.status === "pass") ?? [];

  return (
    <div className="dialog-backdrop" onClick={onEdit}>
      <div ref={dialogRef} className="dialog presend" role="dialog" aria-modal="true" aria-labelledby="preflight-title" onClick={(e) => e.stopPropagation()}>
        <button autoFocus className="icon-btn presend-close" onClick={onEdit} aria-label="Close">
          <X size={18} />
        </button>

        {loading && !result ? (
          <div className="presend-loading">
            <div className="loader" />
            <div>
              <h3 id="preflight-title">Checking your campaign…</h3>
              <p>Audience, timing, sending volume, Gmail rules, inbox placement, DNS records and content.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="presend-head">
              <span className={`presend-badge ${result ? STATUS_TONE[result.verdict] : "tone-neutral"}`}>{verdict?.icon ?? <Sparkles size={22} />}</span>
              <div>
                <h3 id="preflight-title">{verdict?.title ?? "Before you send"}</h3>
                <p>{error ?? verdict?.sub}</p>
              </div>
            </div>

            {result && (
              <>
                <div className={`presend-scores ${versions.length > 1 ? "two" : ""}`}>
                  {versions.map(([v, s]) => (
                    <div key={v} className="presend-score">
                      <div className="field-hint" style={{ marginBottom: "0.35rem" }}>Spam risk{versions.length > 1 ? ` · version ${v}` : ""}</div>
                      <SpamScore score={s.score} level={s.level} label={s.label} compact />
                    </div>
                  ))}
                  <div className="presend-score">
                    <div className="field-hint" style={{ marginBottom: "0.35rem" }}>Checks</div>
                    <div className="preflight-counts">
                      <span className="pill no-dot tone-success">{result.counts.pass} pass</span>
                      <span className="pill no-dot tone-warning">{result.counts.warn} warn</span>
                      <span className="pill no-dot tone-danger">{result.counts.fail} fail</span>
                    </div>
                  </div>
                </div>

                {issues.length > 0 && (
                  <>
                    <div className="section-label" style={{ marginTop: "1.1rem" }}>Needs attention</div>
                    <ul className="lab-checks preflight-list">
                      {issues.map((c) => (
                        <li key={c.id} className={`lab-check is-${c.status}`}>
                          <span className={`lab-check-icon ${STATUS_TONE[c.status]}`}>{ICON[c.status]}</span>
                          <div className="lab-check-body">
                            <div className="lab-check-head">
                              <strong>{c.name}</strong>
                              <span className={`pill no-dot ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                            </div>
                            <p className="lab-check-msg">{c.message}</p>
                            {c.detail && <p className="field-hint">{c.detail}</p>}
                            {c.action && (
                              <button type="button" className="btn btn-secondary btn-sm act-accent" onClick={() => onAction(c.id, c.action!)} disabled={loading}>
                                {c.action.label}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {passed.length > 0 && (
                  <details className="lab-details preflight-passed">
                    <summary>{passed.length} check{passed.length === 1 ? "" : "s"} passed</summary>
                    <ul>
                      {passed.map((c) => (
                        <li key={c.id}><CheckCircle2 size={14} /> <strong>{c.name}:</strong> {c.message}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {accepted.length > 0 && <p className="field-hint" style={{ marginTop: "0.6rem" }}>Applied {accepted.length} suggestion{accepted.length === 1 ? "" : "s"}. The checks above are re-run after each one.</p>}

                {blocked && overriding && (
                  <label className="field preflight-override">
                    <span className="field-label">Why send anyway? (saved with this campaign)</span>
                    <textarea
                      className="input textarea"
                      rows={2}
                      autoFocus
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. These contacts asked for this update by phone"
                    />
                    {!reasonOk && <span className="field-hint">At least {MIN_REASON} characters.</span>}
                  </label>
                )}
                <p className="field-hint" style={{ marginTop: "0.6rem" }}>{result.note}</p>
              </>
            )}

            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={onEdit}>Go back and edit</button>
              {blocked && !overriding ? (
                <button className="btn btn-danger-solid" onClick={() => setOverriding(true)} disabled={sending || loading}>
                  Override…
                </button>
              ) : (
                <button
                  className={`btn ${blocked ? "btn-danger-solid" : "btn-primary"}`}
                  onClick={() => onSend(blocked ? reason.trim() : null)}
                  disabled={sending || loading || (blocked && !reasonOk)}
                >
                  {sending ? "Working on it…" : blocked ? `${sendLabel} anyway` : sendLabel}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
