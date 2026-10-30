"use client";

import React, { useState } from "react";
import { AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, ChevronDown, Crosshair, ShieldCheck, Wand2 } from "lucide-react";
import { LEVEL_TONE, SEVERITY_TONE, SpamFix, SpamResult, SpamSpan } from "@/lib/spam";

export function SpamScore({ score, level, label, compact = false }: { score: number; level: SpamResult["level"]; label: string; compact?: boolean }) {
  return (
    <div className={`spam-score ${level} ${compact ? "compact" : ""}`}>
      <div className="spam-score-top">
        <strong>{score}</strong>
        <span>/100</span>
        <span className={`pill ${LEVEL_TONE[level]}`}>{label}</span>
      </div>
      <div className="spam-bar" aria-hidden="true">
        <div className="spam-bar-fill" style={{ transform: `scaleX(${(Math.max(score, 3)) / 100})` }} />
      </div>
      {!compact && (
        <div className="spam-scale" aria-hidden="true">
          <span>Safe</span>
          <span>Risky</span>
          <span>Spam</span>
        </div>
      )}
    </div>
  );
}

const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

/** Half-circle gauge of the inbox score (higher is better) */
function ScoreGauge({ result }: { result: SpamResult }) {
  const value = Math.max(result.inbox_score, 2);
  return (
    <div className={`gauge ${result.level}`}>
      <div className="gauge-dial">
        <svg viewBox="0 0 120 68" role="img" aria-label={`Inbox score ${result.inbox_score} out of 100, ${RISK_LABEL[result.risk].toLowerCase()}`}>
          <path className="gauge-track" d="M10 60 A50 50 0 0 1 110 60" pathLength={100} />
          <path className="gauge-fill" d="M10 60 A50 50 0 0 1 110 60" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - value} />
        </svg>
        <div className="gauge-value" aria-hidden="true">
          <strong>{result.inbox_score}</strong>
          <span>Inbox score</span>
        </div>
      </div>
      <div className="gauge-foot">
        <span className={`pill ${LEVEL_TONE[result.level]}`}>{RISK_LABEL[result.risk]}</span>
        <span className="gauge-label">{result.label}</span>
      </div>
    </div>
  );
}

type Item = {
  key: string;
  severity: SpamResult["issues"][number]["severity"];
  points: number;
  title: React.ReactNode;
  meta: React.ReactNode;
  spans: SpamSpan[];
  fix: SpamFix | null;
};

const SHOWN = 5;

const DATA_NOTE = { synthetic: "starter model", proxy: "learned from complaints and bounces", real: "learned from your inbox tests" } as const;

/** What the placement model adds: its own spam probability and the features pushing this email toward spam */
function ModelEstimate({ result }: { result: SpamResult }) {
  const model = result.model;
  if (!model) return null;
  return (
    <div className="model-box">
      <div className="model-head">
        <span className="model-title">
          <BrainCircuit size={14} /> Prediction
        </span>
        <span className="model-meta">{DATA_NOTE[model.label_kind]}</span>
      </div>
      <p className="model-line">
        About <strong>{model.spam_percent}%</strong> chance of landing in spam. The inbox score combines this with the writing checks above.
      </p>
      {model.reasons.length > 0 && (
        <ul className="model-reasons" aria-label="What the model weighs most">
          {model.reasons.map((r) => (
            <li key={r.feature}>{r.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Flagged words and formatting issues as one list, costliest first */
function toItems(result: SpamResult): Item[] {
  return [
    ...result.keywords.map((k) => ({
      key: `kw-${k.location}-${k.phrase}`,
      severity: k.severity,
      points: k.points,
      title: <span className="spam-word">“{k.matched}”</span>,
      meta: (
        <>
          In {k.location === "subject" ? "subject line" : "message"}
          {k.count > 1 ? ` · ${k.count} times` : ""} · {k.category_name}.{" "}
          {k.alternative.startsWith("(") ? "Remove it." : <>Instead: <strong>{k.alternative}</strong></>}
        </>
      ),
      spans: k.spans,
      fix: k.fix,
    })),
    ...result.issues.map((i) => ({
      key: i.id,
      severity: i.severity,
      points: i.points,
      title: (
        <span className="spam-issue">
          <AlertTriangle size={14} /> {i.title}
        </span>
      ),
      meta: i.suggestion,
      spans: i.spans,
      fix: i.fix,
    })),
  ].sort((x, y) => y.points - x.points);
}

export function SpamCheck({
  result,
  loading,
  stale,
  title = "Spam check",
  onFix,
  onShow,
  onOpenGuide,
}: {
  result: SpamResult | null;
  loading: boolean;
  /** The text changed since this result: positions are out of date, so fixes wait for the next check */
  stale: boolean;
  title?: string;
  onFix: (fix: SpamFix) => void;
  onShow: (span: SpamSpan) => void;
  onOpenGuide: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = result ? toItems(result) : [];
  const visible = expanded ? items : items.slice(0, SHOWN);

  return (
    <div className="card spam-card">
      <div className="card-head" style={{ marginBottom: "0.9rem" }}>
        <div>
          <h2 className="card-title">
            <ShieldCheck size={17} /> {title}
          </h2>
          <p className="card-sub">Updates as you write</p>
        </div>
        {loading && <div className="loader small" aria-label="Checking" />}
      </div>

      {!result ? (
        <p className="field-hint">Write a subject and message to see the inbox score.</p>
      ) : (
        <>
          <ScoreGauge result={result} />
          <p className="gauge-note">{result.estimate_note}</p>
          <ModelEstimate result={result} />

          {items.length === 0 ? (
            <div className="spam-clean">
              <CheckCircle2 size={16} /> No spam triggers found
            </div>
          ) : (
            <>
              <h3 className="spam-list-title">{expanded ? `All ${items.length} issues` : `Top ${Math.min(items.length, SHOWN)} reasons`}</h3>
              <ul className="spam-list" aria-live="polite">
                {visible.map((item) => (
                  <li key={item.key} className={`spam-item sev-${item.severity}`}>
                    <div className="spam-item-head">
                      {item.title}
                      <span className={`pill no-dot ${SEVERITY_TONE[item.severity]}`}>{item.severity}</span>
                    </div>
                    <div className="spam-item-meta">{item.meta}</div>
                    {(item.fix || item.spans.length > 0) && (
                      <div className="spam-item-actions">
                        {item.spans.length > 0 && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={stale} onClick={() => onShow(item.spans[0])}>
                            <Crosshair size={13} /> Show
                          </button>
                        )}
                        {item.fix && (
                          <button type="button" className="btn btn-secondary btn-sm act-accent" disabled={stale} onClick={() => onFix(item.fix!)}>
                            <Wand2 size={13} /> {item.fix.label}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {stale && <p className="field-hint spam-stale">Checking your latest changes…</p>}
              {items.length > SHOWN && (
                <button type="button" className="link-btn spam-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                  <ChevronDown size={14} className={expanded ? "flip" : ""} /> {expanded ? "Show fewer" : `Show all ${items.length} issues`}
                </button>
              )}
            </>
          )}

          {!result.stats.personalised && (
            <p className="field-hint" style={{ marginTop: "0.75rem" }}>
              Tip: add <strong>+ First name</strong>. Personal greetings get more opens from business contacts.
            </p>
          )}
        </>
      )}

      <button type="button" className="link-btn" style={{ marginTop: "0.9rem", fontSize: "0.84rem" }} onClick={onOpenGuide}>
        <BookOpen size={13} style={{ verticalAlign: "-2px" }} /> Open the spam word guide
      </button>
    </div>
  );
}
