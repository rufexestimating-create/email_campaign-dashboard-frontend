"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Flame,
  Info,
  Mail,
  MailCheck,
  MailOpen,
  MousePointerClick,
  RefreshCw,
  Reply,
  Search,
  Send,
  Snowflake,
  Sprout,
  TriangleAlert,
  Users,
} from "lucide-react";
import { BAND_INFO, Engagement, LeadScoresOverview, LifecycleStage, ScoreBand, ScoredLead, callApi } from "@/lib/insights";
import { apiFetch, errorMessage, NETWORK_ERROR } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { LoadError } from "@/components/insights/LoadError";
import { Pagination, usePagination } from "@/components/dashboard/Pagination";

/** Stage you set as the conversation moves on. Ready to talk business, Customer and Lost stop automatic follow-ups. */
const STAGES: { id: LifecycleStage; label: string; tone: string }[] = [
  { id: "new", label: "New", tone: "neutral" },
  { id: "mql", label: "Interested", tone: "info" },
  { id: "sql", label: "Ready to talk business", tone: "violet" },
  { id: "customer", label: "Customer", tone: "success" },
  { id: "lost", label: "Lost", tone: "danger" },
];
const STAGE_TONE = Object.fromEntries(STAGES.map((s) => [s.id, s.tone])) as Record<LifecycleStage, string>;

/** Best thing that happened across all the emails a contact received; always shown as text plus an icon, never colour alone */
const ENGAGEMENT: Record<Engagement, { label: string; tone: string; icon: React.ReactNode }> = {
  replied: { label: "Replied", tone: "success", icon: <Reply size={13} /> },
  clicked: { label: "Clicked a link", tone: "success", icon: <MousePointerClick size={13} /> },
  opened: { label: "Opened", tone: "info", icon: <MailOpen size={13} /> },
  delivered: { label: "Delivered", tone: "neutral", icon: <MailCheck size={13} /> },
  sent: { label: "Sent", tone: "neutral", icon: <Send size={13} /> },
  bounced: { label: "Bounced", tone: "danger", icon: <TriangleAlert size={13} /> },
  complained: { label: "Marked as spam", tone: "danger", icon: <TriangleAlert size={13} /> },
  none: { label: "Not emailed yet", tone: "neutral", icon: <Mail size={13} /> },
};
const PERSONA: Record<string, string> = { contractor: "Contractor", architect: "Architect", homeowner: "Homeowner", other: "Business" };

type ActivityFilter = "all" | "engaged" | "replied" | "problem";
const ACTIVITY: Record<Exclude<ActivityFilter, "all">, (e: Engagement) => boolean> = {
  engaged: (e) => e === "opened" || e === "clicked",
  replied: (e) => e === "replied",
  problem: (e) => e === "bounced" || e === "complained",
};

const AVATAR_TONES = ["primary", "info", "violet", "success", "warning"];
function avatarTone(email: string) {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
/** "Sarah Lee" -> "SL", no name -> first letter of the email */
function initials(l: ScoredLead) {
  const words = (l.name ?? "").trim().split(/\s+/).filter(Boolean);
  return (words.length ? words.slice(0, 2).map((w) => w[0]) : [l.email[0]]).join("").toUpperCase();
}
/** "just now", "5 min ago", "3 h ago", "2 days ago"; empty after a week (the full date is shown anyway) */
function timeAgo(iso: string) {
  const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  const days = Math.floor(minutes / (60 * 24));
  return days < 7 ? `${days} day${days === 1 ? "" : "s"} ago` : "";
}

// Lead scoring (reply / interested / ready-to-buy chances, priority bands) is hidden for now: its model still learns
// from sample data and most leads have no score, so the numbers would mislead. Set to true to show the scores again.
const SHOW_LEAD_SCORES = false;
const BAND_ICON: Record<ScoreBand, React.ReactNode> = { sales: <Flame size={17} />, nurture: <Sprout size={17} />, awareness: <Snowflake size={17} /> };
const BAND_TONE: Record<ScoreBand, string> = { sales: "stat--success", nurture: "stat--violet", awareness: "stat--info" };
const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

/** Likelihood as a small bar plus the number, so a column of them reads at a glance */
function Likelihood({ p }: { p: number | null }) {
  return (
    <span className="lab-prob">
      <span className="lab-bar" aria-hidden="true"><i style={{ transform: `scaleX(${p ?? 0})` }} /></span>
      {pct(p)}
    </span>
  );
}

/** Everyone your campaigns have emailed: who they are, how they've engaged, and the stage you've set */
/** `onOpenModels` is left out while the Insights tab is hidden, and the "How scoring works" link goes with it */
export function LeadsPage({ notify, onOpenModels }: { notify: (msg: string, isError?: boolean) => void; onOpenModels?: () => void }) {
  const [data, setData] = useState<LeadScoresOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [band, setBand] = useState<"all" | ScoreBand>("all");
  const [activity, setActivity] = useState<ActivityFilter>("all");
  const [stage, setStage] = useState<"all" | LifecycleStage>("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await callApi<LeadScoresOverview>("/leads/scores");
    setData(res.data);
    setError(res.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const rescore = async () => {
    setScoring(true);
    const res = await callApi<{ scored: number; leads_added: number }>("/leads/score", {});
    setScoring(false);
    if (res.error) return notify(res.error, true);
    const added = res.data!.leads_added;
    notify(`Updated scores for ${res.data!.scored} leads${added ? `, including ${added} new contact${added === 1 ? "" : "s"}` : ""}.`);
    load();
  };

  const changeStage = async (lead: ScoredLead, next: LifecycleStage) => {
    setSaving(lead.id);
    try {
      const res = await apiFetch(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ lifecycle_stage: next }) });
      if (!res.ok) return notify(errorMessage(await res.json(), "We couldn't update that lead."), true);
      setData((d) => d && { ...d, leads: d.leads.map((l) => (l.id === lead.id ? { ...l, lifecycle_stage: next } : l)) });
      const stops = next === "sql" || next === "customer" || next === "lost";
      notify(`${lead.name || lead.email} is now ${STAGES.find((s) => s.id === next)!.label.toLowerCase()}.${stops ? " Their automatic follow-ups are stopped." : ""}`);
    } catch {
      notify(NETWORK_ERROR, true);
    } finally {
      setSaving(null);
    }
  };

  const counts = useMemo(() => {
    const leads = data?.leads ?? [];
    return {
      all: leads.length,
      engaged: leads.filter((l) => ACTIVITY.engaged(l.engagement)).length,
      replied: leads.filter((l) => ACTIVITY.replied(l.engagement)).length,
      problem: leads.filter((l) => ACTIVITY.problem(l.engagement)).length,
    };
  }, [data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.leads ?? []).filter(
      (l) =>
        (band === "all" || l.score_band === band) &&
        (activity === "all" || ACTIVITY[activity](l.engagement)) &&
        (stage === "all" || l.lifecycle_stage === stage) &&
        (!q || [l.email, l.name, l.company].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [data, band, activity, stage, query]);
  const pager = usePagination(shown, `${band}|${activity}|${stage}|${query}`, 25);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!data) return <div className="card empty"><div className="loader" /></div>;
  const starter = data.model?.data_source === "synthetic";
  const filtered = activity !== "all" || stage !== "all" || !!query.trim();
  const clearFilters = () => { setQuery(""); setBand("all"); setActivity("all"); setStage("all"); };

  const activityCards: { id: Exclude<ActivityFilter, "all">; label: string; tone: string; icon: React.ReactNode; foot: string }[] = [
    { id: "engaged", label: "Engaged", tone: "stat--success", icon: <MousePointerClick size={17} />, foot: "Opened or clicked your emails. Worth a personal follow-up." },
    { id: "replied", label: "Replied", tone: "stat--violet", icon: <Reply size={17} />, foot: "Answered you. Move them on to the next stage." },
    { id: "problem", label: "Can't be reached", tone: "stat--danger", icon: <TriangleAlert size={17} />, foot: "Bounced or marked as spam. Leave them out of new campaigns." },
  ];

  return (
    <div className="lab-stack">
      {SHOW_LEAD_SCORES && data.alerts.length > 0 && (
        <div className="alert alert-success" role="status">
          <Flame size={18} />
          <div>
            <strong>{data.alerts.length} lead{data.alerts.length === 1 ? " is" : "s are"} ready for a sales conversation:</strong>{" "}
            {data.alerts.slice(0, 4).map((l) => l.name || l.email).join(", ")}
            {data.alerts.length > 4 ? ` and ${data.alerts.length - 4} more` : ""}.
          </div>
        </div>
      )}

      <section className="stats" aria-label="Lead summary">
        <button
          className={`stat stat--feature stat-btn ${activity === "all" ? "is-active" : ""}`}
          onClick={() => setActivity("all")}
          aria-pressed={activity === "all"}
        >
          <div className="stat-top">All leads<span className="stat-icon"><Users size={17} /></span></div>
          <div className="stat-value">{counts.all}</div>
          <div className="stat-foot">{SHOW_LEAD_SCORES && data.last_scored ? `Scores updated ${formatDateTime(data.last_scored)}` : "Everyone your campaigns have emailed"}</div>
        </button>
        {SHOW_LEAD_SCORES
          ? (Object.keys(BAND_INFO) as ScoreBand[]).map((b) => (
              <button key={b} className={`stat ${BAND_TONE[b]} stat-btn ${band === b ? "is-active" : ""}`} onClick={() => setBand(band === b ? "all" : b)} aria-pressed={band === b}>
                <div className="stat-top">{BAND_INFO[b].label}<span className="stat-icon">{BAND_ICON[b]}</span></div>
                <div className="stat-value">{data.bands[b] ?? 0}</div>
                <div className="stat-foot">{BAND_INFO[b].action}</div>
              </button>
            ))
          : activityCards.map((c) => (
              <button
                key={c.id}
                className={`stat ${c.tone} stat-btn ${activity === c.id ? "is-active" : ""}`}
                onClick={() => setActivity(activity === c.id ? "all" : c.id)}
                aria-pressed={activity === c.id}
              >
                <div className="stat-top">{c.label}<span className="stat-icon">{c.icon}</span></div>
                <div className="stat-value">{counts[c.id]}</div>
                <div className="stat-foot">{c.foot}</div>
              </button>
            ))}
      </section>

      <div className="card card-flush" id="leads-list">
        <div className="leads-toolbar">
          <label className="leads-search">
            <Search size={16} aria-hidden="true" />
            <input className="input" placeholder="Search name, email or company" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search leads" />
          </label>
          <select className="input lab-select" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label="Filter by stage">
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {filtered && <button className="link-btn" onClick={clearFilters}>Clear filters</button>}
          {SHOW_LEAD_SCORES && (<>
          <div className="leads-segments" aria-label="Engagement segments">
            {Object.entries(data.segments).map(([s, n]) => <span key={s} className="pill no-dot tone-neutral">{s} · {n}</span>)}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={rescore} disabled={scoring || !data.model} title={data.model ? undefined : "Lead scoring isn't set up on the server yet"}>
            <RefreshCw size={14} className={scoring ? "spin" : ""} /> {scoring ? "Updating…" : "Update scores"}
          </button>
          </>)}
          <span className="leads-count" aria-live="polite">
            <strong>{shown.length}</strong> {shown.length === 1 ? "lead" : "leads"}{filtered ? ` of ${counts.all}` : ""}
          </span>
        </div>

        <div className="stage-legend" aria-label="What each stage does">
          <span className="stage-legend-title"><Info size={14} aria-hidden="true" /> Stage controls follow-ups:</span>
          <span className="stage-legend-group">
            <span className="pill no-dot tone-neutral">New</span>
            <span className="pill no-dot tone-info">Interested</span>
            <span>follow-ups keep going</span>
          </span>
          <span className="stage-legend-group">
            <span className="pill no-dot tone-violet">Ready to talk business</span>
            <span className="pill no-dot tone-success">Customer</span>
            <span className="pill no-dot tone-danger">Lost</span>
            <span>follow-ups stop; you take it from here</span>
          </span>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Users size={24} /></div>
            <h3>{data.leads.length ? "No leads match these filters" : "No leads yet"}</h3>
            <p>{data.leads.length ? "Try clearing the search or filters." : "Everyone you email becomes a lead. Send a campaign and they appear here."}</p>
            {data.leads.length > 0 && <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear search and filters</button>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table leads-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Company</th>
                  <th className="col-num">Emails</th>
                  <th>Engagement</th>
                  <th>Last email</th>
                  {SHOW_LEAD_SCORES && (<>
                  <th title="Chance they reply to your emails">Will reply</th>
                  <th title="Chance they become genuinely interested">Interested</th>
                  <th title="Chance they become ready to talk business">Ready to buy</th>
                  <th>Priority</th>
                  </>)}
                  <th title="Ready to talk business, Customer or Lost stops their automatic follow-up emails.">Stage</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((l) => {
                  const e = ENGAGEMENT[l.engagement] ?? ENGAGEMENT.none;
                  const ago = l.last_sent_at ? timeAgo(l.last_sent_at) : "";
                  return (
                    <tr key={l.id} className={e.tone === "danger" ? "row-problem" : undefined}>
                      <td>
                        <div className="lead-person">
                          <span className={`sent-avatar av-${avatarTone(l.email)}`} aria-hidden="true">{initials(l)}</span>
                          <div className="lead-person-text">
                            <strong className="leads-name truncate" title={l.name || l.email}>{l.name || l.email.split("@")[0]}</strong>
                            <span className="lead-email truncate" title={l.email}>{l.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {l.company || l.persona ? (
                          <div className="lead-company">
                            {l.company && <span className="truncate" title={l.company}>{l.company}</span>}
                            {l.persona && <span className="pill no-dot tone-neutral lead-persona">{PERSONA[l.persona] ?? l.persona}</span>}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="col-num"><strong className="lead-emails">{l.emails_sent}</strong></td>
                      <td>
                        <span className={`pill no-dot tone-${e.tone} lead-engagement`}>{e.icon}{e.label}</span>
                      </td>
                      <td className="nowrap">
                        {l.last_sent_at ? (
                          <>
                            <div className="sent-date">{formatDateTime(l.last_sent_at)}</div>
                            {ago && <div className="field-hint">{ago}</div>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {SHOW_LEAD_SCORES && (<>
                      <td><Likelihood p={l.p_reply} /></td>
                      <td><Likelihood p={l.p_mql} /></td>
                      <td><Likelihood p={l.p_sql} /></td>
                      <td>{l.score_band ? <span className={`pill no-dot ${BAND_INFO[l.score_band].tone}`}>{BAND_INFO[l.score_band].label}</span> : "—"}</td>
                      </>)}
                      <td>
                        <div className="stage-cell">
                          <select
                            className={`input stage-select stage--${STAGE_TONE[l.lifecycle_stage] ?? "neutral"}`}
                            aria-label={`Stage for ${l.name || l.email}`}
                            title="Ready to talk business, Customer or Lost stops their automatic follow-up emails."
                            value={l.lifecycle_stage}
                            disabled={saving === l.id}
                            onChange={(ev) => changeStage(l, ev.target.value as LifecycleStage)}
                          >
                            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          {(l.lifecycle_stage === "sql" || l.lifecycle_stage === "customer" || l.lifecycle_stage === "lost") && (
                            <span className="stage-note"><Check size={12} aria-hidden="true" /> Follow-ups off</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...pager} noun="leads" scrollTo="leads-list" />
      </div>

      {SHOW_LEAD_SCORES && <div className="leads-note">
        <Info size={16} aria-hidden="true" />
        <p>
          Likelihoods are estimates based on the emails each contact has received, their clicks and replies, and their profile.
          {starter
            ? " The scoring model is still a starter model built on sample data. Set each lead's stage as deals progress and it will learn from your own results."
            : " The model learns from the stages you set, so keep them up to date."}
        </p>
        {onOpenModels && <button className="link-btn" onClick={onOpenModels}>How scoring works <ArrowRight size={14} style={{ verticalAlign: "-2px" }} /></button>}
      </div>}
    </div>
  );
}
