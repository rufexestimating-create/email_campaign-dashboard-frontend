"use client";

import React, { useEffect, useState } from "react";
import { ArrowRight, Check, Inbox, MailCheck, Send, Users, X } from "lucide-react";
import { TrackingSummary, WarmupStatus, callApi } from "@/lib/insights";

const HIDE_KEY = "getting-started-hidden";

interface Step {
  id: string;
  icon: React.ReactNode;
  title: string;
  text: string;
  done: boolean;
  cta: string;
  onClick: () => void;
}

/** First-run guide on the home page: four plain steps that tick themselves off as the user does them */
export function GettingStarted({
  campaignsCount,
  refreshKey,
  onNewCampaign,
  onOpenWarmup,
  onOpenLeads,
}: {
  campaignsCount: number;
  /** Changes when the dashboard reloads its data, so finished steps tick off without a page refresh */
  refreshKey: number;
  onNewCampaign: () => void;
  /** Left out while the Insights tab is hidden: the two steps done there (test inbox, logging where it landed) drop out */
  onOpenWarmup?: () => void;
  onOpenLeads: () => void;
}) {
  const [hidden, setHidden] = useState(true); // hidden until we know, so it never flashes for people who closed it
  const [seeds, setSeeds] = useState<number | null>(null);
  const [tracking, setTracking] = useState<TrackingSummary | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setHidden(localStorage.getItem(HIDE_KEY) === "1");
      } catch {
        setHidden(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hidden) return;
    const timer = setTimeout(async () => {
      const [w, t] = await Promise.all([callApi<WarmupStatus>("/insights/warmup"), callApi<TrackingSummary>("/insights/tracking-summary")]);
      if (w.data) setSeeds(w.data.seeds.length);
      if (t.data) setTracking(t.data);
    }, 0);
    return () => clearTimeout(timer);
  }, [hidden, refreshKey]);

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {}
  };

  if (hidden) return null;

  const allSteps: (Step | undefined)[] = [
    onOpenWarmup && {
      id: "test-inbox", icon: <Inbox size={18} />, title: "Add your own email as a test inbox",
      text: "You'll get a copy of every campaign, so you can see exactly what your clients see.",
      done: (seeds ?? 0) > 0, cta: "Add test inbox", onClick: onOpenWarmup,
    },
    {
      id: "first-campaign", icon: <Send size={18} />, title: "Write and send your first email",
      text: "Five short steps. The app checks your list and settings and warns you before anything goes out.",
      done: campaignsCount > 0, cta: "Start writing", onClick: onNewCampaign,
    },
    onOpenWarmup && {
      id: "landed", icon: <MailCheck size={18} />, title: "Check where it landed",
      text: "Open your test inbox, then tell the app if it arrived in Inbox, Promotions or Spam.",
      done: (tracking?.usable_labels ?? 0) > 0, cta: "Log where it landed", onClick: onOpenWarmup,
    },
    {
      id: "leads", icon: <Users size={18} />, title: "See who's most interested",
      text: "Everyone you email becomes a lead, ranked by how likely they are to become a client.",
      done: (tracking?.leads ?? 0) > 0, cta: "Open leads", onClick: onOpenLeads,
    },
  ];
  const steps = allSteps.filter((s): s is Step => !!s);
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <section className="gs" aria-labelledby="gs-title">
      <div className="gs-head">
        <div>
          <span className="auth-eyebrow">Getting started</span>
          <h2 id="gs-title">{next ? `Send your first campaign in ${steps.length} steps` : "You're all set"}</h2>
          <p>{next ? "Do them in order. Each one ticks itself off when it's done." : "You've tried everything. You can hide this guide now."}</p>
        </div>
        <div className="gs-progress">
          <strong>{doneCount} of {steps.length}</strong>
          <span className="gs-bar" role="progressbar" aria-label="Getting started progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <i style={{ transform: `scaleX(${doneCount / steps.length})` }} />
          </span>
          <button className="link-btn gs-hide" onClick={hide}><X size={14} /> Hide guide</button>
        </div>
      </div>

      <ol className="gs-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`gs-step ${s.done ? "is-done" : ""} ${next?.id === s.id ? "is-next" : ""}`}>
            <span className="gs-step-mark" aria-hidden="true">{s.done ? <Check size={16} strokeWidth={3} /> : i + 1}</span>
            <div className="gs-step-body">
              <strong>{s.title}</strong>
              <p>{s.text}</p>
              {s.done ? (
                <span className="gs-done">Done</span>
              ) : (
                <button className={`btn btn-sm ${next?.id === s.id ? "btn-primary" : "btn-secondary"}`} onClick={s.onClick}>
                  {s.cta} <ArrowRight size={14} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
