"use client";

import React, { useMemo, useState } from "react";
import { CircleCheck, Inbox, MailOpen, Megaphone, Search, Send, TriangleAlert } from "lucide-react";
import { emailStatus, formatDateTime, friendlyError, pct } from "@/lib/campaigns";
import { Pagination, usePagination } from "./Pagination";

export interface EmailLog {
  id: string;
  recipient: string;
  from_email: string;
  subject: string;
  status: "sent" | "failed" | "simulated";
  sent_at: string;
  error?: string | null;
  campaign_id?: string | null;
  variant?: string | null;
  last_event?: string | null;
}

const AVATAR_TONES = ["primary", "info", "violet", "success", "warning"];

// A replied email was delivered and opened too
const isDelivered = (l: EmailLog) => ["delivered", "opened", "clicked", "replied"].includes(l.last_event ?? "");
const isOpened = (l: EmailLog) => ["opened", "clicked", "replied"].includes(l.last_event ?? "");
const isProblem = (l: EmailLog) => l.status === "failed" || ["bounced", "complained"].includes(l.last_event ?? "");

function avatarTone(email: string) {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** "Today", "Yesterday" or "Tuesday, 27 October" */
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
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

export function ActivityLog({ logs, campaignNames }: { logs: EmailLog[]; campaignNames: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [campaign, setCampaign] = useState("all");

  // Count each status label (Delivered, Opened, Bounced…) for the filter chips
  const statusCounts = useMemo(() => {
    const counts = new Map<string, { count: number; tone: string }>();
    for (const l of logs) {
      const s = emailStatus(l.status, l.last_event);
      counts.set(s.label, { count: (counts.get(s.label)?.count ?? 0) + 1, tone: s.tone });
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [logs]);

  const campaignOptions = useMemo(() => {
    const ids = [...new Set(logs.map((l) => l.campaign_id).filter((id): id is string => !!id))];
    return ids.map((id) => ({ id, name: campaignNames[id] ?? "Deleted campaign" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, campaignNames]);

  const summary = useMemo(() => {
    const sent = logs.filter((l) => l.status !== "failed").length;
    return {
      sent,
      delivered: logs.filter(isDelivered).length,
      opened: logs.filter(isOpened).length,
      problems: logs.filter(isProblem).length,
    };
  }, [logs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (status === "all" || emailStatus(l.status, l.last_event).label === status) &&
        (campaign === "all" || l.campaign_id === campaign) &&
        (!q ||
          l.recipient.toLowerCase().includes(q) ||
          l.subject.toLowerCase().includes(q) ||
          (l.campaign_id && campaignNames[l.campaign_id]?.toLowerCase().includes(q)))
    );
  }, [logs, query, status, campaign, campaignNames]);
  const pager = usePagination(visible, `${query}|${status}|${campaign}`, 25);

  if (!logs.length) {
    return (
      <div className="card empty animate-fade-in">
        <div className="empty-icon"><Inbox size={26} /></div>
        <h3>No emails sent yet</h3>
        <p>Every email your campaigns send will be listed here, with whether it arrived.</p>
      </div>
    );
  }

  // Emails per day on this page, for the day headings
  const perDay = new Map<string, number>();
  for (const l of pager.pageItems) perDay.set(dayLabel(l.sent_at), (perDay.get(dayLabel(l.sent_at)) ?? 0) + 1);

  const rows: React.ReactNode[] = [];
  let lastDay = "";
  for (const l of pager.pageItems) {
    const day = dayLabel(l.sent_at);
    if (day !== lastDay) {
      lastDay = day;
      rows.push(
        <tr key={`day-${day}`} className="day-row">
          <td colSpan={5}>
            {day} <span>{perDay.get(day)} email{perDay.get(day) === 1 ? "" : "s"}</span>
          </td>
        </tr>
      );
    }
    const s = emailStatus(l.status, l.last_event);
    const ago = timeAgo(l.sent_at);
    rows.push(
      <tr key={l.id} className={isProblem(l) ? "row-problem" : undefined}>
        <td>
          <div className="sent-to">
            <span className={`sent-avatar av-${avatarTone(l.recipient)}`} aria-hidden="true">{l.recipient[0]?.toUpperCase()}</span>
            <span className="truncate" title={l.recipient}>{l.recipient}</span>
          </div>
        </td>
        <td className="truncate sent-subject" title={l.subject}>{l.subject}</td>
        <td>
          {l.campaign_id ? (
            <span className="sent-campaign">
              <Megaphone size={13} />
              <span className="truncate">{campaignNames[l.campaign_id] ?? "Deleted campaign"}</span>
              {l.variant && <span className={`version-tag version-${l.variant.toLowerCase()}`}>{l.variant}</span>}
            </span>
          ) : (
            <span className="muted">Single email</span>
          )}
        </td>
        <td>
          <span className={`pill tone-${s.tone}`}>{s.label}</span>
          {l.error && <div className="cell-error">{friendlyError(l.error)}</div>}
        </td>
        <td className="nowrap">
          <div className="sent-date">{formatDateTime(l.sent_at)}</div>
          {ago && <div className="field-hint">{ago}</div>}
        </td>
      </tr>
    );
  }

  return (
    <div className="animate-fade-in" id="sent-list">
      <section className="stats" aria-label="Sent email summary">
        <div className="stat stat--info">
          <div className="stat-top">Emails sent <span className="stat-icon"><Send size={17} /></span></div>
          <div className="stat-value">{summary.sent.toLocaleString()}</div>
          <div className="stat-foot">Your latest {logs.length} emails</div>
        </div>
        <div className="stat stat--success">
          <div className="stat-top">Arrived <span className="stat-icon"><CircleCheck size={17} /></span></div>
          <div className="stat-value">{pct(summary.delivered, summary.sent)}%</div>
          <div className="stat-meter" aria-hidden="true"><span style={{ transform: `scaleX(${(pct(summary.delivered, summary.sent)) / 100})` }} /></div>
          <div className="stat-foot">{summary.delivered} reached the inbox</div>
        </div>
        <div className="stat stat--primary">
          <div className="stat-top">Opened <span className="stat-icon"><MailOpen size={17} /></span></div>
          <div className="stat-value">{pct(summary.opened, summary.sent)}%</div>
          <div className="stat-meter" aria-hidden="true"><span style={{ transform: `scaleX(${(pct(summary.opened, summary.sent)) / 100})` }} /></div>
          <div className="stat-foot">{summary.opened} people opened your email</div>
        </div>
        <div className={`stat ${summary.problems ? "stat--danger" : "stat--neutral"}`}>
          <div className="stat-top">Problems <span className="stat-icon"><TriangleAlert size={17} /></span></div>
          <div className="stat-value">{summary.problems}</div>
          <div className="stat-foot">{summary.problems ? "Not sent or bounced: see the red rows" : "Nothing went wrong"}</div>
        </div>
      </section>

      <div className="toolbar">
        <div className="filters" role="group" aria-label="Filter by status">
          <button className={`filter ${status === "all" ? "active" : ""}`} onClick={() => setStatus("all")}>All · {logs.length}</button>
          {statusCounts.map(([label, s]) => (
            <button key={label} className={`filter filter-dot tone-dot-${s.tone} ${status === label ? "active" : ""}`} onClick={() => setStatus(label)}>
              {label} · {s.count}
            </button>
          ))}
        </div>
        <div className="sent-tools">
          {campaignOptions.length > 1 && (
            <select className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Filter by campaign">
              <option value="all">All campaigns</option>
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <label className="search">
            <Search size={16} />
            <input className="input" placeholder="Search by email, subject or campaign" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sent emails" />
          </label>
        </div>
      </div>

      <div className="card card-flush sent-card">
        <div className="table-wrap">
          <table className="table sent-table">
            <thead>
              <tr>
                <th>Sent to</th>
                <th>Subject</th>
                <th>Campaign</th>
                <th>Did it arrive?</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-2" style={{ textAlign: "center", padding: "2.5rem" }}>
                    No emails match {query ? <>&quot;{query}&quot;</> : "this filter"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination {...pager} noun="emails" scrollTo="sent-list" />
      </div>
    </div>
  );
}
