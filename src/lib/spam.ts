export type Severity = "high" | "medium" | "low";
export type SpamLevel = "good" | "fair" | "poor";
export type SpamField = "subject" | "body";

/** Character range in the subject or body exactly as the user typed it */
export interface SpamSpan {
  field: SpamField;
  start: number;
  end: number;
}

/** One-click fix: replace each range with `text` (the server sends them last-to-first) */
export interface SpamFix {
  label: string;
  edits: (SpamSpan & { text: string })[];
}

export interface SpamKeywordHit {
  phrase: string;
  matched: string;
  location: SpamField;
  severity: Severity;
  alternative: string;
  category_name: string;
  why: string;
  count: number;
  points: number;
  spans: SpamSpan[];
  fix: SpamFix | null;
}

export interface SpamIssue {
  id: string;
  severity: Severity;
  location: SpamField;
  title: string;
  suggestion: string;
  points: number;
  spans: SpamSpan[];
  fix: SpamFix | null;
}

/** The trained placement model's view of the email (null when no model is saved on the server) */
export interface SpamModel {
  probability: number;
  spam_percent: number;
  version: number;
  data_source: "real" | "synthetic";
  /** synthetic = demo data, proxy = partly complaints/bounces, real = seed tests only */
  label_kind: "real" | "proxy" | "synthetic";
  /** Share of the final score that comes from the model; the rest is the rule score */
  weight: number;
  reasons: { feature: string; label: string; impact: number }[];
}

export interface SpamResult {
  /** Final spam score: rules and model blended when a model is available */
  score: number;
  inbox_score: number;
  level: SpamLevel;
  risk: "low" | "medium" | "high";
  label: string;
  estimate_note: string;
  rule_score?: number;
  model?: SpamModel | null;
  placement_label?: "Estimated placement" | "Predicted placement";
  highlights: (SpamSpan & { severity: Severity; ref: string })[];
  keywords: SpamKeywordHit[];
  issues: SpamIssue[];
  stats: { subject_length: number; word_count: number; links: number; personalised: boolean };
}

export interface KnowledgeKeyword {
  id?: string;
  phrase: string;
  severity: Severity;
  alternative: string;
  category: string;
  category_name: string;
  why: string;
  source: "builtin" | "custom";
}

export interface AudienceRole {
  role: string;
  cares_about: string;
  how_to_write: string;
  good_subject: string;
  avoid_subject: string;
  best_time: string;
}

export interface Knowledge {
  categories: { id: string; name: string; why: string; industry: boolean }[];
  keywords: KnowledgeKeyword[];
  audience_guide: AudienceRole[];
  vocabulary: string[];
  best_practices: string[];
}

export const SEVERITY_LABEL: Record<Severity, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
export const SEVERITY_TONE: Record<Severity, string> = { high: "tone-danger", medium: "tone-warning", low: "tone-neutral" };
export const LEVEL_TONE: Record<SpamLevel, string> = { good: "tone-success", fair: "tone-warning", poor: "tone-danger" };

/** Applies a server fix. Only valid on the exact text that was checked, so callers disable fixes while a check is stale. */
export function applyFix<T extends Record<SpamField, string>>(content: T, fix: SpamFix): T {
  const next = { ...content };
  for (const e of [...fix.edits].sort((x, y) => y.start - x.start)) {
    next[e.field] = (next[e.field].slice(0, e.start) + e.text + next[e.field].slice(e.end)) as T[SpamField];
  }
  return next;
}
