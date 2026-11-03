"use client";

import React, { useEffect, useState } from "react";
import { Activity, ArrowRight, BrainCircuit, ClipboardCheck, Clock, Flame, Inbox, Send, ShieldCheck } from "lucide-react";
import { DecisionLog, LeadScoresOverview, ModelInfo, SendTimeInsights, TrackingSummary, callApi } from "@/lib/insights";
import type { InsightsSection } from "./InsightsPage";

const AUDIENCE_NAME: Record<string, string> = { contractor: "contractors", architect: "architects", homeowner: "homeowners", other: "business contacts" };
const quality = (v: number | null | undefined) => (v == null ? "Not measured" : v >= 0.85 ? "Strong" : v >= 0.7 ? "Good" : v >= 0.55 ? "Fair" : "Weak");
const formatNext = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });

interface Live {
  sendTime: SendTimeInsights | null;
  tracking: TrackingSummary | null;
  model: ModelInfo | null;
  leads: LeadScoresOverview | null;
  reviews: DecisionLog | null;
}

/** Insights start page: three numbers at a glance, then one card per question people actually have */
/** `spamEnabled` false: "Predictions" means the lead scoring model (the spam model is moving to its own app) */
export function InsightsOverview({ open, onNewCampaign, spamEnabled }: { open: (s: InsightsSection) => void; onNewCampaign: () => void; spamEnabled: boolean }) {
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const [sendTime, tracking, model, leads, reviews] = await Promise.all([
        callApi<SendTimeInsights>("/insights/send-time"),
        callApi<TrackingSummary>("/insights/tracking-summary"),
        spamEnabled ? callApi<ModelInfo>("/insights/model") : Promise.resolve({ data: null, error: null }),
        spamEnabled ? Promise.resolve({ data: null, error: null }) : callApi<LeadScoresOverview>("/leads/scores"),
        callApi<DecisionLog>("/campaign/preflight/decisions?limit=1"),
      ]);
      setLive({ sendTime: sendTime.data, tracking: tracking.data, model: model.data, leads: leads.data, reviews: reviews.data });
    }, 0);
    return () => clearTimeout(timer);
  }, [spamEnabled]);

  // At a glance
  const windows = live?.sendTime ? Object.entries(live.sendTime.windows) : [];
  const openNow = windows.filter(([, w]) => w.open_now).map(([p]) => AUDIENCE_NAME[p] ?? p);
  const soonest = windows.map(([, w]) => w.next_at).sort()[0];
  const ev = live?.tracking?.events;
  const tracked = ev ? ev.delivered + ev.opened + ev.clicked + ev.replied : 0;
  const reviews = live?.reviews?.summary.decisions ?? 0;
  // Spam detector off: judge the lead scoring model on its main question (will this lead become a sales opportunity)
  const sql = live?.leads?.model?.comparison.sql;
  const sqlUsed = sql && (sql.winner === "logistic_regression" ? sql.logistic_regression : sql.lightgbm ?? sql.hist_gradient_boosting);
  const modelWord = spamEnabled
    ? live?.model?.available ? quality(live.model.metrics?.roc_auc) : "Not set up"
    : live?.leads?.model ? quality(sqlUsed?.pr_auc) : "Not set up";
  const starterModel = spamEnabled ? live?.model?.data_source === "synthetic" : live?.leads?.model?.data_source === "synthetic";

  const cards: { id: InsightsSection; icon: React.ReactNode; question: string; text: string; hint: string; cta: string }[] = [
    {
      id: "send-times", icon: <Clock size={20} />, question: "When should I send?",
      text: "The best day and hour to reach contractors, architects, homeowners and everyone else.",
      hint: openNow.length ? `Good time right now for ${openNow.join(" and ")}` : soonest ? `Next good time: ${formatNext(soonest)}` : "Industry best practice",
      cta: "See best times",
    },
    {
      id: "deliverability", icon: <ShieldCheck size={20} />, question: "Will my email reach the inbox?",
      text: "Paste a list and a message to get an instant pre-send check, with one-click fixes.",
      hint: "Takes about 5 seconds",
      cta: "Check an email",
    },
    {
      id: "warmup", icon: <Flame size={20} />, question: "Is my domain warmed up?",
      text: "A daily sending limit that grows each week, plus your own test inboxes to see where emails land.",
      hint: "Recommended for new domains",
      cta: "Open warm-up plan",
    },
    {
      id: "reviews", icon: <ClipboardCheck size={20} />, question: "What happened before each send?",
      text: "The checks shown before every campaign, and which advice your team followed.",
      hint: reviews ? `${reviews} review${reviews === 1 ? "" : "s"} so far` : "Fills in after your next campaign",
      cta: "See review history",
    },
    {
      id: "engagement", icon: <Activity size={20} />, question: "What has been tracked?",
      text: "Deliveries, opens, clicks and replies. Log replies and inbox tests here.",
      hint: tracked ? `${tracked.toLocaleString()} events tracked` : "No events yet",
      cta: "See tracking",
    },
    {
      id: "models", icon: <BrainCircuit size={20} />, question: "How reliable are the predictions?",
      text: spamEnabled ? "How accurate the inbox and lead predictions are, explained in plain words." : "How accurate the lead predictions are, explained in plain words.",
      hint: `Prediction quality: ${modelWord}`,
      cta: "See prediction quality",
    },
  ];

  return (
    <div className="lab-stack">
      <section className="io-hero">
        <div className="io-hero-text">
          <span className="auth-eyebrow">Insights</span>
          <h2>Send at the right time, and make sure every email lands.</h2>
          <p>Pick a question below. Everything here is also used automatically when you send a campaign.</p>
          <button className="btn btn-secondary" onClick={onNewCampaign}><Send size={15} /> New campaign</button>
        </div>
        <div className="io-glance" aria-label="At a glance">
          <div>
            <span><Clock size={14} /> Send timing</span>
            <strong>{!live ? "…" : openNow.length ? "Good time now" : soonest ? formatNext(soonest) : "—"}</strong>
            <em>{openNow.length ? `for ${openNow.join(", ")}` : "next good window"}</em>
          </div>
          <div>
            <span><Inbox size={14} /> Emails tracked</span>
            <strong>{!live ? "…" : tracked.toLocaleString()}</strong>
            <em>{live?.tracking ? `${live.tracking.usable_labels} inbox tests logged` : "deliveries, opens, clicks"}</em>
          </div>
          <div>
            <span><BrainCircuit size={14} /> Predictions</span>
            <strong>{!live ? "…" : modelWord}</strong>
            <em>{starterModel ? "starter model" : spamEnabled ? "learned from your data" : "lead scoring"}</em>
          </div>
        </div>
      </section>

      <div className="io-cards">
        {cards.map((c) => (
          <button key={c.id} className="io-card" onClick={() => open(c.id)}>
            <span className="io-card-icon">{c.icon}</span>
            <strong>{c.question}</strong>
            <p>{c.text}</p>
            <span className="io-card-hint">{live ? c.hint : "Loading…"}</span>
            <span className="io-card-cta">{c.cta} <ArrowRight size={15} /></span>
          </button>
        ))}
      </div>

      <section className="io-guide" aria-label="How to get the most out of Insights">
        <h3>New here? Three steps</h3>
        <ol>
          <li><span>1</span><div><strong>Check your email</strong><p>Run the inbox check on your next message and use the fix buttons.</p></div></li>
          <li><span>2</span><div><strong>Send at the best time</strong><p>Schedule it for the time suggested for your audience.</p></div></li>
          <li><span>3</span><div><strong>Log replies and inbox tests</strong><p>Every reply you log makes the timing and predictions more accurate.</p></div></li>
        </ol>
      </section>
    </div>
  );
}
