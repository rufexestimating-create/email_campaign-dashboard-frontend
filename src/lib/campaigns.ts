export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused" | "failed";
export type ContentType = "text" | "html";
export type Variant = "A" | "B";

export interface VariantStats {
  total: number;
  sent: number;
  simulated: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  schedule_type: "now" | "once" | "recurring";
  scheduled_at: string | null;
  cron_expression: string | null;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  recipient_count: number;
  ab_enabled: boolean;
  ab_split: number;
  subject_a: string;
  subject_b: string | null;
  last_error: string | null;
  created_at: string;
  variant_stats: Partial<Record<Variant, VariantStats>>;
  /** Automated follow-ups: how many steps, and follow-up emails by status (null if they couldn't be loaded) */
  follow_ups?: FollowUpCounts | null;
  send_speed?: SendSpeed;
  /** Set when sending stopped by itself (bounces or spam complaints) */
  paused_reason?: string | null;
  /** The run in progress (sending or paused partway); null otherwise */
  progress?: SendProgress | null;
}

export type SendSpeed = "safe" | "normal" | "fast";

export interface SendProgress {
  total: number;
  sent: number;
  failed: number;
  queued: number;
  next_send_at: string | null;
}

/** Seconds between two emails, matching the backend's pacing.SPEEDS */
export const SEND_SPEEDS: { id: SendSpeed; title: string; text: string; gap: [number, number] }[] = [
  { id: "safe", title: "Safe", text: "One email every 15–30 seconds. Best for your domain's reputation.", gap: [15, 30] },
  { id: "normal", title: "Normal", text: "One email every 5–10 seconds.", gap: [5, 10] },
  { id: "fast", title: "All at once", text: "Only for small lists. Big bursts can get you blocked.", gap: [0, 0] },
];

/** Rough time to send `count` emails at a speed, e.g. "about 35 minutes" */
export function sendDuration(count: number, speed: SendSpeed): string {
  const [lo, hi] = SEND_SPEEDS.find((s) => s.id === speed)?.gap ?? [0, 0];
  const seconds = Math.max(count - 1, 0) * ((lo + hi) / 2);
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export interface FollowUpCounts {
  steps: number;
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
}

/** One follow-up email in the composer; the wait is counted from the previous email (minutes for short ones) */
export interface FollowUpDraft {
  wait_days: number;
  wait_minutes?: number;
  subject: string;
  body: string;
}

/** The wait choices: short ones (for trying it out) go right after the wait, day ones at the person's best time */
export const FOLLOW_UP_WAITS: { id: string; label: string; short: string; wait_days: number; wait_minutes?: number }[] = [
  { id: "m1", label: "1 minute (to test it now)", short: "1 minute", wait_days: 0, wait_minutes: 1 },
  { id: "m10", label: "10 minutes", short: "10 minutes", wait_days: 0, wait_minutes: 10 },
  { id: "m60", label: "1 hour", short: "1 hour", wait_days: 0, wait_minutes: 60 },
  ...[1, 2, 3, 4, 5, 7, 10, 14].map((d) => ({ id: `d${d}`, label: d === 1 ? "1 day" : `${d} days`, short: d === 1 ? "1 day" : `${d} days`, wait_days: d })),
];
export const waitOf = (f: Pick<FollowUpDraft, "wait_days" | "wait_minutes">) =>
  FOLLOW_UP_WAITS.find((w) => (f.wait_minutes ? w.wait_minutes === f.wait_minutes : !w.wait_minutes && w.wait_days === f.wait_days)) ?? FOLLOW_UP_WAITS[0];
export const MAX_FOLLOW_UPS = 2;

export interface CampaignLog {
  id: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "simulated";
  variant: Variant | null;
  last_event: string | null;
  error: string | null;
  sent_at: string;
}

export interface Recipient {
  email: string;
  name?: string;
  variables: Record<string, string>;
}

export interface Template {
  id?: string;
  name: string;
  subject: string;
  body: string;
  content_type: ContentType;
  builtin?: boolean;
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

export const isEmail = (value: string) => EMAIL_RE.test(value.trim());

/** Same key format the backend uses for {{placeholders}}: "Company Name" -> "company_name" */
export const normalizeKey = (key: string) =>
  key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

/** Paste box: one address per line, or comma/semicolon separated. Accepts "Jane Doe <jane@x.com>". */
export function parsePasted(text: string): { recipients: Recipient[]; invalid: string[] } {
  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const named = token.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    const email = (named ? named[2] : token).trim();
    if (isEmail(email)) recipients.push({ email, name: named?.[1].trim() || undefined, variables: {} });
    else invalid.push(token);
  }
  return { recipients, invalid };
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const delimiter = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** CSV upload: needs a header row with an email column. Name columns fill {{name}}; every other column becomes a {{placeholder}}. */
export function parseCsv(text: string): { recipients: Recipient[]; invalid: string[]; columns: string[]; error?: string } {
  const rows = splitCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return { recipients: [], invalid: [], columns: [], error: "The CSV needs a header row and at least one data row." };

  const header = rows[0].map((h) => h.trim());
  const keys = header.map(normalizeKey);
  let emailIdx = keys.findIndex((k) => /^e_?mail(_address)?$/.test(k) || k === "email");
  if (emailIdx < 0) emailIdx = rows[1].findIndex((v) => isEmail(v));
  if (emailIdx < 0) return { recipients: [], invalid: [], columns: [], error: 'No email column found. Add a header named "email".' };

  const nameIdx = keys.findIndex((k) => k === "name" || k === "full_name");
  const firstIdx = keys.findIndex((k) => k === "first_name" || k === "firstname");
  const lastIdx = keys.findIndex((k) => k === "last_name" || k === "lastname");

  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  for (const row of rows.slice(1)) {
    const email = (row[emailIdx] ?? "").trim();
    if (!isEmail(email)) {
      if (email) invalid.push(email);
      continue;
    }
    const variables: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (i !== emailIdx && k && row[i] !== undefined) variables[k] = row[i].trim();
    });
    const name =
      (nameIdx >= 0 ? row[nameIdx] : [firstIdx >= 0 ? row[firstIdx] : "", lastIdx >= 0 ? row[lastIdx] : ""].join(" "))?.trim() ||
      undefined;
    recipients.push({ email, name, variables });
  }
  return { recipients, invalid, columns: keys.filter((k, i) => k && i !== emailIdx) };
}

/** Merges recipient lists, de-duplicating by email (case-insensitive). */
export function mergeRecipients(...lists: Recipient[][]): { recipients: Recipient[]; duplicates: number } {
  const byEmail = new Map<string, Recipient>();
  let duplicates = 0;
  for (const r of lists.flat()) {
    const key = r.email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      duplicates++;
      byEmail.set(key, { email: existing.email, name: existing.name || r.name, variables: { ...r.variables, ...existing.variables } });
    } else byEmail.set(key, r);
  }
  return { recipients: [...byEmail.values()], duplicates };
}

/** Client-side preview of {{placeholder}} replacement (mirrors the backend). */
export function renderPreview(template: string, r?: Recipient): string {
  const name = r?.name ?? "";
  const values: Record<string, string> = {
    ...(r?.variables ?? {}),
    email: r?.email ?? "",
    name,
    first_name: name.split(/\s+/)[0] ?? "",
  };
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => values[key.toLowerCase()] ?? "");
}

/** For display only: "Hi {{first_name}}" -> "Hi [First name]" */
export function humanizeTags(text: string): string {
  return text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => {
    const k = key.toLowerCase();
    const label = k === "first_name" ? "First name" : k === "name" ? "Full name" : k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    return `[${label}]`;
  });
}

export const STARTER_TEMPLATES: Template[] = [
  {
    name: "Welcome",
    builtin: true,
    content_type: "text",
    subject: "Welcome aboard, {{first_name}}!",
    body: "Hi {{first_name}},\n\nThanks for joining us. We're glad to have you.\n\nIf you have any questions, just reply to this email.\n\nCheers,\nThe Team",
  },
  {
    name: "Monthly newsletter",
    builtin: true,
    content_type: "text",
    subject: "What's new this month",
    body: "Hi {{first_name}},\n\nHere's a quick roundup of what we shipped this month:\n\n- Feature one\n- Feature two\n- Feature three\n\nThanks for reading!",
  },
  {
    name: "Product launch",
    builtin: true,
    content_type: "html",
    subject: "{{first_name}}, it's finally here",
    body: '<h2>Say hello to our newest feature</h2>\n<p>Hi {{first_name}},</p>\n<p>We just launched something we think you\'ll love.</p>\n<p><a href="https://example.com" style="background:#C2410C;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">See what\'s new</a></p>',
  },
  {
    name: "Follow-up",
    builtin: true,
    content_type: "text",
    subject: "Quick follow-up, {{first_name}}",
    body: "Hi {{first_name}},\n\nJust following up on my last email. Do you have 15 minutes this week for a quick call?\n\nBest,\n",
  },
];

// ---------- Repeat schedules (stored as cron expressions, shown in plain words) ----------

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly";
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function buildCron(freq: Frequency, time: string, weekday: number, monthDay: number): string {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10) || 0);
  if (freq === "daily") return `${m} ${h} * * *`;
  if (freq === "weekdays") return `${m} ${h} * * 1-5`;
  if (freq === "weekly") return `${m} ${h} * * ${weekday}`;
  return `${m} ${h} ${monthDay} * *`;
}

const formatTime = (h: number, m: number) =>
  new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "0 9 * * 1" -> "Every Monday at 9:00 AM" */
export function describeCron(cron: string | null): string {
  const parts = (cron ?? "").trim().split(/\s+/);
  if (parts.length !== 5 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || parts[3] !== "*") return "Custom repeat schedule";
  const [m, h, dom, , dow] = parts;
  const at = formatTime(Number(h), Number(m));
  if (dom === "*" && dow === "*") return `Every day at ${at}`;
  if (dom === "*" && dow === "1-5") return `Every weekday at ${at}`;
  if (dom === "*" && /^[0-6]$/.test(dow)) return `Every ${WEEKDAYS[Number(dow)]} at ${at}`;
  if (dow === "*" && /^\d+$/.test(dom)) return `Monthly on the ${ordinal(Number(dom))} at ${at}`;
  return "Custom repeat schedule";
}

// ---------- Friendly wording ----------

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending…",
  sent: "Sent",
  paused: "Paused",
  failed: "Didn't send",
};

const EVENT_LABELS: Record<string, string> = {
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  replied: "Replied",
  bounced: "Bounced",
  complained: "Marked as spam",
  delivery_delayed: "Delayed",
  sent: "Sent",
  queued: "Sent",
  scheduled: "Sent",
};

/** Label + tone for a single sent email */
export function emailStatus(status: string, lastEvent?: string | null): { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" } {
  if (status === "failed") return { label: "Not sent", tone: "danger" };
  if (status === "simulated") return { label: "Test only", tone: "neutral" };
  const label = (lastEvent && EVENT_LABELS[lastEvent]) || "Sent";
  if (lastEvent === "bounced" || lastEvent === "complained") return { label, tone: "danger" };
  if (lastEvent === "opened" || lastEvent === "clicked" || lastEvent === "replied") return { label, tone: "success" };
  if (lastEvent === "delivered") return { label, tone: "success" };
  if (lastEvent === "delivery_delayed") return { label, tone: "warning" };
  return { label, tone: "info" };
}

/** Turns raw email-provider errors into something a non-technical user understands. */
export function friendlyError(message: string | null | undefined): string {
  const msg = message ?? "";
  if (/testing email|own email address|use our testing/i.test(msg))
    return "Test mode: this address can't receive emails until your domain is verified.";
  if (/domain.*not verified|verify.*domain/i.test(msg)) return "Your sending domain isn't verified yet.";
  if (/rate limit|too many requests/i.test(msg)) return "Sending too fast. Please try again in a minute.";
  if (/daily.*quota|quota/i.test(msg)) return "Daily sending limit reached. Sending continues tomorrow.";
  if (/All \d+ emails failed/i.test(msg)) return "None of the emails could be sent. Open the campaign to see why.";
  if (/RESEND_API_KEY/i.test(msg)) return "Email service isn't connected yet, so this was a test run only.";
  return msg;
}

export const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const SAMPLE_CSV = "email,name,company\njane@example.com,Jane Doe,Acme Inc\njohn@example.com,John Smith,Globex\n";

/** A file where every person has their own subject and message (one row each) */
export const SAMPLE_PERSONAL_CSV =
  "email,name,subject,message\n" +
  'jane@example.com,Jane Doe,Ideas for your kitchen,"Hi Jane,\n\nI saw your kitchen plans and have a few ideas that could save you time. Can I send them over?\n\nThanks"\n' +
  'john@example.com,John Smith,Drawings for the new office,"Hi John,\n\nWe can have the first drawings for your office ready by Friday. Does that work for you?\n\nBest"\n';

/** Spreadsheet columns read as a person's own subject / message ("Subject", "Email subject", "Message", "Body"...) */
export const SUBJECT_COLUMNS = ["subject", "email_subject", "subject_line"];
export const MESSAGE_COLUMNS = ["message", "body", "email_body", "email_message", "email_text", "text"];

/** Each person's own subject and message from their spreadsheet row, keyed by lower-case address */
export function ownFromCsv(recipients: Recipient[], columns: string[]): Record<string, { subject: string; body: string }> {
  const subjectKey = SUBJECT_COLUMNS.find((k) => columns.includes(k));
  const bodyKey = MESSAGE_COLUMNS.find((k) => columns.includes(k));
  const out: Record<string, { subject: string; body: string }> = {};
  if (!subjectKey && !bodyKey) return out;
  for (const r of recipients) {
    const subject = (subjectKey ? r.variables[subjectKey] : "")?.trim() ?? "";
    const body = (bodyKey ? r.variables[bodyKey] : "")?.trim() ?? "";
    if (subject || body) out[r.email.toLowerCase()] = { subject, body };
  }
  return out;
}
