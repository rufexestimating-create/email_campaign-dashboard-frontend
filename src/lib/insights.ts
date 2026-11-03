import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import type { SpamFix, SpamResult } from "@/lib/spam";

/** GET (no body) or POST (with body) to the API; never throws, so each panel can show its own error */
export async function callApi<T>(path: string, body?: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await apiFetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
    const json = await res.json();
    return res.ok ? { data: json as T, error: null } : { data: null, error: errorMessage(json, "That didn't work. Please try again.") };
  } catch {
    return { data: null, error: NETWORK_ERROR };
  }
}

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** "a@x.com, b@y.com\nc@z.com" -> unique lower-case addresses */
export const parseEmails = (text: string) => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

// ---------- Tracking data ----------

export interface TrackingSummary {
  leads: number;
  leads_with_persona: number;
  leads_with_timezone: number;
  events: Record<"delivered" | "opened" | "clicked" | "replied" | "bounced" | "complained", number>;
  placement_labels: Record<string, number>;
  usable_labels: number;
}

export interface Lead {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  persona: string | null;
  zip: string | null;
  state: string | null;
  timezone: string | null;
}

// ---------- Spam / placement model ----------

export interface ModelInfo {
  available: boolean;
  version?: number;
  trained_at?: string;
  data_source?: "real" | "synthetic";
  label_kind?: "real" | "proxy" | "synthetic";
  weight?: number | null;
  warning?: string | null;
  note?: string;
  label?: string;
  rows?: { total: number; train: number; test: number; train_spam_rate: number };
  split?: { method: string; test_fraction: number; train_until: string; test_from: string | null };
  metrics?: { roc_auc: number | null; pr_auc: number | null; brier: number | null; test_rows: number; test_spam_rate: number | null };
  model_spec?: { estimator: string; calibration: string; text_features: string; numeric_features: string[] };
  top_coefficients?: { toward_spam: { feature: string; coefficient: number }[]; toward_inbox: { feature: string; coefficient: number }[] };
}

// ---------- Send times ----------

export interface HeatCell {
  grid: number[][];
  clicks: number;
  replies: number;
}

export interface SendTimeInsights {
  days: number;
  engagement_events: number;
  clicks: number;
  replies: number;
  timezone_assumed: number;
  default_timezone: string;
  heatmaps: Record<string, Record<string, HeatCell>>;
  /** next_at: the next window start; open_now: the window is open right now (in US Eastern time for unknown locations) */
  windows: Record<string, { learned: boolean; label: string; events: number; why: string | null; next_at: string; open_now: boolean }>;
  lead_profiles: Record<string, { events: number; confidence: string; window_label: string; main_device: string | null; timezone: string }>;
  reply_delay: { replies_measured: number; median_hours: number | null; follow_up_after_hours: number | null };
  thresholds: { lead_profile_events: number; persona_events: number; slow_reply_hours: number };
  note: string;
}

export interface SendPlanRow {
  recipient: string;
  persona: string;
  timezone: string;
  timezone_known: boolean;
  window: string;
  source: "lead_profile" | "persona_history" | "default";
  confidence: string;
  why: string;
  /** Their best window is open right now, so send_at is now */
  open_now: boolean;
  send_at_local: string;
  send_at_utc: string;
  follow_up_after_hours: number | null;
  follow_up_note: string | null;
}

// ---------- Deliverability checks (preflight) ----------

export type CheckStatus = "pass" | "warn" | "fail";

export type PreflightAction =
  | { type: "remove_recipients"; emails: string[]; label: string }
  | { type: "schedule_at"; at: string; label: string }
  | { type: "apply_fix"; version: "A" | "B"; fix: SpamFix; label: string };

export interface PreflightCheck {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  detail: string;
  action: PreflightAction | null;
  data: Record<string, unknown>;
}

export interface PreflightResult {
  verdict: CheckStatus;
  counts: Record<CheckStatus, number>;
  recipient_count: number;
  checks: PreflightCheck[];
  spam: Partial<Record<"A" | "B", SpamResult>>;
  note: string;
}

// ---------- Domain warm-up ----------

export interface SeedInbox {
  id: string;
  email: string;
  provider: "gmail" | "outlook" | "yahoo" | "icloud" | "other";
  created_at: string;
}

export interface WarmupStatus {
  enabled: boolean;
  /** Current warm-up week, or null when off / not started */
  week: number | null;
  limit: number;
  warming: boolean;
  days_left?: number;
  schedule: { week: number; from: string; per_day: number; current: boolean; full?: boolean }[];
  sent_today: number;
  remaining_today: number;
  account_limit: number;
  start_date: string;
  seeds_enabled: boolean;
  seeds: SeedInbox[];
  seed_limit: number;
}

// ---------- Pre-send review history ----------

export interface PreflightDecision {
  id: string;
  campaign_id: string | null;
  verdict: CheckStatus;
  checks: { id: string; status: CheckStatus; message: string }[];
  accepted: string[];
  ignored: string[];
  overridden: boolean;
  override_reason: string | null;
  outcome: "sent" | "scheduled" | "cancelled";
  created_at: string;
}

export interface DecisionLog {
  summary: { decisions: number; overridden: number; cancelled: number; per_check: Record<string, { accepted: number; ignored: number }> };
  decisions: PreflightDecision[];
}

export const CHECK_NAMES: Record<string, string> = {
  audience_health: "Audience health",
  send_time: "Send time",
  frequency_fatigue: "Frequency fatigue",
  gmail_domain_risk: "Gmail domain risk",
  volume_spike: "Volume spike",
  predicted_placement: "Predicted placement",
  authentication: "SPF / DKIM / DMARC",
  content_fit: "Content fit",
};

// ---------- Lead scoring ----------

export type LifecycleStage = "new" | "mql" | "sql" | "customer" | "lost";
export type ScoreBand = "sales" | "nurture" | "awareness";

export interface ScoredLead {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  persona: string | null;
  lifecycle_stage: LifecycleStage;
  p_reply: number | null;
  p_mql: number | null;
  p_sql: number | null;
  score_band: ScoreBand | null;
  segment: string | null;
  scored_at: string | null;
  score_version: string | null;
  created_at?: string;
  /** Campaign emails this contact received, the last one, and the best thing that happened across them */
  emails_sent: number;
  last_sent_at: string | null;
  engagement: Engagement;
}

export type Engagement = "replied" | "clicked" | "opened" | "delivered" | "sent" | "bounced" | "complained" | "none";

type ModelScores = { pr_auc: number | null; roc_auc: number | null };
export interface LeadComparison {
  features: string[];
  positives_train: number;
  positives_test: number;
  logistic_regression: ModelScores;
  lightgbm?: ModelScores;
  hist_gradient_boosting?: ModelScores;
  winner: "logistic_regression" | "lightgbm" | "hist_gradient_boosting";
  explanations: "shap" | "coefficients" | "none";
}

export interface LeadScoresOverview {
  leads: ScoredLead[];
  bands: Record<string, number>;
  segments: Record<string, number>;
  alerts: ScoredLead[];
  thresholds: { sales: number; nurture: number };
  model: { version: number; data_source: "real" | "synthetic"; trained_at: string; comparison: Record<"reply" | "mql" | "sql", LeadComparison>; warning: string | null; gbm_library: string } | null;
  last_scored: string | null;
}

export const BAND_INFO: Record<ScoreBand, { label: string; tone: string; action: string }> = {
  sales: { label: "Sales-ready", tone: "tone-success", action: "Over 60% likely to become a sales opportunity. Contact them now." },
  nurture: { label: "Nurture", tone: "tone-warning", action: "30–60% likely. Keep them warm with useful follow-ups." },
  awareness: { label: "Awareness", tone: "tone-neutral", action: "Under 30% likely. Share general news and case studies." },
};

export const MODEL_NAMES: Record<string, string> = {
  logistic_regression: "Logistic regression",
  lightgbm: "LightGBM",
  hist_gradient_boosting: "Gradient boosting (scikit-learn)",
};

export const STATUS_TONE: Record<CheckStatus, string> = { pass: "tone-success", warn: "tone-warning", fail: "tone-danger" };
export const STATUS_LABEL: Record<CheckStatus, string> = { pass: "Pass", warn: "Warn", fail: "Fail" };
