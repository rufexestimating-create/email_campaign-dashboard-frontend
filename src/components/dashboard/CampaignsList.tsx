"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleStop,
  Ellipsis,
  MailOpen,
  MailPlus,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  Trophy,
  Users,
} from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import {
  Campaign,
  CampaignLog,
  CampaignStatus,
  STATUS_LABELS,
  Variant,
  VariantStats,
  describeCron,
  emailStatus,
  formatDateTime,
  friendlyError,
  humanizeTags,
  pct,
} from "@/lib/campaigns";

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
import type { ConfirmRequest } from "./ConfirmDialog";
import { Pagination, usePagination } from "./Pagination";

type Notify = (msg?: string, isError?: boolean) => void;

const EMPTY: VariantStats = { total: 0, sent: 0, simulated: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: "tone-neutral",
  scheduled: "tone-primary",
  sending: "tone-info live",
  sent: "tone-success",
  paused: "tone-warning",
  failed: "tone-danger",
};

const FILTERS: { id: "all" | CampaignStatus | "upcoming"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Scheduled" },
  { id: "sent", label: "Sent" },
  { id: "draft", label: "Drafts" },
  { id: "paused", label: "Paused" },
  { id: "failed", label: "Needs attention" },
];

function totals(c: Campaign): VariantStats {
  const sum = { ...EMPTY };
  for (const s of Object.values(c.variant_stats)) {
    if (!s) continue;
    (Object.keys(sum) as (keyof VariantStats)[]).forEach((k) => (sum[k] += s[k] ?? 0));
  }
  return sum;
}

function whenLabel(c: Campaign): string {
  if (c.schedule_type === "recurring") {
    // The repeat time is in the campaign's own time zone; say so if the viewer is somewhere else
    const base = describeCron(c.cron_expression) + (c.timezone && c.timezone !== LOCAL_TZ ? ` (${c.timezone.replace(/_/g, " ")} time)` : "");
    return c.next_run_at ? `${base} · next ${formatDateTime(c.next_run_at)}` : base;
  }
  if (c.status === "scheduled" && c.next_run_at) return `Scheduled for ${formatDateTime(c.next_run_at)}`;
  if (c.last_run_at) return `Sent ${formatDateTime(c.last_run_at)}`;
  if (c.status === "draft") return `Created ${formatDateTime(c.created_at)}`;
  if (c.schedule_type === "once") return `Planned for ${formatDateTime(c.scheduled_at)}`;
  return `Created ${formatDateTime(c.created_at)}`;
}

function ResultTile({ icon, label, count, total, tone, hint }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  tone: "success" | "primary" | "violet" | "danger";
  hint: string;
}) {
  const value = pct(count, total);
  return (
    <div className={`rtile rtile--${tone}`}>
      <div className="rtile-top">
        <span className="rtile-icon">{icon}</span>
        {label}
      </div>
      <div className="rtile-value">{value}%</div>
      <div className="rtile-track"><span style={{ transform: `scaleX(${(Math.min(value, 100)) / 100})` }} /></div>
      <div className="rtile-foot"><strong>{count}</strong> of {total} {hint}</div>
    </div>
  );
}

function Donut({ value, label }: { value: number; label: string }) {
  const r = 44;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="donut" role="img" aria-label={`${value}% ${label}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="donut-track" cx="50" cy="50" r={r} />
        <circle
          className="donut-fill"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(value, 100) / 100)}
        />
      </svg>
      <div className="donut-label">
        <strong>
          {Math.round(value)}
          <small>%</small>
        </strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

/** A short verdict in everyday words, coloured so it can be read at a glance */
function verdict(s: VariantStats): { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" } {
  const reached = s.sent + s.simulated;
  if (!reached) return s.failed ? { label: "Couldn't be sent", tone: "danger" } : { label: "Not sent yet", tone: "neutral" };
  if (s.sent && s.bounced / s.sent > 0.05) return { label: "Some addresses don't work", tone: "warning" };
  if (s.opened) return { label: "People are reading it", tone: "success" };
  if (s.sent && s.delivered / s.sent >= 0.95) return { label: "Delivered successfully", tone: "success" };
  return { label: "On its way", tone: "info" };
}

/** One plain-language sentence, so nobody has to read the percentages to know how it went */
function resultSummary(s: VariantStats): string {
  const reached = s.sent + s.simulated;
  if (!reached) return s.failed ? `${s.failed} email${s.failed === 1 ? "" : "s"} couldn't be sent.` : "Nothing has been sent yet.";
  const people = `${reached} ${reached === 1 ? "person" : "people"}`;
  if (s.opened) return `Sent to ${people}. ${s.opened} opened it${s.clicked ? ` and ${s.clicked} clicked a link` : ""}.`;
  if (s.delivered) return `Sent to ${people}. ${s.delivered} arrived in the inbox. No opens yet.`;
  return `Sent to ${people}. Waiting for delivery updates.`;
}

function Results({ c }: { c: Campaign }) {
  const versions: Variant[] = c.ab_enabled ? ["A", "B"] : ["A"];
  const stats = (v: Variant) => c.variant_stats[v] ?? EMPTY;
  const hasEngagement = versions.some((v) => stats(v).opened > 0 || stats(v).clicked > 0);
  const score = (s: VariantStats) => pct(s.opened, s.sent) * 1000 + pct(s.clicked, s.sent);
  const winner =
    c.ab_enabled && hasEngagement && score(stats("A")) !== score(stats("B")) ? (score(stats("A")) > score(stats("B")) ? "A" : "B") : null;

  return (
    <>
      <div className="results">
        {versions.map((v) => {
          const s = stats(v);
          const vd = verdict(s);
          return (
            <div key={v} className={`result-card ${winner === v ? "winner" : ""}`}>
              <div className="result-head">
                {c.ab_enabled ? (
                  <strong style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                    <span className={`version-tag version-${v.toLowerCase()}`}>{v}</span> Version {v}
                  </strong>
                ) : (
                  <strong>How this campaign did</strong>
                )}
                {winner === v && (
                  <span className="pill tone-success no-dot">
                    <Trophy size={12} /> Winner
                  </span>
                )}
              </div>
              <div className="result-hero">
                <Donut value={pct(s.delivered, s.sent)} label="delivered" />
                <div className="result-hero-text">
                  <span className={`verdict verdict--${vd.tone}`}>{vd.label}</span>
                  <p className="result-sentence">{resultSummary(s)}</p>
                  <div className="result-subject">
                    <span>Subject</span> “{humanizeTags((v === "A" ? c.subject_a : c.subject_b) ?? "")}”
                  </div>
                </div>
              </div>
              <div className="rtiles">
                <ResultTile icon={<CircleCheck size={16} />} label="Delivered" count={s.delivered} total={s.sent} tone="success" hint="reached the inbox" />
                <ResultTile icon={<MailOpen size={16} />} label="Opened" count={s.opened} total={s.sent} tone="primary" hint="opened the email" />
                <ResultTile icon={<MousePointerClick size={16} />} label="Clicked" count={s.clicked} total={s.sent} tone="violet" hint="clicked a link" />
                <ResultTile icon={<TriangleAlert size={16} />} label="Bounced" count={s.bounced} total={s.sent} tone="danger" hint="couldn't be delivered" />
              </div>
              {s.failed > 0 && (
                <div className="result-failed">
                  <TriangleAlert size={14} /> {s.failed} email{s.failed === 1 ? "" : "s"} couldn&apos;t be sent. See the list below for the reason.
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!hasEngagement && totals(c).sent > 0 && (
        <p className="result-note">
          Opens and clicks show up once your company email domain is connected. Use <strong>Refresh results</strong> to check for updates.
        </p>
      )}
    </>
  );
}

function CampaignCard({ c, onChanged, confirm }: { c: Campaign; onChanged: Notify; confirm: (r: ConfirmRequest) => void }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<CampaignLog[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const t = totals(c);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  const reached = t.sent + t.simulated;

  const loadLogs = async () => {
    const res = await apiFetch(`/campaigns/${c.id}`).catch(() => null);
    if (res?.ok) setLogs((await res.json()).recent_logs);
  };

  const toggle = () => {
    if (!open) {
      loadLogs();
      // Quietly pull the latest delivered/opened status so the numbers are fresh without an extra click
      apiFetch(`/campaigns/${c.id}/refresh-events`, { method: "POST" })
        .then(async (res) => {
          if (res.ok && (await res.json()).updated) {
            await loadLogs();
            onChanged();
          }
        })
        .catch(() => {});
    }
    setOpen(!open);
  };

  const run = async (action: "send-now" | "pause" | "resume" | "refresh-events" | "follow-ups/stop" | "delete") => {
    setBusy(action);
    try {
      const res = await apiFetch(action === "delete" ? `/campaigns/${c.id}` : `/campaigns/${c.id}/${action}`, {
        method: action === "delete" ? "DELETE" : "POST",
      });
      const data = await res.json();
      if (!res.ok) return onChanged(errorMessage(data, "That didn't work. Please try again."), true);
      if (action === "refresh-events") {
        if (open) await loadLogs();
        return onChanged(data.updated ? `Updated results for ${data.updated} email${data.updated === 1 ? "" : "s"}.` : "Results are up to date.");
      }
      onChanged(
        {
          "send-now": `"${c.name}" is on its way.`,
          pause: `"${c.name}" is paused. Nothing more will be sent until you resume it.`,
          resume: `"${c.name}" is scheduled again.`,
          "follow-ups/stop": `Stopped ${data.cancelled} follow-up${data.cancelled === 1 ? "" : "s"} for "${c.name}".`,
          delete: `"${c.name}" was deleted.`,
        }[action]
      );
    } catch {
      onChanged(NETWORK_ERROR, true);
    } finally {
      setBusy(null);
    }
  };

  const sendNow = () =>
    confirm({
      title: "Send this campaign now?",
      message: (
        <>
          <strong>{c.name}</strong> will be sent to {c.recipient_count} {c.recipient_count === 1 ? "person" : "people"} right away.
          {c.schedule_type === "recurring" && " Its regular schedule stays the same."}
        </>
      ),
      confirmLabel: "Send now",
      onConfirm: () => run("send-now"),
    });

  const remove = () =>
    confirm({
      title: "Delete this campaign?",
      message: (
        <>
          <strong>{c.name}</strong> will be removed{c.status === "scheduled" ? " and won't be sent" : ""}. Emails already sent stay in your Sent emails list.
        </>
      ),
      confirmLabel: "Delete campaign",
      danger: true,
      onConfirm: () => run("delete"),
    });

  const canResume = c.schedule_type !== "now" && (c.status === "paused" || c.status === "draft");
  const fu = c.follow_ups;

  const stopFollowUps = () =>
    confirm({
      title: "Stop the follow-ups?",
      message: (
        <>
          The {fu?.pending} follow-up email{fu?.pending === 1 ? "" : "s"} still waiting for <strong>{c.name}</strong> won&apos;t be sent. Emails already sent aren&apos;t affected.
        </>
      ),
      confirmLabel: "Stop follow-ups",
      danger: true,
      onConfirm: () => run("follow-ups/stop"),
    });

  return (
    <article className={`campaign status-${c.status}`}>
      <div className="campaign-main">
        <div className="campaign-lead">
          <span className="campaign-icon" aria-hidden="true">
            {c.schedule_type === "recurring" ? <Repeat size={18} /> : c.schedule_type === "once" ? <CalendarClock size={18} /> : <Send size={18} />}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="campaign-title">
              <h3>{c.name}</h3>
              <span className={`pill ${STATUS_TONE[c.status]}`}>{STATUS_LABELS[c.status]}</span>
              {c.ab_enabled && <span className="pill tone-violet no-dot">Two versions</span>}
            </div>
            <div className="campaign-meta">
              <span>{whenLabel(c)}</span>
              <span className="sep">•</span>
              <span className="truncate" style={{ maxWidth: 360 }} title={humanizeTags(c.subject_a)}>“{humanizeTags(c.subject_a)}”</span>
            </div>
          </div>
        </div>
        <div className="campaign-numbers">
          <div className="num">
            <strong>{c.recipient_count}</strong>
            <span>Recipients</span>
          </div>
          <div className="num">
            <strong>{reached}</strong>
            <span>Sent</span>
          </div>
          <div className="num">
            <strong>{t.opened ? `${pct(t.opened, t.sent)}%` : "—"}</strong>
            <span>Opened</span>
          </div>
        </div>
      </div>

      {c.last_error && c.status === "failed" && (
        <div className="alert alert-danger campaign-error">
          <div>{friendlyError(c.last_error)}</div>
        </div>
      )}

      {fu && fu.steps > 0 && (
        <div className="campaign-followups">
          <MailPlus size={15} aria-hidden="true" />
          <span>
            <strong>{fu.steps} follow-up{fu.steps === 1 ? "" : "s"}</strong>
            {fu.pending + fu.sent + fu.skipped + fu.cancelled + fu.failed === 0
              ? " · start after the first email goes out"
              : [
                  fu.pending && `${fu.pending} waiting`,
                  fu.sent && `${fu.sent} sent`,
                  fu.skipped && `${fu.skipped} stopped (replied or qualified)`,
                  fu.cancelled && `${fu.cancelled} cancelled`,
                  fu.failed && `${fu.failed} failed`,
                ].filter(Boolean).map((s) => ` · ${s}`).join("")}
          </span>
        </div>
      )}

      <div className="campaign-actions">
        {(reached > 0 || t.failed > 0) && (
          <button className={`act ${open ? "" : "act-accent"}`} onClick={toggle} aria-expanded={open}>
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} {open ? "Hide results" : "View results"}
          </button>
        )}
        {c.status !== "sending" && (
          <button className="act" onClick={sendNow} disabled={!!busy}>
            <Send size={14} /> Send now
          </button>
        )}
        {c.status === "scheduled" && (
          <button className="act" onClick={() => run("pause")} disabled={!!busy}>
            <Pause size={14} /> Pause
          </button>
        )}
        {canResume && (
          <button className="act" onClick={() => run("resume")} disabled={!!busy}>
            <Play size={14} /> {c.status === "draft" ? "Schedule it" : "Resume"}
          </button>
        )}
        {reached > 0 && (
          <button className="act" onClick={() => run("refresh-events")} disabled={!!busy}>
            <RefreshCw size={14} className={busy === "refresh-events" ? "spin" : ""} /> Refresh results
          </button>
        )}
        {!!fu?.pending && (
          <button className="act" onClick={stopFollowUps} disabled={!!busy}>
            <CircleStop size={14} /> Stop follow-ups
          </button>
        )}
        <span className="spacer" />
        {c.status !== "sending" && (
          <div className="more-menu" ref={menuRef}>
            <button
              className="more-trigger"
              onClick={() => setMenuOpen(!menuOpen)}
              disabled={!!busy}
              aria-expanded={menuOpen}
              aria-label="More options"
              title="More options"
            >
              <Ellipsis size={18} />
            </button>
            {menuOpen && (
              <div className="more-dropdown">
                <button
                  className="user-dropdown-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    remove();
                  }}
                >
                  <Trash2 size={15} /> Delete campaign
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="campaign-detail">
          <Results c={c} />
          <div className="section-label">Recipients</div>
          {!logs ? (
            <div className="loader" />
          ) : logs.length === 0 ? (
            <p className="text-2" style={{ fontSize: "0.88rem" }}>
              Nothing has been sent yet{c.next_run_at ? `. First send: ${formatDateTime(c.next_run_at)}.` : "."}
            </p>
          ) : (
            <div className="card card-flush">
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Email</th>
                      {c.ab_enabled && <th>Version</th>}
                      <th>Status</th>
                      <th>Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => {
                      const s = emailStatus(l.status, l.last_event);
                      return (
                        <tr key={l.id}>
                          <td className="truncate">{l.recipient}</td>
                          {c.ab_enabled && (
                            <td>
                              <span className={`version-tag version-${(l.variant ?? "A").toLowerCase()}`}>{l.variant ?? "A"}</span>
                            </td>
                          )}
                          <td>
                            <span className={`pill tone-${s.tone}`}>{s.label}</span>
                            {l.error && <div className="cell-error">{friendlyError(l.error)}</div>}
                          </td>
                          <td className="nowrap text-2">{formatDateTime(l.sent_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function CampaignsList({
  campaigns,
  onChanged,
  onNew,
  confirm,
}: {
  campaigns: Campaign[];
  onChanged: Notify;
  onNew: () => void;
  confirm: (r: ConfirmRequest) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => {
      const matchesFilter =
        filter === "all" || (filter === "upcoming" ? c.status === "scheduled" || c.status === "sending" : c.status === filter);
      const matchesQuery = !q || c.name.toLowerCase().includes(q) || c.subject_a.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [campaigns, filter, query]);
  const pager = usePagination(visible, `${filter}|${query}`, 10);

  if (!campaigns.length) {
    return (
      <div className="card empty animate-fade-in">
        <div className="empty-icon"><Megaphone size={26} /></div>
        <h3>Create your first campaign</h3>
        <p>Write an email, choose who gets it, and send it now or schedule it for later. It only takes a couple of minutes.</p>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={16} /> New campaign
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" id="campaign-list">
      <div className="toolbar">
        <div className="filters" role="group" aria-label="Filter campaigns">
          {FILTERS.map((f) => {
            const count =
              f.id === "all"
                ? campaigns.length
                : campaigns.filter((c) => (f.id === "upcoming" ? c.status === "scheduled" || c.status === "sending" : c.status === f.id)).length;
            // Hide empty filters, but never the one that's selected, or the user can't see why the list is empty
            if (f.id !== "all" && count === 0 && filter !== f.id) return null;
            return (
              <button key={f.id} className={`filter ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label} · {count}
              </button>
            );
          })}
        </div>
        <label className="search">
          <Search size={16} />
          <input className="input" placeholder="Search campaigns" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search campaigns" />
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon"><Users size={24} /></div>
          <h3>No matching campaigns</h3>
          <p>Try a different search or filter.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilter("all"); setQuery(""); }}>
            Clear search and filters
          </button>
        </div>
      ) : (
        <>
          {pager.pageItems.map((c) => <CampaignCard key={c.id} c={c} onChanged={onChanged} confirm={confirm} />)}
          {pager.total > 10 && (
            <div className="card card-flush" style={{ marginTop: "0.75rem" }}>
              <Pagination {...pager} noun="campaigns" sizes={[10, 20, 50]} scrollTo="campaign-list" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
