"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CHECK_NAMES, DecisionLog, STATUS_LABEL, STATUS_TONE, callApi } from "@/lib/insights";
import { formatDateTime } from "@/lib/campaigns";
import { LoadError } from "./LoadError";

const OUTCOME: Record<string, string> = { sent: "Sent", scheduled: "Scheduled", cancelled: "Went back to edit" };

/** Every review shown before sending, and how often each check's advice was taken or ignored */
export function ReviewHistoryPanel({ onNewCampaign }: { onNewCampaign: () => void }) {
  const [log, setLog] = useState<DecisionLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await callApi<DecisionLog>("/campaign/preflight/decisions?limit=100");
    setLog(res.data);
    setError(res.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (error) return <LoadError message={error} onRetry={load} />;
  if (!log) return <div className="card empty"><div className="loader" /></div>;
  const s = log.summary;
  const checks = Object.entries(s.per_check).sort((x, y) => y[1].accepted + y[1].ignored - (x[1].accepted + x[1].ignored));

  return (
    <div className="lab-stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Reviews before sending</h2>
            <p className="card-sub">
              Every campaign is reviewed before it goes out. A failed check stops the send until it&apos;s fixed, or until someone overrides it with a reason.
              This page shows which advice your team takes and which it skips.
            </p>
          </div>
          <div className="lab-row">
            <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
            <button className="btn btn-secondary btn-sm" onClick={onNewCampaign}>New campaign</button>
          </div>
        </div>
        <div className="lab-tiles">
          <div className="lab-tile"><span>Reviews</span><strong>{s.decisions}</strong></div>
          <div className="lab-tile"><span>Sent despite a failed check</span><strong>{s.overridden}</strong><em>each with a reason</em></div>
          <div className="lab-tile"><span>Went back to edit</span><strong>{s.cancelled}</strong></div>
        </div>
      </div>

      {s.decisions === 0 ? (
        <div className="card">
          <p className="field-hint">No reviews yet. They appear here after your next campaign.</p>
        </div>
      ) : (
        <>
          <div className="card card-flush">
            <div className="lab-pad">
              <h2 className="card-title">Advice taken vs ignored</h2>
            </div>
            <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Check</th><th>Accepted</th><th>Ignored</th><th>Taken</th></tr></thead>
              <tbody>
                {checks.map(([id, c]) => {
                  const rate = c.accepted + c.ignored ? Math.round((c.accepted / (c.accepted + c.ignored)) * 100) : 0;
                  return (
                    <tr key={id}>
                      <td>{CHECK_NAMES[id] ?? id}</td>
                      <td>{c.accepted}</td>
                      <td>{c.ignored}</td>
                      <td>
                        <span className="lab-bar lab-bar-inline" aria-hidden="true"><i style={{ transform: `scaleX(${rate / 100})` }} /></span> {rate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>

          <div className="card card-flush">
            <div className="lab-pad">
              <h2 className="card-title">Recent decisions</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Verdict</th><th>Outcome</th><th>Accepted</th><th>Ignored</th><th>Override reason</th></tr></thead>
                <tbody>
                  {log.decisions.map((d) => (
                    <tr key={d.id}>
                      <td>{formatDateTime(d.created_at)}</td>
                      <td><span className={`pill no-dot ${STATUS_TONE[d.verdict]}`}>{STATUS_LABEL[d.verdict]}</span></td>
                      <td>{OUTCOME[d.outcome]}</td>
                      <td>{d.accepted.map((c) => CHECK_NAMES[c] ?? c).join(", ") || "—"}</td>
                      <td>{d.ignored.map((c) => CHECK_NAMES[c] ?? c).join(", ") || "—"}</td>
                      <td>{d.overridden ? d.override_reason : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
