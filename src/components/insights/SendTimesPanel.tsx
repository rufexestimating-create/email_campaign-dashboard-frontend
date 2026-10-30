"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock, HardHat, Home, Info, MousePointerClick, PencilRuler, Send, Sparkles, Users, Wand2 } from "lucide-react";
import { DAY_SHORT, Lead, SendPlanRow, SendTimeInsights, browserTimezone, callApi, hourLabel, parseEmails } from "@/lib/insights";
import type { CampaignDraft } from "@/components/dashboard/CampaignComposer";
import { LoadError } from "./LoadError";

const AUDIENCES: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "contractor", label: "Contractors", icon: <HardHat size={18} /> },
  { id: "architect", label: "Architects & designers", icon: <PencilRuler size={18} /> },
  { id: "homeowner", label: "Homeowners", icon: <Home size={18} /> },
  { id: "other", label: "Everyone else", icon: <Users size={18} /> },
];
const AUDIENCE_LABEL: Record<string, string> = { all: "Everyone", ...Object.fromEntries(AUDIENCES.map((a) => [a.id, a.label])) };
const DEVICE_LABEL: Record<string, string> = { all: "All devices", desktop: "Desktop", mobile: "Mobile", tablet: "Tablet", unknown: "Not known" };
const SOURCE_LABEL: Record<SendPlanRow["source"], string> = { lead_profile: "Their own habits", persona_history: "Similar contacts", default: "Industry best practice" };
const RECENT_CONTACTS = 8;

/** "Tue–Thu, 9 AM–11 AM" -> ["Tue–Thu", "9 AM – 11 AM"] */
function splitWindow(label: string): [string, string] {
  const i = label.indexOf(", ");
  return i < 0 ? [label, ""] : [label.slice(0, i), label.slice(i + 2).replace("–", " – ")];
}

// Always 12-hour (AM/PM) so these match the "9 AM – 11 AM" windows, whatever the browser's locale
const formatNext = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** 7 x 24 activity map: one hue, light to dark, so darker always means more clicks and replies */
function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(0, ...grid.flat());
  const cells = grid.flatMap((row, d) => row.map((v, h) => ({ d, h, v }))).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
  return (
    <>
      <div className="heat-scroll">
        <div className="heat" role="img" aria-label={`Clicks and replies by weekday and hour. Busiest: ${cells.slice(0, 3).map((c) => `${DAY_SHORT[c.d]} ${hourLabel(c.h)}`).join(", ")}`}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="heat-hour">{h % 3 === 0 ? hourLabel(h).replace(" ", "") : ""}</span>
          ))}
          {grid.map((row, d) => (
            <React.Fragment key={d}>
              <span className="heat-day">{DAY_SHORT[d]}</span>
              {row.map((v, h) => (
                <span
                  key={h}
                  className="heat-cell"
                  style={{ "--heat": max ? 12 + Math.round((v / max) * 88) : 0 } as React.CSSProperties}
                  data-empty={v === 0 || undefined}
                  title={`${DAY_SHORT[d]} ${hourLabel(h)}: ${v === 0 ? "no activity" : `activity ${v}`}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>Less</span>
        {[12, 34, 56, 78, 100].map((s) => <i key={s} style={{ "--heat": s } as React.CSSProperties} />)}
        <span>More</span>
      </div>
      <details className="lab-details">
        <summary>Show as a table</summary>
        <table className="table">
          <thead><tr><th>Day</th><th>Hour (their time)</th><th>Activity</th></tr></thead>
          <tbody>
            {cells.map((c) => <tr key={`${c.d}-${c.h}`}><td>{DAY_SHORT[c.d]}</td><td>{hourLabel(c.h)}</td><td>{c.v}</td></tr>)}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** Best time to email each audience, a planner for specific people, and (once there's data) when contacts actually engage */
export function SendTimesPanel({ onNewCampaign, onUseDraft }: { onNewCampaign: () => void; onUseDraft: (draft: CampaignDraft) => void }) {
  const [data, setData] = useState<SendTimeInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState("all");
  const [device, setDevice] = useState("all");
  const [recipients, setRecipients] = useState("");
  const [plan, setPlan] = useState<SendPlanRow[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  // Shown after every click, so a repeat click with the same answer still visibly responds
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(async () => {
      // No timezone parameter: contacts without a location are assumed to be on US Eastern time, not the viewer's
      const res = await callApi<SendTimeInsights>("/insights/send-time");
      setData(res.data);
      setError(res.error);
    }, 0);
    return () => clearTimeout(timer);
  }, [attempt]);

  const personas = useMemo(() => ["all", ...Object.keys(data?.heatmaps ?? {}).filter((p) => p !== "all")], [data]);
  const devices = useMemo(() => ["all", ...Object.keys(data?.heatmaps[persona] ?? {}).filter((d) => d !== "all")], [data, persona]);
  const cell = data?.heatmaps[persona]?.[device];

  const runPlan = async (list: string[]) => {
    if (!list.length) return;
    setPlanning(true);
    const res = await callApi<SendPlanRow[]>("/insights/send-plan", { recipients: list });
    setPlanning(false);
    setPlan(res.data);
    setPlanError(res.error);
    setCheckedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }));
  };

  const planRecentContacts = async () => {
    const res = await callApi<Lead[]>(`/leads?limit=${RECENT_CONTACTS}`);
    if (res.error) return setPlanError(res.error);
    const emails = (res.data ?? []).map((l) => l.email);
    if (!emails.length) return setPlanError("You don't have any contacts yet. Send a campaign first, or type addresses above.");
    setRecipients(emails.join("\n"));
    runPlan(emails);
  };

  if (error) return <LoadError message={error} onRetry={() => { setError(null); setAttempt((a) => a + 1); }} />;
  if (!data) return <div className="card empty"><div className="loader" /></div>;
  const hasActivity = data.engagement_events > 0;
  const anyLearned = Object.values(data.windows).some((w) => w.learned);
  const tzName = browserTimezone().split("/").pop()!.replace(/_/g, " ");

  return (
    <div className="lab-stack">
      {/* What to do with this page, in one glance */}
      <div className="st-intro">
        <span className="st-intro-icon"><Sparkles size={18} /></span>
        <div>
          <strong>You don&apos;t have to do anything here.</strong> When you send a campaign, the review before sending tells you if the time is off
          and offers a better one with one click, and follow-ups go out at each person&apos;s best time automatically.
          Use this page when you want to plan a send yourself.
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onNewCampaign}><Send size={14} /> New campaign</button>
      </div>

      {/* 1. The answer: best time per audience */}
      <section>
        <div className="st-section-head">
          <h2><Clock size={17} /> Best times to send</h2>
          <span className={`pill no-dot ${anyLearned ? "tone-success" : "tone-neutral"}`}>
            {anyLearned ? "Learned from your contacts" : "Industry best practice"}
          </span>
        </div>
        <div className="st-cards">
          {AUDIENCES.map((a) => {
            const w = data.windows[a.id];
            if (!w) return null;
            const [days, hours] = splitWindow(w.label);
            return (
              <article key={a.id} className="st-card">
                <div className="st-card-top">
                  <span className="st-card-icon">{a.icon}</span>
                  <h3>{a.label}</h3>
                </div>
                <div className="st-card-time">
                  <strong>{hours}</strong>
                  <span>{days}</span>
                </div>
                <p className="st-card-why">{w.learned ? `Learned from ${w.events} clicks and replies by your contacts.` : w.why}</p>
                <div className={`st-card-next ${w.open_now ? "is-now" : ""}`}>
                  <CalendarClock size={14} />
                  {w.open_now ? (
                    <span><strong>Good time right now</strong> · next after this: {formatNext(w.next_at)}</span>
                  ) : (
                    <span>Next good time: <strong>{formatNext(w.next_at)}</strong></span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="field-hint" style={{ marginTop: "0.6rem" }}>
          The hours are in each contact&apos;s own timezone (from their ZIP code or state; US Eastern if unknown).
          &ldquo;Next good time&rdquo; is converted to your time ({tzName}).
        </p>
      </section>

      {/* 2. A planner for specific people */}
      <div className="card">
        <div className="card-head" style={{ marginBottom: "0.9rem" }}>
          <div>
            <h2 className="card-title"><Wand2 size={17} /> Find the best time for specific people</h2>
            <p className="card-sub">Enter one or more email addresses and get the next good time to reach each person.</p>
          </div>
        </div>
        <div className="st-planner">
          <textarea
            className="input textarea"
            rows={3}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder={"sam@builders.com\njo@studio.com"}
            aria-label="Email addresses"
          />
          <div className="lab-row">
            <button className="btn btn-primary" onClick={() => runPlan(parseEmails(recipients))} disabled={planning || parseEmails(recipients).length === 0}>
              {planning ? "Finding times…" : "Find best times"}
            </button>
            <button className="btn btn-secondary" onClick={planRecentContacts} disabled={planning}>
              <Users size={15} /> Use my recent contacts
            </button>
          </div>
        </div>
        {planError && <div className="alert alert-danger" role="alert" style={{ marginTop: "0.9rem" }}>{planError}</div>}
        {plan && plan.length > 0 && (
          <div className="st-answer" role="status" aria-live="polite">
            <CalendarClock size={18} />
            <div>
              <strong>
                {plan.length === 1
                  ? plan[0].open_now
                    ? `Send to ${plan[0].recipient} now. It's a good time for them.`
                    : `Best time to send to ${plan[0].recipient}: ${formatNext(plan[0].send_at_utc, plan[0].timezone)} their time.`
                  : `${plan.filter((r) => r.open_now).length} of ${plan.length} people are in a good time right now. Details for each person below.`}
              </strong>
              <span>Checked at {checkedAt}</span>
            </div>
            <button
              className="btn btn-secondary btn-sm st-answer-btn"
              onClick={() => onUseDraft({ subject: "", body: "", recipients: plan.map((r) => r.recipient).join("\n") })}
            >
              <Send size={14} /> Write email to {plan.length === 1 ? "this person" : `these ${plan.length} people`}
            </button>
          </div>
        )}
        {plan && (
          <ul className="st-plan">
            {plan.map((r) => (
              <li key={r.recipient}>
                <div className="st-plan-who">
                  <strong className="truncate">{r.recipient}</strong>
                  <span>{AUDIENCE_LABEL[r.persona] ?? r.persona} · {SOURCE_LABEL[r.source]}</span>
                </div>
                <div className="st-plan-when">
                  <span className="st-plan-label">Next good time</span>
                  {r.open_now ? <strong className="st-now">Right now</strong> : <strong>{formatNext(r.send_at_utc, r.timezone)}</strong>}
                  <span>their time ({r.timezone.split("/").pop()!.replace(/_/g, " ")}{r.timezone_known ? "" : ", assumed"})</span>
                </div>
                <div className="st-plan-when">
                  <span className="st-plan-label">Usually best</span>
                  <strong>{r.window}</strong>
                  {r.follow_up_after_hours ? <span>Follow up after {r.follow_up_after_hours} hours</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3. Real activity, once there is some */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title"><MousePointerClick size={17} /> When your contacts actually engage</h2>
            <p className="card-sub">Clicks and replies by day and hour, in each person&apos;s own time. Opens aren&apos;t counted because email apps open messages automatically.</p>
          </div>
          {hasActivity && (
            <div className="lab-row">
              <select className="input lab-select" aria-label="Audience" value={persona} onChange={(e) => { setPersona(e.target.value); setDevice("all"); }}>
                {personas.map((p) => <option key={p} value={p}>{AUDIENCE_LABEL[p] ?? p}</option>)}
              </select>
              <select className="input lab-select" aria-label="Device" value={device} onChange={(e) => setDevice(e.target.value)}>
                {devices.map((d) => <option key={d} value={d}>{DEVICE_LABEL[d] ?? d}</option>)}
              </select>
            </div>
          )}
        </div>

        {hasActivity ? (
          <>
            <div className="st-mini-stats">
              <span><strong>{cell?.clicks ?? 0}</strong> clicks</span>
              <span><strong>{cell?.replies ?? 0}</strong> replies</span>
              <span>last {data.days} days</span>
              {data.timezone_assumed > 0 && <span className="field-hint">{data.timezone_assumed} from contacts with no location (add ZIP or state for exact times)</span>}
            </div>
            <Heatmap grid={cell?.grid ?? []} />
          </>
        ) : (
          <div className="st-empty">
            <p className="st-empty-lead">Your activity map appears here once people start clicking and replying. Until then, the best-practice times above are used.</p>
            <ol className="st-steps">
              <li><span><Send size={16} /></span><div><strong>Send a campaign</strong><p>Every email is tracked for clicks.</p></div></li>
              <li><span><MousePointerClick size={16} /></span><div><strong>People click or reply</strong><p>Log replies in Engagement data, since they land in your own inbox.</p></div></li>
              <li><span><Sparkles size={16} /></span><div><strong>Times become personal</strong><p>After {data.thresholds.persona_events} responses per audience, the cards above switch to your own contacts&apos; habits.</p></div></li>
            </ol>
          </div>
        )}

        <div className="st-followup-note">
          <Info size={15} />
          <span>
            {data.reply_delay.median_hours === null
              ? "Follow-ups wait longer for people who usually take a while to reply. This adjusts automatically once replies are logged."
              : `Your contacts usually reply within ${data.reply_delay.median_hours} hours, so follow-ups ${data.reply_delay.follow_up_after_hours ? `wait at least ${data.reply_delay.follow_up_after_hours} hours` : "don't need extra waiting"}.`}
          </span>
        </div>
      </div>
    </div>
  );
}
