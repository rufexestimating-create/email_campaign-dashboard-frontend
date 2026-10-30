"use client";

import React, { useState } from "react";
import { Activity, BrainCircuit, Clock, ClipboardCheck, Flame, LayoutGrid, ShieldCheck } from "lucide-react";
import type { CampaignDraft } from "@/components/dashboard/CampaignComposer";
import { DeliverabilityPanel } from "./DeliverabilityPanel";
import { InsightsOverview } from "./InsightsOverview";
import { ModelsPanel } from "./ModelsPanel";
import { ReviewHistoryPanel } from "./ReviewHistoryPanel";
import { SendTimesPanel } from "./SendTimesPanel";
import { TrackingPanel } from "./TrackingPanel";
import { WarmupPanel } from "./WarmupPanel";

export type InsightsSection = "overview" | "send-times" | "deliverability" | "warmup" | "reviews" | "engagement" | "models";

// Plain names: each tab says what it helps you do, not what it is technically
const SECTIONS: { id: InsightsSection; label: string; icon: React.ReactNode; intro?: string }[] = [
  { id: "overview", label: "Overview", icon: <LayoutGrid size={16} /> },
  { id: "send-times", label: "Best time to send", icon: <Clock size={16} />,
    intro: "When each kind of contact is most likely to read and answer your email." },
  { id: "deliverability", label: "Inbox check", icon: <ShieldCheck size={16} />,
    intro: "Check any email and recipient list before you send it. Nothing is sent." },
  { id: "warmup", label: "Warm-up", icon: <Flame size={16} />,
    intro: "Grow your sending slowly so Gmail and Outlook learn to trust arvistry.com, and check where emails land." },
  { id: "reviews", label: "Review history", icon: <ClipboardCheck size={16} />,
    intro: "The checks shown before each campaign was sent, and which advice your team followed." },
  { id: "engagement", label: "Tracking", icon: <Activity size={16} />,
    intro: "What's been tracked so far. Log replies and inbox tests here; they make every prediction more accurate." },
  { id: "models", label: "Prediction quality", icon: <BrainCircuit size={16} />,
    intro: "How reliable the inbox and lead predictions are, and what they've learned." },
];

export function InsightsPage({
  initialSection,
  defaultFrom,
  notify,
  onNewCampaign,
  onUseDraft,
  spamEnabled,
}: {
  /** false while the spam detector is moving to its own app: spam scores and the spam model are hidden */
  spamEnabled: boolean;
  /** Opens a specific section, e.g. from the Leads page's "How scoring works" link; otherwise the Overview */
  initialSection?: InsightsSection;
  defaultFrom: string;
  notify: (msg: string, isError?: boolean) => void;
  onNewCampaign: () => void;
  /** Opens New campaign filled in with a draft (from the inbox check or the send-time planner) */
  onUseDraft: (draft: CampaignDraft) => void;
}) {
  // Always start on the Overview, so anyone opening Insights sees what it can do before any tool
  const [section, setSection] = useState<InsightsSection>(initialSection ?? "overview");
  const open = (id: InsightsSection) => {
    setSection(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const intro = section === "models" && !spamEnabled
    ? "How reliable the lead predictions are, and what they've learned."
    : SECTIONS.find((s) => s.id === section)!.intro;

  return (
    <div>
      <nav className="ins-tabs" aria-label="Insights sections">
        {SECTIONS.map((s) => (
          <button key={s.id} aria-current={section === s.id ? "page" : undefined} className={`ins-tab ${section === s.id ? "active" : ""}`} onClick={() => open(s.id)}>
            {s.icon}
            {s.label}
          </button>
        ))}
      </nav>
      {intro && <p className="ins-tab-intro">{intro}</p>}
      {section === "overview" && <InsightsOverview open={open} onNewCampaign={onNewCampaign} />}
      {section === "send-times" && <SendTimesPanel onNewCampaign={onNewCampaign} onUseDraft={onUseDraft} />}
      {section === "deliverability" && <DeliverabilityPanel defaultFrom={defaultFrom} onUseDraft={onUseDraft} spamEnabled={spamEnabled} />}
      {section === "warmup" && <WarmupPanel notify={notify} />}
      {section === "reviews" && <ReviewHistoryPanel onNewCampaign={onNewCampaign} />}
      {section === "engagement" && <TrackingPanel notify={notify} />}
      {section === "models" && <ModelsPanel spamEnabled={spamEnabled} />}
    </div>
  );
}
