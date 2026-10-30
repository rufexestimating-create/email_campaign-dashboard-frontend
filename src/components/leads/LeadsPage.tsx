"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Flame, Info, RefreshCw, Search, Snowflake, Sprout, Users } from "lucide-react";
import { BAND_INFO, LeadScoresOverview, LifecycleStage, ScoreBand, ScoredLead, callApi } from "@/lib/insights";
import { apiFetch, errorMessage, NETWORK_ERROR } from "@/lib/auth";
import { formatDateTime } from "@/lib/campaigns";
import { LoadError } from "@/components/insights/LoadError";

const STAGES: { id: LifecycleStage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "mql", label: "Interested" },
  { id: "sql", label: "Ready to talk business" },
  { id: "customer", label: "Customer" },
  { id: "lost", label: "Lost" },
];
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

/** Every contact you've emailed, ranked by how likely they are to become a sales opportunity */
export function LeadsPage({ notify, onOpenModels }: { notify: (msg: string, isError?: boolean) => void; onOpenModels: () => void }) {
  const [data, setData] = useState<LeadScoresOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const [band, setBand] = useState<"all" | ScoreBand>("all");
  const [stage, setStage] = useState<"all" | LifecycleStage>("all");
  const [query, setQuery] = useState("");

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
    try {
      const res = await apiFetch(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ lifecycle_stage: next }) });
      if (!res.ok) return notify(errorMessage(await res.json(), "We couldn't update that lead."), true);
      setData((d) => d && { ...d, leads: d.leads.map((l) => (l.id === lead.id ? { ...l, lifecycle_stage: next } : l)) });
      notify(`${lead.name || lead.email} is now ${STAGES.find((s) => s.id === next)!.label.toLowerCase()}.`);
    } catch {
      notify(NETWORK_ERROR, true);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.leads ?? []).filter(
      (l) =>
        (band === "all" || l.score_band === band) &&
        (stage === "all" || l.lifecycle_stage === stage) &&
        (!q || [l.email, l.name, l.company].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [data, band, stage, query]);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!data) return <div className="card empty"><div className="loader" /></div>;
  const starter = data.model?.data_source === "synthetic";

  return (
    <div className="lab-stack">
      {data.alerts.length > 0 && (
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
        <div className="stat stat--feature">
          <div className="stat-top">All leads<span className="stat-icon"><Users size={17} /></span></div>
          <div className="stat-value">{data.leads.length}</div>
          <div className="stat-foot">{data.last_scored ? `Updated ${formatDateTime(data.last_scored)}` : "Not scored yet"}</div>
        </div>
        {(Object.keys(BAND_INFO) as ScoreBand[]).map((b) => (
          <button
            key={b}
            className={`stat ${BAND_TONE[b]} stat-btn ${band === b ? "is-active" : ""}`}
            onClick={() => setBand(band === b ? "all" : b)}
            aria-pressed={band === b}
          >
            <div className="stat-top">{BAND_INFO[b].label}<span className="stat-icon">{BAND_ICON[b]}</span></div>
            <div className="stat-value">{data.bands[b] ?? 0}</div>
            <div className="stat-foot">{BAND_INFO[b].action}</div>
          </button>
        ))}
      </section>

      <div className="card card-flush">
        <div className="leads-toolbar">
          <label className="leads-search">
            <Search size={16} aria-hidden="true" />
            <input className="input" placeholder="Search name, email or company" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search leads" />
          </label>
          <select className="input lab-select" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} aria-label="Filter by stage">
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="leads-segments" aria-label="Engagement segments">
            {Object.entries(data.segments).map(([s, n]) => <span key={s} className="pill no-dot tone-neutral">{s} · {n}</span>)}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={rescore}
            disabled={scoring || !data.model}
            title={data.model ? undefined : "Lead scoring isn't set up on the server yet"}
          >
            <RefreshCw size={14} className={scoring ? "spin" : ""} /> {scoring ? "Updating…" : "Update scores"}
          </button>
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Users size={24} /></div>
            <h3>{data.leads.length ? "No leads match these filters" : "No leads yet"}</h3>
            <p>{data.leads.length ? "Try clearing the search or filters." : "Everyone you email becomes a lead. Send a campaign, then update scores."}</p>
            {data.leads.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setQuery(""); setBand("all"); setStage("all"); }}>
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th title="Chance they reply to your emails">Will reply</th>
                  <th title="Chance they become genuinely interested">Interested</th>
                  <th title="Chance they become ready to talk business">Ready to buy</th>
                  <th>Priority</th>
                  <th>Engagement</th>
                  <th title="Set this yourself as the conversation moves on. The scores learn from it.">Stage (you set)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td className="truncate">
                      <strong className="leads-name">{l.name || l.email}</strong>
                      <div className="field-hint">{[l.name ? l.email : null, l.company, l.persona].filter(Boolean).join(" · ") || "No details yet"}</div>
                    </td>
                    <td><Likelihood p={l.p_reply} /></td>
                    <td><Likelihood p={l.p_mql} /></td>
                    <td><Likelihood p={l.p_sql} /></td>
                    <td>{l.score_band ? <span className={`pill no-dot ${BAND_INFO[l.score_band].tone}`}>{BAND_INFO[l.score_band].label}</span> : "—"}</td>
                    <td>{l.segment ?? "—"}</td>
                    <td>
                      <select className="input lab-select-sm" aria-label={`Stage for ${l.email}`} value={l.lifecycle_stage} onChange={(e) => changeStage(l, e.target.value as LifecycleStage)}>
                        {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="leads-note">
        <Info size={16} aria-hidden="true" />
        <p>
          Likelihoods are estimates based on the emails each contact has received, their clicks and replies, and their profile.
          {starter
            ? " The scoring model is still a starter model built on sample data. Set each lead's stage as deals progress and it will learn from your own results."
            : " The model learns from the stages you set, so keep them up to date."}
        </p>
        <button className="link-btn" onClick={onOpenModels}>How scoring works <ArrowRight size={14} style={{ verticalAlign: "-2px" }} /></button>
      </div>
    </div>
  );
}
