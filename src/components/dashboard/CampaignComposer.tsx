"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  Info,
  Pencil,
  Repeat,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import {
  ContentType,
  FollowUpDraft,
  Frequency,
  Recipient,
  SAMPLE_CSV,
  SAMPLE_PERSONAL_CSV,
  SEND_SPEEDS,
  SendSpeed,
  Template,
  WEEKDAYS,
  buildCron,
  describeCron,
  formatDateTime,
  humanizeTags,
  isEmail,
  mergeRecipients,
  ownFromCsv,
  parseCsv,
  parsePasted,
  renderPreview,
  sendDuration,
} from "@/lib/campaigns";
import { SpamFix, SpamResult, SpamSpan, applyFix } from "@/lib/spam";
import { PreflightAction, PreflightResult } from "@/lib/insights";
import { SpamCheck } from "./SpamCheck";
import { HighlightBox } from "./HighlightBox";
import { FollowUpsEditor } from "./FollowUpsEditor";
import { PreflightDialog } from "./PreflightDialog";

/** Identifies the exact text a spam check ran on */
const checkKey = (type: ContentType, c: { subject: string; body: string }) => `${type}\u0000${c.subject}\u0000${c.body}`;

type ScheduleType = "now" | "once" | "recurring";
type Version = "A" | "B";
type FieldName = "subject" | "body";
export type SendingMode = "live" | "test" | "off";

interface Props {
  templates: Template[];
  defaultFrom: string;
  mode: SendingMode;
  initialTemplate?: Template;
  /** A draft checked in Insights → Deliverability check, to turn into a campaign */
  initialDraft?: CampaignDraft;
  onTemplateSaved: (message: string) => void;
  onCreated: (message: string) => void;
  onOpenGuide: () => void;
  /** Called when the composer gains or loses unsent work */
  onDirtyChange?: (dirty: boolean) => void;
  /** false while the spam detector is moving to its own app: no live spam score, highlights or spam panel */
  spamEnabled: boolean;
}

export interface CampaignDraft {
  subject: string;
  body: string;
  /** One address per line */
  recipients: string;
}

interface Content {
  subject: string;
  body: string;
}

const prettyKey = (key: string) =>
  ({ first_name: "First name", name: "Full name", email: "Email" })[key] ??
  key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const STEPS = [
  { n: 1, title: "Name" },
  { n: 2, title: "Recipients" },
  { n: 3, title: "Message" },
  { n: 4, title: "Two versions", optional: true },
  { n: 5, title: "Schedule" },
] as const;

const scrollToStep = (n: number) => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function CampaignComposer({ templates, defaultFrom, mode, initialTemplate, initialDraft, onTemplateSaved, onCreated, onOpenGuide, onDirtyChange, spamEnabled }: Props) {
  // Details
  const [name, setName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  // Recipients
  const [pasted, setPasted] = useState(initialDraft?.recipients ?? "");
  const [csv, setCsv] = useState<{ fileName: string; recipients: Recipient[]; invalid: string[]; columns: string[] } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // People added one by one with the small form, and anyone taken off the list with the x on their chip
  const [added, setAdded] = useState<Recipient[]>([]);
  const [newPerson, setNewPerson] = useState({ name: "", email: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  // Content
  const [contentType, setContentType] = useState<ContentType>(initialTemplate?.content_type ?? "text");
  const [a, setA] = useState<Content>(
    initialDraft ? { subject: initialDraft.subject, body: initialDraft.body } : { subject: initialTemplate?.subject ?? "", body: initialTemplate?.body ?? "" }
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(initialTemplate?.name ?? null);
  const [abEnabled, setAbEnabled] = useState(false);
  const [b, setB] = useState<Content>({ subject: "", body: "" });
  const [split, setSplit] = useState(50);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // "A different email for each person": each person's own subject and message, keyed by lower-case address.
  // People without an entry get the main email.
  const [personal, setPersonal] = useState(false);
  const [own, setOwn] = useState<Record<string, Content>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [peopleQuery, setPeopleQuery] = useState("");
  // How many people got their own email from the uploaded file's subject / message columns
  const [fromFile, setFromFile] = useState(0);
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const lastField = useRef<Record<Version, FieldName>>({ A: "body", B: "body" });

  // Schedule
  const [scheduleType, setScheduleType] = useState<ScheduleType>("now");
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("09:00");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [repeatTime, setRepeatTime] = useState("09:00");
  const [nextSends, setNextSends] = useState<{ runs?: string[]; error?: string }>({});
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const cron = buildCron(frequency, repeatTime, weekday, monthDay);
  const [followUps, setFollowUps] = useState<FollowUpDraft[]>([]);
  const [sendSpeed, setSendSpeed] = useState<SendSpeed>("safe");

  const [submitting, setSubmitting] = useState<"send" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ask the server when a repeating campaign will next go out
  useEffect(() => {
    if (scheduleType !== "recurring") return;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch("/campaigns/cron-preview", { method: "POST", body: JSON.stringify({ cron, timezone }) });
        const data = await res.json();
        setNextSends(res.ok ? { runs: data.next_runs } : { error: errorMessage(data, "That schedule doesn't work. Try another time.") });
      } catch {
        setNextSends({ error: NETWORK_ERROR });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [scheduleType, cron, timezone]);

  const pastedParsed = useMemo(() => parsePasted(pasted), [pasted]);
  const merged = useMemo(() => mergeRecipients(csv?.recipients ?? [], pastedParsed.recipients, added), [csv, pastedParsed, added]);

  // Tells the dashboard there's unsent work here, so starting another campaign asks before clearing it
  const dirty = !!(name.trim() || pasted.trim() || csv || added.length || a.subject.trim() || a.body.trim());
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Contacts removed by a pre-send recommendation (bounced before, emailed too recently, generic inboxes…)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const recipients = useMemo(
    () => merged.recipients.filter((r) => !excluded.has(r.email.toLowerCase()) && !removed.has(r.email.toLowerCase())),
    [merged, excluded, removed]
  );
  const excludedCount = merged.recipients.filter((r) => excluded.has(r.email.toLowerCase())).length;
  const removedCount = merged.recipients.filter((r) => removed.has(r.email.toLowerCase()) && !excluded.has(r.email.toLowerCase())).length;
  const keyOf = (r: Recipient) => r.email.toLowerCase();
  // In "a different email for each person", the preview follows the person being edited
  const previewRecipient = (personal && recipients.find((r) => keyOf(r) === focus)) || recipients[0];
  const previewOwn = personal && previewRecipient ? own[keyOf(previewRecipient)] : undefined;
  const previewA: Content = previewOwn ?? a;
  const editedCount = personal ? recipients.filter((r) => own[keyOf(r)]).length : 0;
  const everyoneOwn = personal && recipients.length > 0 && editedCount === recipients.length;
  // Messages from a file often start straight with the text ("I wanted to ask..."): offer to add a greeting
  const GREETING = /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|greetings|<p>\s*(hi|hello|hey|dear))\b/i;
  const noGreeting = personal ? recipients.filter((r) => own[keyOf(r)]?.body.trim() && !GREETING.test(own[keyOf(r)].body)) : [];
  const addGreetings = () =>
    setOwn((o) => {
      const next = { ...o };
      for (const r of noGreeting) {
        const mine = next[keyOf(r)];
        next[keyOf(r)] = { ...mine, body: contentType === "html" ? `<p>Hi {{first_name}},</p>\n${mine.body}` : `Hi {{first_name}},\n\n${mine.body}` };
      }
      return next;
    });
  const firstOwn = personal ? recipients.map((r) => own[keyOf(r)]).find(Boolean) : undefined;

  /** The main email as this person would get it: their name and details filled in ("there" for a missing first name) */
  const mainFor = (r: Recipient): Content => {
    const first = r.name?.trim().split(/\s+/)[0] || "";
    return {
      subject: renderPreview(a.subject, r).replace(/\s*,\s*([!?.])/g, "$1").replace(/,\s*$/, "").trim(),
      body: renderPreview(a.body.replace(/{{\s*first_name\s*}}/gi, first || "there"), r),
    };
  };
  const editOwn = (r: Recipient, field: keyof Content, value: string) =>
    setOwn((o) => ({ ...o, [keyOf(r)]: { ...(o[keyOf(r)] ?? mainFor(r)), [field]: value } }));
  const resetOwn = (r: Recipient) =>
    setOwn((o) => {
      const next = { ...o };
      delete next[keyOf(r)];
      return next;
    });

  const addPerson = () => {
    const email = newPerson.email.trim();
    setAddError(null);
    if (!isEmail(email)) return setAddError("That doesn't look like an email address.");
    const key = email.toLowerCase();
    if (recipients.some((r) => keyOf(r) === key)) return setAddError(`${email} is already on the list.`);
    setRemoved((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
    if (!merged.recipients.some((r) => keyOf(r) === key)) setAdded((list) => [...list, { email, name: newPerson.name.trim() || undefined, variables: {} }]);
    setNewPerson({ name: "", email: "" });
  };
  const removePerson = (r: Recipient) => {
    const key = keyOf(r);
    if (added.some((x) => keyOf(x) === key) && !csv?.recipients.some((x) => keyOf(x) === key) && !pastedParsed.recipients.some((x) => keyOf(x) === key)) {
      setAdded((list) => list.filter((x) => keyOf(x) !== key));
    } else {
      setRemoved((set) => new Set(set).add(key));
    }
  };

  // Live inbox score while writing: checked 800ms after typing stops, or straight away after a one-click fix
  const [spam, setSpam] = useState<Record<Version, SpamResult | null>>({ A: null, B: null });
  // The exact text each result was computed for; highlights and fixes only apply while the text still matches
  const [checked, setChecked] = useState<Record<Version, string | null>>({ A: null, B: null });
  const [spamLoading, setSpamLoading] = useState(false);
  const checkNow = useRef(false);
  const checkSeq = useRef(0);
  useEffect(() => {
    if (!spamEnabled) return;
    const delay = checkNow.current ? 0 : 800;
    checkNow.current = false;
    const timer = setTimeout(async () => {
      const seq = ++checkSeq.current;
      setSpamLoading(true);
      const check = async (content: Content): Promise<SpamResult | null> => {
        if (!content.subject.trim() && !content.body.trim()) return null;
        try {
          const res = await apiFetch("/template/score", {
            method: "POST",
            body: JSON.stringify({ subject: content.subject, body: content.body, content_type: contentType }),
          });
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      };
      const [resA, resB] = await Promise.all([check(a), abEnabled ? check(b) : Promise.resolve(null)]);
      if (seq !== checkSeq.current) return; // a newer check started while this one was running
      setSpam({ A: resA, B: resB });
      setChecked({ A: checkKey(contentType, a), B: abEnabled ? checkKey(contentType, b) : null });
      setSpamLoading(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [a, b, abEnabled, contentType, spamEnabled]);

  const spamStale = (version: Version) => checked[version] !== checkKey(contentType, version === "A" ? a : b);
  const marksFor = (version: Version, field: FieldName) =>
    spamStale(version) ? [] : (spam[version]?.highlights ?? []).filter((h) => h.field === field);

  const applySpamFix = (version: Version, fix: SpamFix) => {
    if (spamStale(version)) return;
    const [content, setContent] = version === "A" ? [a, setA] : [b, setB];
    checkNow.current = true;
    setContent(applyFix(content, fix));
  };

  /** Selects a flagged word in the editor so the writer can see it in context */
  const showSpan = (version: Version, span: SpamSpan) => {
    const el = fieldRefs.current[`${version}-${span.field}`];
    if (!el) return;
    el.focus();
    el.setSelectionRange(span.start, span.end);
    if (el instanceof HTMLTextAreaElement) {
      // Put the selection about a third of the way down the box
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const line = el.value.slice(0, span.start).split("\n").length - 1;
      el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
    }
  };

  // Pre-send review: the preflight checks, plus which suggestions were applied, for the decision log
  const [precheck, setPrecheck] = useState<{ open: boolean; loading: boolean; error: string | null; result: PreflightResult | null }>({
    open: false,
    loading: false,
    error: null,
    result: null,
  });
  const [accepted, setAccepted] = useState<string[]>([]);

  // The preview is rendered by the backend with the same branded layout recipients get
  const [designed, setDesigned] = useState<Record<Version, string>>({ A: "", B: "" });
  useEffect(() => {
    const timer = setTimeout(() => {
      (["A", "B"] as const).forEach(async (v) => {
        const body = v === "A" ? previewA.body : b.body;
        if (!body.trim() || (v === "B" && !abEnabled)) return setDesigned((d) => ({ ...d, [v]: "" }));
        try {
          const res = await apiFetch("/campaigns/email-preview", {
            method: "POST",
            body: JSON.stringify({ body, content_type: contentType, sender_name: senderName || null, recipient: previewRecipient ?? null }),
          });
          if (res.ok) {
            const { html } = await res.json();
            setDesigned((d) => ({ ...d, [v]: html }));
          }
        } catch {
          // Preview is best-effort; the plain version below still shows
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [previewA.body, b.body, abEnabled, contentType, senderName, previewRecipient]);
  const invalidCount = pastedParsed.invalid.length + (csv?.invalid.length ?? 0);
  const tags = ["first_name", "name", "email", ...(csv?.columns ?? []).filter((c) => !["name", "email", "first_name", "last_name", "full_name"].includes(c))];
  const aCount = abEnabled && recipients.length > 1 ? Math.min(Math.max(Math.round((recipients.length * split) / 100), 1), recipients.length - 1) : recipients.length;
  const bCount = abEnabled ? recipients.length - aCount : 0;
  // The default sender may already carry a name ("Arvistry <hello@arvistry.com>"); a custom sender name replaces it
  const fromAddress = defaultFrom.match(/<([^>]+)>/)?.[1] ?? defaultFrom;
  const fromDisplay = senderName.trim() ? `${senderName.trim()} <${fromAddress}>` : defaultFrom || "Your company";
  const sendAtIso = sendDate && sendTime ? new Date(`${sendDate}T${sendTime}`).toISOString() : null;

  const loadCsv = async (file: File) => {
    setCsvError(null);
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setCsvError("Please choose a .csv file. In Excel or Google Sheets, use File → Download → CSV.");
      return;
    }
    const result = parseCsv(await file.text());
    if (result.error) {
      setCsvError(result.error);
      return;
    }
    setCsv({ fileName: file.name, recipients: result.recipients, invalid: result.invalid, columns: result.columns });
    // A file with a subject and/or message column: each person gets the email written in their row
    const mine = ownFromCsv(result.recipients, result.columns);
    const count = Object.keys(mine).length;
    setFromFile(count);
    if (count) {
      setOwn((o) => ({ ...o, ...mine }));
      setPersonal(true);
      setAbEnabled(false);
      setFocus(Object.keys(mine)[0]);
    }
  };

  const downloadSample = (personalSample = false) => {
    const url = URL.createObjectURL(new Blob([personalSample ? SAMPLE_PERSONAL_CSV : SAMPLE_CSV], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = personalSample ? "different-email-for-each-person.csv" : "contacts-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const pickTemplate = (t: Template) => {
    setA({ subject: t.subject, body: t.body });
    setContentType(t.content_type);
    setSelectedTemplate(t.name);
  };

  /** Inserts a {{tag}} where the cursor is in the subject or body the user last clicked into. */
  const insertTag = (version: Version, tag: string) => {
    const field = lastField.current[version];
    const el = fieldRefs.current[`${version}-${field}`];
    const [content, setContent] = version === "A" ? [a, setA] : [b, setB];
    const value = content[field];
    const token = `{{${tag}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setContent({ ...content, [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const saveTemplate = async () => {
    if (!templateName?.trim()) return;
    setError(null);
    const res = await apiFetch("/templates", {
      method: "POST",
      body: JSON.stringify({ name: templateName.trim(), subject: a.subject, body: a.body, content_type: contentType }),
    }).catch(() => null);
    if (res?.ok) {
      setSelectedTemplate(templateName.trim());
      setTemplateName(null);
      onTemplateSaved(`Saved "${templateName.trim()}" to your templates.`);
    } else {
      setError(res ? errorMessage(await res.json(), "We couldn't save the template.") : NETWORK_ERROR);
    }
  };

  const validate = (asDraft: boolean): string | null => {
    if (!name.trim()) return "Give your campaign a name so you can find it later.";
    if (!recipients.length) return "Add at least one person to send to. Paste email addresses or upload a spreadsheet.";
    if (!everyoneOwn && !a.subject.trim()) return "Add a subject line.";
    if (!everyoneOwn && !a.body.trim()) return "Write the message for your email.";
    if (abEnabled && (!b.subject.trim() || !b.body.trim())) return "You're testing two versions, so version B needs a subject and message too.";
    if (abEnabled && recipients.length < 2) return "Testing two versions needs at least 2 recipients.";
    if (personal) {
      const blank = recipients.find((r) => own[keyOf(r)] && (!own[keyOf(r)].subject.trim() || !own[keyOf(r)].body.trim()));
      if (blank) return `The email for ${blank.name || blank.email} needs a subject and a message. Fill them in, or click "Use the main email".`;
    }
    if (asDraft) return null;
    if (scheduleType === "once" && !sendAtIso) return "Choose the date and time to send.";
    if (scheduleType === "once" && sendAtIso && new Date(sendAtIso) < new Date()) return "That time has already passed. Choose a time in the future.";
    if (scheduleType === "recurring" && nextSends.error) return nextSends.error;
    if (scheduleType !== "recurring" && followUps.some((f) => !f.subject.trim() || !f.body.trim()))
      return "Each follow-up needs a subject line and a message, or remove it.";
    return null;
  };

  const create = async (asDraft: boolean, overrideReason: string | null = null) => {
    setSubmitting(asDraft ? "draft" : "send");
    try {
      const res = await apiFetch("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          from_email: senderName.trim() && defaultFrom ? fromDisplay : null,
          reply_to: replyTo.trim() || null,
          content_type: contentType,
          // With an own email for everyone, the main email may be empty: the first person's stands in for it
          subject: a.subject.trim() ? a.subject : firstOwn?.subject ?? a.subject,
          body: a.body.trim() ? a.body : firstOwn?.body ?? a.body,
          ab_test: { enabled: abEnabled, subject_b: b.subject, body_b: b.body, split },
          recipients: recipients.map((r) => {
            const mine = personal ? own[keyOf(r)] : undefined;
            return mine ? { ...r, subject: mine.subject, body: mine.body } : r;
          }),
          schedule: {
            type: scheduleType,
            send_at: scheduleType === "once" ? sendAtIso : null,
            cron: scheduleType === "recurring" ? cron : null,
            timezone,
          },
          save_as_draft: asDraft,
          follow_ups: scheduleType === "recurring" ? [] : followUps,
          override_reason: overrideReason,
          send_speed: sendSpeed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorMessage(data, "We couldn't create the campaign. Please try again."));
        return null;
      }
      const pace = sendSpeed === "fast" ? "" : ` It will take ${sendDuration(data.recipient_count, sendSpeed)}; you can close this page meanwhile.`;
      onCreated(
        asDraft
          ? `"${data.name}" saved as a draft.`
          : data.status === "sending"
            ? `"${data.name}" is on its way to ${data.recipient_count} ${data.recipient_count === 1 ? "person" : "people"}.${pace}`
            : `"${data.name}" is scheduled. First send: ${formatDateTime(data.next_run_at)}.`
      );
      return data as { id: string };
    } catch {
      setError(NETWORK_ERROR);
      return null;
    } finally {
      setSubmitting(null);
    }
  };

  type PreflightOverrides = { emails?: string[]; schedule?: { type: ScheduleType; send_at: string | null }; content?: Partial<Record<Version, Content>> };
  const runPrecheck = async (over: PreflightOverrides = {}) => {
    setPrecheck((p) => ({ ...p, open: true, loading: true, error: null }));
    const va = over.content?.A ?? a;
    const vb = over.content?.B ?? b;
    try {
      const res = await apiFetch("/campaign/preflight", {
        method: "POST",
        body: JSON.stringify({
          from_email: fromDisplay.includes("@") ? fromDisplay : null,
          subject: va.subject,
          body: va.body,
          content_type: contentType,
          ab_test: { enabled: abEnabled, subject_b: vb.subject, body_b: vb.body, split },
          recipients: over.emails ?? recipients.map((r) => r.email),
          schedule: {
            type: over.schedule?.type ?? scheduleType,
            send_at: over.schedule ? over.schedule.send_at : scheduleType === "once" ? sendAtIso : null,
            cron: (over.schedule?.type ?? scheduleType) === "recurring" ? cron : null,
            timezone,
          },
          reply_to: replyTo.trim() || null,
        }),
      });
      const data = await res.json();
      setPrecheck((p) =>
        res.ok
          ? { ...p, loading: false, result: data }
          : { ...p, loading: false, result: null, error: "We couldn't run the checks this time, but you can still send." }
      );
    } catch {
      setPrecheck((p) => ({ ...p, loading: false, result: null, error: NETWORK_ERROR }));
    }
  };

  const applyRecommendation = (checkId: string, action: PreflightAction) => {
    setAccepted((list) => (list.includes(checkId) ? list : [...list, checkId]));
    if (action.type === "remove_recipients") {
      const next = new Set([...excluded, ...action.emails.map((e) => e.toLowerCase())]);
      setExcluded(next);
      runPrecheck({ emails: merged.recipients.filter((r) => !next.has(r.email.toLowerCase())).map((r) => r.email) });
    } else if (action.type === "schedule_at") {
      const at = new Date(action.at);
      setScheduleType("once");
      setSendDate(`${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`);
      setSendTime(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
      runPrecheck({ schedule: { type: "once", send_at: at.toISOString() } });
    } else {
      const [content, setContent] = action.version === "A" ? [a, setA] : [b, setB];
      const fixed = applyFix(content, action.fix);
      checkNow.current = true;
      setContent(fixed);
      runPrecheck({ content: { [action.version]: fixed } });
    }
  };

  /** Records what happened in the pop-up. Never blocks or fails the send itself. */
  const logDecision = (outcome: "sent" | "scheduled" | "cancelled", campaignId: string | null, overrideReason: string | null) => {
    const result = precheck.result;
    if (!result) return;
    apiFetch("/campaign/preflight/decisions", {
      method: "POST",
      body: JSON.stringify({
        campaign_id: campaignId,
        verdict: result.verdict,
        checks: result.checks.map((c) => ({ id: c.id, status: c.status, message: c.message.slice(0, 500) })),
        accepted,
        override_reason: overrideReason,
        outcome,
      }),
    }).catch(() => {});
  };

  const submit = (asDraft: boolean) => {
    const problem = validate(asDraft);
    setError(problem);
    if (problem) return;
    if (asDraft) create(true);
    else {
      setAccepted([]);
      runPrecheck();
    }
  };

  const closePreflight = () => {
    logDecision("cancelled", null, null);
    setPrecheck((p) => ({ ...p, open: false }));
  };

  const sendAfterCheck = async (overrideReason: string | null) => {
    // Re-validate: a recommendation may have changed the list or the time
    const problem = validate(false);
    if (problem) {
      setError(problem);
      setPrecheck((p) => ({ ...p, open: false }));
      return;
    }
    const campaign = await create(false, overrideReason);
    if (campaign) logDecision(scheduleType === "now" ? "sent" : "scheduled", campaign.id, overrideReason);
    setPrecheck((p) => ({ ...p, open: false }));
  };

  const versionFields = (version: Version) => {
    const [content, setContent] = version === "A" ? [a, setA] : [b, setB];
    return (
      <>
        <label className="field">
          <span className="field-label">Subject line{abEnabled ? ` (version ${version})` : ""}</span>
          <HighlightBox value={content.subject} marks={marksFor(version, "subject")}>
            <input
              ref={(el) => {
                fieldRefs.current[`${version}-subject`] = el;
              }}
              className="input"
              placeholder={version === "A" ? "e.g. {{first_name}}, our autumn sale starts today" : "Try a different subject line"}
              value={content.subject}
              maxLength={255}
              onFocus={() => (lastField.current[version] = "subject")}
              onChange={(e) => setContent({ ...content, subject: e.target.value })}
            />
          </HighlightBox>
        </label>
        <label className="field">
          <span className="field-label">Message</span>
          <HighlightBox value={content.body} marks={marksFor(version, "body")}>
            <textarea
              ref={(el) => {
                fieldRefs.current[`${version}-body`] = el;
              }}
              className={`input textarea ${contentType === "html" ? "mono" : ""}`}
              rows={version === "A" ? 10 : 8}
              placeholder={contentType === "html" ? "<p>Hi {{first_name}},</p>" : "Hi {{first_name}},\n\nWrite your message here…"}
              value={content.body}
              onFocus={() => (lastField.current[version] = "body")}
              onChange={(e) => setContent({ ...content, body: e.target.value })}
            />
          </HighlightBox>
        </label>
        <div className="insert-bar">
          <span className="field-hint">Personalize:</span>
          {tags.map((tag) => (
            <button key={tag} type="button" className="insert-btn" onClick={() => insertTag(version, tag)} title={`Inserts {{${tag}}}`}>
              + {prettyKey(tag)}
            </button>
          ))}
        </div>
      </>
    );
  };

  // Progress through the five steps (UI UX Pro Max: show progress for multi-step processes)
  const stepDone: Record<number, boolean> = {
    1: !!name.trim(),
    2: recipients.length > 0,
    3: !!(a.subject.trim() && a.body.trim()) || everyoneOwn,
    4: abEnabled && !!(b.subject.trim() && b.body.trim()),
    5:
      scheduleType === "now" ||
      (scheduleType === "once" && !!sendAtIso) ||
      (scheduleType === "recurring" && !nextSends.error && !!nextSends.runs?.length),
  };
  const required = STEPS.filter((s) => !("optional" in s) || abEnabled).map((s) => s.n);
  const requiredDone = required.filter((n) => stepDone[n]).length;
  const nextStep = STEPS.find((s) => required.includes(s.n) && !stepDone[s.n]);
  const stepBadge = (n: number) => (
    <span className={`step-num ${stepDone[n] ? "done" : ""}`} aria-hidden="true">
      {stepDone[n] ? <Check size={14} strokeWidth={3} /> : n}
    </span>
  );
  const spamWorst = spam.A ? (spam.B && spam.B.score > spam.A.score ? spam.B : spam.A) : null;

  const scheduleSummary =
    scheduleType === "now"
      ? "Right away"
      : scheduleType === "once"
        ? sendAtIso
          ? formatDateTime(sendAtIso)
          : "Pick a date"
        : describeCron(cron);

  return (
    <div className="composer animate-fade-in">
      <div className="stack">
        <nav className="stepper" aria-label="Campaign steps">
          <div className="stepper-head">
            <div>
              <strong>
                {requiredDone} of {required.length} steps done
              </strong>
              <span className="field-hint">{nextStep ? `Next: ${nextStep.title.toLowerCase()}` : "All set. Review and send on the right."}</span>
            </div>
            <span className="stepper-pct">{Math.round((requiredDone / required.length) * 100)}%</span>
          </div>
          <div className="stepper-track" aria-hidden="true">
            <span style={{ transform: `scaleX(${((requiredDone / required.length) * 100) / 100})` }} />
          </div>
          <ol className="stepper-steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <button
                  type="button"
                  className={`stepper-step ${stepDone[s.n] ? "done" : ""} ${nextStep?.n === s.n ? "current" : ""}`}
                  aria-current={nextStep?.n === s.n ? "step" : undefined}
                  onClick={() => scrollToStep(s.n)}
                >
                  <span className="stepper-dot">{stepDone[s.n] ? <Check size={13} strokeWidth={3} /> : s.n}</span>
                  <span className="stepper-label">
                    {s.title}
                    {"optional" in s && <em>Optional</em>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {mode === "off" && (
          <div className="alert alert-warning">
            <AlertTriangle size={18} />
            <div>
              <strong>Practice mode.</strong> Email sending isn&apos;t switched on yet, so campaigns run as a rehearsal and no real emails go out.
            </div>
          </div>
        )}
        {mode === "test" && (
          <div className="alert alert-info">
            <Info size={18} />
            <div>
              <strong>Test mode.</strong> Until your company email domain is connected, emails only reach your own inbox. Anyone else will show
              as &quot;Not sent&quot;.
            </div>
          </div>
        )}

        {/* 1. Name */}
        <section className="card step-card" id="step-1">
          <div className="card-head" style={{ marginBottom: "1rem" }}>
            <div>
              <h2 className="card-title" id="step-1-title">{stepBadge(1)} Name your campaign</h2>
              <p className="card-sub">Only you see this. Pick something you&apos;ll recognise later.</p>
            </div>
          </div>
          <input className="input" aria-labelledby="step-1-title" placeholder="e.g. November newsletter" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />
          <details className="more-options">
            <summary>
              Sender details <ChevronDown size={14} />
            </summary>
            <div className="grid-2">
              <label className="field">
                <span className="field-label">Sender name</span>
                <input className="input" placeholder="e.g. Arvistry Team" value={senderName} maxLength={80} onChange={(e) => setSenderName(e.target.value)} />
                <span className="field-hint">What people see in their inbox before opening.</span>
              </label>
              <label className="field">
                <span className="field-label">Replies go to</span>
                <input className="input" type="email" placeholder="you@company.com" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
                <span className="field-hint">Optional. Where answers to this email arrive.</span>
              </label>
            </div>
          </details>
        </section>

        {/* 2. Recipients */}
        <section className="card step-card" id="step-2">
          <div className="card-head">
            <div>
              <h2 className="card-title">{stepBadge(2)} Choose who gets it</h2>
              <p className="card-sub">Paste email addresses, upload a spreadsheet, or both. Duplicates are removed for you.</p>
            </div>
          </div>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Paste email addresses</span>
              <textarea
                className="input textarea"
                rows={7}
                placeholder={"jane@company.com\nJohn Smith <john@company.com>\nann@shop.com, bob@studio.com"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <span className="field-hint">One per line, or separated by commas.</span>
            </label>

            <div className="field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                <span className="field-label">Upload a spreadsheet (CSV)</span>
                <span style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                  <button type="button" className="link-btn" style={{ fontSize: "0.82rem" }} onClick={() => downloadSample(false)}>
                    <Download size={13} style={{ verticalAlign: "-2px" }} /> Sample file
                  </button>
                  <button type="button" className="link-btn" style={{ fontSize: "0.82rem" }} onClick={() => downloadSample(true)}>
                    <Download size={13} style={{ verticalAlign: "-2px" }} /> Sample: different email for each person
                  </button>
                </span>
              </div>
              {csv ? (
                <div className="file-chip">
                  <span className="file-chip-icon"><FileSpreadsheet size={20} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 700 }}>{csv.fileName}</div>
                    <div className="field-hint">
                      {csv.recipients.length} contacts
                      {csv.columns.length > 0 && ` · ${csv.columns.map(prettyKey).join(", ")}`}
                    </div>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => { setCsv(null); setFromFile(0); }} title="Remove file" aria-label="Remove file">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  className={`drop-zone ${dragging ? "dragging" : ""}`}
                  onClick={() => fileInput.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) loadCsv(file);
                  }}
                >
                  <span className="drop-zone-icon"><Upload size={20} /></span>
                  <div><strong>Drop your file here</strong> or click to browse</div>
                  <span className="field-hint">
                    Needs an &quot;email&quot; column. Add &quot;subject&quot; and &quot;message&quot; columns to give each person their own email.
                  </span>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadCsv(file);
                  e.target.value = "";
                }}
              />
              {csvError && <span className="cell-error" role="alert">{csvError}</span>}
              {csv && fromFile > 0 && (
                <span className="file-note">
                  <CheckCircle2 size={14} /> {fromFile} {fromFile === 1 ? "person gets" : "people get"} the subject and message from their row. Check them in step 3.
                </span>
              )}
            </div>
          </div>

          <div className="add-person">
            <span className="field-label">Or add people one by one</span>
            <div className="add-person-row">
              <input className="input" placeholder="Name (optional)" value={newPerson.name} maxLength={200} aria-label="Name"
                onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())} />
              <input className="input" type="email" placeholder="Email address" value={newPerson.email} aria-label="Email address"
                onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPerson())} />
              <button type="button" className="btn btn-secondary" onClick={addPerson} disabled={!newPerson.email.trim()}>
                <UserPlus size={15} /> Add
              </button>
            </div>
            {addError && <span className="cell-error" role="alert">{addError}</span>}
          </div>

          <div className="recipient-bar">
            <Users size={18} color="var(--primary)" />
            <span className="big">{recipients.length}</span>
            <span>{recipients.length === 1 ? "person" : "people"} will receive this email</span>
            {invalidCount > 0 && <span className="pill tone-warning">{invalidCount} invalid address{invalidCount === 1 ? "" : "es"} skipped</span>}
            {merged.duplicates > 0 && <span className="pill tone-neutral">{merged.duplicates} duplicate{merged.duplicates === 1 ? "" : "s"} removed</span>}
            {removedCount > 0 && (
              <span className="pill tone-neutral no-dot">
                {removedCount} taken off by you ·{" "}
                <button type="button" className="link-btn" style={{ fontSize: "inherit" }} onClick={() => setRemoved(new Set())}>
                  Undo
                </button>
              </span>
            )}
            {excludedCount > 0 && (
              <span className="pill tone-violet no-dot">
                {excludedCount} removed by recommendations ·{" "}
                <button type="button" className="link-btn" style={{ fontSize: "inherit" }} onClick={() => setExcluded(new Set())}>
                  Undo
                </button>
              </span>
            )}
          </div>
          {recipients.length > 0 && (
            <div className="recipient-chips">
              {recipients.slice(0, 12).map((r) => (
                <span key={r.email} className="recipient-chip" title={r.email}>
                  {r.name ? `${r.name} · ${r.email}` : r.email}
                  <button type="button" className="recipient-chip-x" onClick={() => removePerson(r)} aria-label={`Take ${r.email} off the list`} title="Take off the list">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {recipients.length > 12 && <span className="recipient-chip">+{recipients.length - 12} more</span>}
            </div>
          )}
        </section>

        {/* 3. Content */}
        <section className="card step-card" id="step-3">
          <div className="card-head">
            <div>
              <h2 className="card-title">{stepBadge(3)} Write your email</h2>
              <p className="card-sub">Start from a template or write your own.</p>
            </div>
            <div className="segmented" role="group" aria-label="Email format">
              <button type="button" aria-pressed={contentType === "text"} className={contentType === "text" ? "active" : ""} onClick={() => setContentType("text")}>
                Simple text
              </button>
              <button type="button" aria-pressed={contentType === "html"} className={contentType === "html" ? "active" : ""} onClick={() => setContentType("html")}>
                HTML design
              </button>
            </div>
          </div>

          <div className="template-strip">
            {templates.map((t, i) => (
              <button
                key={t.id ?? `starter-${i}`}
                type="button"
                aria-pressed={selectedTemplate === t.name}
                className={`template-pick ${selectedTemplate === t.name ? "selected" : ""}`}
                onClick={() => pickTemplate(t)}
              >
                <div className="name">
                  {t.builtin ? <Sparkles size={13} /> : <Save size={13} />}
                  <span className="truncate">{t.name}</span>
                </div>
                <div className="subj truncate">{humanizeTags(t.subject)}</div>
              </button>
            ))}
          </div>

          <div className="stack" style={{ gap: "1rem" }}>
            {versionFields("A")}
          </div>

          <div style={{ marginTop: "1rem" }}>
            {templateName === null ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTemplateName(name || a.subject)} disabled={!a.subject || !a.body}>
                <Save size={14} /> Save as a template
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ flex: "1 1 220px" }}
                  autoFocus
                  aria-label="Template name"
                  placeholder="Template name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={saveTemplate} disabled={!templateName.trim()}>
                  Save template
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTemplateName(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="personal-mode">
            <span className="field-label">Who gets what</span>
            <div className="segmented" role="group" aria-label="Who gets what">
              <button type="button" aria-pressed={!personal} className={!personal ? "active" : ""} onClick={() => setPersonal(false)}>
                Same email for everyone
              </button>
              <button type="button" aria-pressed={personal} className={personal ? "active" : ""}
                onClick={() => {
                  setPersonal(true);
                  setAbEnabled(false);
                  if (!focus && recipients[0]) setFocus(keyOf(recipients[0]));
                }}>
                A different email for each person
              </button>
            </div>
            {!personal ? (
              <span className="field-hint">Everyone gets the email above, with their own name filled in.</span>
            ) : recipients.length === 0 ? (
              <p className="field-hint">Add people in step 2 first. Then click each person here to write their own email.</p>
            ) : (() => {
              const current = recipients.find((r) => keyOf(r) === focus) ?? recipients[0];
              const idx = recipients.indexOf(current);
              const mine = own[keyOf(current)];
              const shown = mine ?? mainFor(current);
              const q = peopleQuery.trim().toLowerCase();
              const list = q ? recipients.filter((r) => `${r.name ?? ""} ${r.email}`.toLowerCase().includes(q)) : recipients;
              return (
                <div className="personal">
                  {fromFile > 0 && csv ? (
                    <div className="alert alert-info" style={{ margin: 0 }}>
                      <FileSpreadsheet size={18} />
                      <div>
                        <strong>{fromFile} of {recipients.length} people get their own email from {csv.fileName}.</strong>{" "}
                        Click anyone to check or change it.
                        {fromFile < recipients.length ? " Everyone else gets the email above." : " The email above is only needed if you add more people."}
                      </div>
                    </div>
                  ) : null}
                  {noGreeting.length > 0 ? (
                    <div className="alert alert-warning" style={{ margin: 0 }}>
                      <AlertTriangle size={18} />
                      <div>
                        <strong>{noGreeting.length} {noGreeting.length === 1 ? "message starts" : "messages start"} without a greeting</strong> (no &quot;Hi …,&quot;).{" "}
                        <button type="button" className="link-btn" onClick={addGreetings}>Add &quot;Hi [First name],&quot; at the top</button>
                      </div>
                    </div>
                  ) : null}
                  {fromFile > 0 && csv ? null : (
                    <p className="field-hint">
                      The email above is the starting point. Click a person and change their subject or message. Anyone you don&apos;t change gets the email above.
                    </p>
                  )}
                  <div className="personal-grid">
                    <div className="personal-list">
                      {recipients.length > 8 && (
                        <input className="input" placeholder="Find a person" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} aria-label="Find a person" />
                      )}
                      <ul>
                        {list.map((r) => (
                          <li key={r.email}>
                            <button type="button" className={`personal-row${keyOf(r) === keyOf(current) ? " is-active" : ""}`} onClick={() => setFocus(keyOf(r))}>
                              <span className="personal-row-text">
                                <strong className="truncate">{r.name || r.email.split("@")[0]}</strong>
                                <span className="truncate">{r.email}</span>
                              </span>
                              {own[keyOf(r)] ? (
                                <span className="pill tone-success no-dot"><Pencil size={11} /> Own email</span>
                              ) : (
                                <span className="personal-main">Main email</span>
                              )}
                            </button>
                          </li>
                        ))}
                        {list.length === 0 && <li className="field-hint" style={{ padding: "0.5rem" }}>Nobody matches.</li>}
                      </ul>
                    </div>
                    <div className="personal-editor">
                      <div className="personal-editor-head">
                        <div style={{ minWidth: 0 }}>
                          <strong className="truncate">{current.name || current.email}</strong>
                          <span className="field-hint">{mine ? "Their own email" : "Gets the main email. Change anything below to give them their own."}</span>
                        </div>
                        <span className="field-hint">{idx + 1} of {recipients.length}</span>
                      </div>
                      <label className="field">
                        <span className="field-label">Subject</span>
                        <input className="input" maxLength={255} value={shown.subject} onChange={(e) => editOwn(current, "subject", e.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field-label">Message</span>
                        <textarea className={`input textarea ${contentType === "html" ? "mono" : ""}`} rows={9} value={shown.body}
                          onChange={(e) => editOwn(current, "body", e.target.value)} />
                      </label>
                      <div className="personal-actions">
                        {mine ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => resetOwn(current)}>
                            <RotateCcw size={14} /> Use the main email
                          </button>
                        ) : <span />}
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={idx <= 0} onClick={() => setFocus(keyOf(recipients[idx - 1]))}>
                            Previous
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" disabled={idx >= recipients.length - 1} onClick={() => setFocus(keyOf(recipients[idx + 1]))}>
                            Next person
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="personal-summary">
                    <strong>{editedCount}</strong> of {recipients.length} {recipients.length === 1 ? "person has" : "people have"} their own email. The rest get the main email.
                  </p>
                </div>
              );
            })()}
          </div>
        </section>

        {/* 4. A/B test */}
        <section className="card step-card" id="step-4">
          <div className="card-head" style={{ marginBottom: abEnabled ? "1.2rem" : 0 }}>
            <div>
              <h2 className="card-title">
                {stepBadge(4)} Test two versions <span className="pill tone-violet no-dot">Optional</span>
              </h2>
              <p className="card-sub">
                {personal
                  ? "Not available while each person gets their own email."
                  : "Send a second version to part of your list and see which one people open more."}
              </p>
            </div>
            <label className="switch">
              <input type="checkbox" aria-label="Test two versions" checked={abEnabled} disabled={personal} onChange={(e) => setAbEnabled(e.target.checked)} />
              <span className="switch-track" />
              {abEnabled ? "On" : "Off"}
            </label>
          </div>

          {abEnabled && (
            <div className="stack" style={{ gap: "1.1rem" }}>
              <div className="field">
                <span className="field-label">How to split your list</span>
                <div className="split-bar" aria-hidden="true">
                  <div className="a" style={{ width: `${split}%` }}>A · {split}%{recipients.length > 0 && ` · ${aCount}`}</div>
                  <div className="b" style={{ width: `${100 - split}%` }}>B · {100 - split}%{recipients.length > 0 && ` · ${bCount}`}</div>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={split}
                  onChange={(e) => setSplit(Number(e.target.value))}
                  className="range"
                  aria-label="Share of people who get version A"
                />
                <span className="field-hint">People are picked at random for each version.</span>
              </div>
              <div className="version-block">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <strong style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="version-tag version-b">B</span> Version B
                  </strong>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setB({ ...a })}>
                    <Copy size={14} /> Start from version A
                  </button>
                </div>
                {versionFields("B")}
              </div>
            </div>
          )}
        </section>

        {/* 5. Schedule */}
        <section className="card step-card" id="step-5">
          <div className="card-head">
            <div>
              <h2 className="card-title">{stepBadge(5)} Choose when to send</h2>
              <p className="card-sub">Times are in your local time zone ({timezone.replace(/_/g, " ")}).</p>
            </div>
          </div>
          <div className="choice-grid">
            {(
              [
                { id: "now", icon: <Send size={17} />, title: "Send now", text: "Goes out as soon as you confirm." },
                { id: "once", icon: <CalendarClock size={17} />, title: "Schedule for later", text: "Pick a date and time." },
                { id: "recurring", icon: <Repeat size={17} />, title: "Repeat automatically", text: "Daily, weekly or monthly." },
              ] as const
            ).map((c) => (
              <button key={c.id} type="button" className={`choice ${scheduleType === c.id ? "active" : ""}`} onClick={() => setScheduleType(c.id)}>
                <span className="choice-icon">{c.icon}</span>
                <strong>{c.title}</strong>
                <span>{c.text}</span>
              </button>
            ))}
          </div>

          {scheduleType === "once" && (
            <div className="schedule-panel">
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Date</span>
                  <input className="input" type="date" min={todayIso()} value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">Time</span>
                  <input className="input" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {scheduleType === "recurring" && (
            <div className="schedule-panel">
              <div className="grid-3">
                <label className="field">
                  <span className="field-label">Repeat</span>
                  <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                    <option value="daily">Every day</option>
                    <option value="weekdays">Every weekday (Mon–Fri)</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                  </select>
                </label>
                {frequency === "weekly" && (
                  <label className="field">
                    <span className="field-label">On</span>
                    <select className="input" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>{d}</option>
                      ))}
                    </select>
                  </label>
                )}
                {frequency === "monthly" && (
                  <label className="field">
                    <span className="field-label">On day</span>
                    <select className="input" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span className="field-label">At</span>
                  <input className="input" type="time" value={repeatTime} onChange={(e) => setRepeatTime(e.target.value || "09:00")} />
                </label>
              </div>
              <div className="next-sends">
                {nextSends.error ? (
                  <span className="cell-error" style={{ marginTop: 0 }}>{nextSends.error}</span>
                ) : (
                  <>
                    <span className="text-2">Next sends:</span>
                    {(nextSends.runs ?? []).map((r) => (
                      <span key={r} className="pill tone-primary no-dot">{formatDateTime(r)}</span>
                    ))}
                  </>
                )}
              </div>
              <span className="field-hint">Each time, it goes to everyone on your list. You can pause it whenever you like.</span>
            </div>
          )}

          <div className="field" style={{ marginTop: "1.25rem" }}>
            <span className="field-label">Sending speed</span>
            <div className="choice-grid">
              {SEND_SPEEDS.map((s) => (
                <button key={s.id} type="button" className={`choice ${sendSpeed === s.id ? "active" : ""}`} onClick={() => setSendSpeed(s.id)}>
                  <span className="choice-icon">{s.id === "safe" ? <ShieldCheck size={17} /> : s.id === "normal" ? <Gauge size={17} /> : <Zap size={17} />}</span>
                  <strong>{s.title}{s.id === "safe" ? " (recommended)" : ""}</strong>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
            <span className="field-hint">
              {recipients.length > 0 && sendSpeed !== "fast"
                ? `${recipients.length} ${recipients.length === 1 ? "email takes" : "emails take"} ${sendDuration(recipients.length, sendSpeed)} to send. It runs on our server, so you can close this page. `
                : ""}
              Sending stops by itself if emails start bouncing or anyone marks it as spam, so a bad list can&apos;t harm your domain.
            </span>
            {sendSpeed === "fast" && recipients.length > 50 && (
              <span className="cell-error" style={{ marginTop: "0.4rem" }}>
                Sending {recipients.length} emails at once looks like spam to Gmail and Outlook. Use Safe or Normal for lists over 50.
              </span>
            )}
          </div>

          <FollowUpsEditor value={followUps} onChange={setFollowUps} recurring={scheduleType === "recurring"} />
        </section>
      </div>

      {/* Preview + send */}
      <aside className="composer-side">
        <div className="card">
          <div className="card-head" style={{ marginBottom: "0.9rem" }}>
            <div>
              <h2 className="card-title">Preview</h2>
              <p className="card-sub">
                {previewRecipient ? `How ${previewRecipient.name?.split(" ")[0] || previewRecipient.email} will see it` : "Add people to see personalization"}
              </p>
            </div>
          </div>
          {(abEnabled ? (["A", "B"] as const) : (["A"] as const)).map((v) => {
            const content = v === "A" ? previewA : b;
            const subject = renderPreview(content.subject, previewRecipient);
            const body = renderPreview(content.body, previewRecipient);
            return (
              <div key={v} className="email-preview">
                <div className="email-head">
                  {abEnabled && (
                    <div style={{ marginBottom: "0.2rem" }}>
                      <span className={`version-tag version-${v.toLowerCase()}`}>{v}</span>
                    </div>
                  )}
                  <div className="row"><span>From</span><span>{fromDisplay}</span></div>
                  <div className="row"><span>To</span><span>{previewRecipient?.email ?? "—"}</span></div>
                  <div className="email-subject">{subject || <span className="muted">Your subject line</span>}</div>
                </div>
                {body && designed[v] ? (
                  <iframe className="email-html" sandbox="" title={`Preview of version ${v}`} srcDoc={designed[v]} />
                ) : (
                  <div className="email-body">{body || <span className="muted">Your message will appear here.</span>}</div>
                )}
              </div>
            );
          })}
        </div>

        {spamEnabled && (
          <SpamCheck
            title={abEnabled ? "Spam check · Version A" : "Spam check"}
            result={spam.A}
            loading={spamLoading}
            stale={spamStale("A")}
            onFix={(fix) => applySpamFix("A", fix)}
            onShow={(span) => showSpan("A", span)}
            onOpenGuide={onOpenGuide}
          />
        )}
        {spamEnabled && abEnabled && (
          <SpamCheck
            title="Spam check · Version B"
            result={spam.B}
            loading={spamLoading}
            stale={spamStale("B")}
            onFix={(fix) => applySpamFix("B", fix)}
            onShow={(span) => showSpan("B", span)}
            onOpenGuide={onOpenGuide}
          />
        )}

        <div className="card send-card">
          <h2 className="card-title">Ready to send?</h2>
          <ul className="checklist">
            {(
              [
                { ok: stepDone[1], label: "Campaign name", value: name.trim() || "Not named yet", step: 1 },
                {
                  ok: stepDone[2],
                  label: "Recipients",
                  value: recipients.length ? `${recipients.length} ${recipients.length === 1 ? "person" : "people"}` : "Nobody yet",
                  step: 2,
                },
                {
                  ok: stepDone[3],
                  label: "Subject and message",
                  value: !stepDone[3] ? "Missing" : personal ? `Written · ${editedCount} with their own` : "Written",
                  step: 3,
                },
                spamEnabled && {
                  ok: !spamWorst || spamWorst.level === "good",
                  warn: !!spamWorst && spamWorst.level !== "good",
                  label: "Spam risk",
                  value: spamWorst ? `${spamWorst.score}/100 · ${spamWorst.label}` : "Checked as you write",
                  step: 3,
                },
                { ok: !abEnabled || stepDone[4], label: "Two-version test", value: abEnabled ? `${split}% / ${100 - split}%` : "Off", step: 4 },
                { ok: stepDone[5], label: "When", value: scheduleSummary, step: 5 },
                scheduleType !== "recurring" && {
                  ok: true,
                  label: "Follow-ups",
                  value: followUps.length
                    ? `${followUps.length} · ${followUps.length > 1 ? "first " : ""}after ${followUps[0].wait_days} days`
                    : "None",
                  step: 5,
                },
              ].filter(Boolean) as { ok: boolean; warn?: boolean; label: string; value: string; step: number }[]
            ).map((row) => (
              <li key={row.label} className={row.warn ? "warn" : row.ok ? "ok" : ""}>
                <span className="checklist-icon" aria-hidden="true">
                  {row.warn ? <AlertTriangle size={16} /> : row.ok ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                </span>
                <button type="button" className="checklist-label" onClick={() => scrollToStep(row.step)}>
                  {row.label}
                </button>
                <strong className="truncate" title={row.value}>{row.value}</strong>
              </li>
            ))}
          </ul>
          <div className="send-box" style={{ marginTop: "1.2rem" }}>
            {error && (
              <div className="alert alert-danger" role="alert">
                <AlertTriangle size={18} />
                <div>{error}</div>
              </div>
            )}
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => submit(false)} disabled={submitting !== null}>
              {scheduleType === "now" ? <Send size={16} /> : scheduleType === "once" ? <CalendarClock size={16} /> : <Repeat size={16} />}
              {submitting === "send"
                ? "Working on it…"
                : scheduleType === "now"
                  ? recipients.length
                    ? `Send to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`
                    : "Send campaign"
                  : scheduleType === "once"
                    ? "Schedule campaign"
                    : "Start repeating campaign"}
            </button>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => submit(true)} disabled={submitting !== null}>
              <Save size={15} /> {submitting === "draft" ? "Saving…" : "Save as draft"}
            </button>
          </div>
        </div>

        {abEnabled && (
          <p className="field-hint" style={{ display: "flex", gap: "0.4rem" }}>
            <FlaskConical size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            Results for each version appear on the Campaigns page once emails start arriving.
          </p>
        )}
      </aside>

      <PreflightDialog
        open={precheck.open}
        loading={precheck.loading}
        error={precheck.error}
        result={precheck.result}
        accepted={accepted}
        sending={submitting === "send"}
        sendLabel={scheduleType === "now" ? "Send now" : scheduleType === "once" ? "Schedule" : "Start repeating"}
        onAction={applyRecommendation}
        onEdit={closePreflight}
        onSend={sendAfterCheck}
      />
    </div>
  );
}
