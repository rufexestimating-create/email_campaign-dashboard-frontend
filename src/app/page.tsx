"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Inbox,
  LayoutTemplate,
  LogOut,
  Megaphone,
  MailCheck,
  Plus,
  Send,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { Brand } from "@/components/AuthShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { apiFetch, clearToken, errorMessage, getToken, type AuthUser } from "@/lib/auth";
import { Campaign, CampaignStatus, STARTER_TEMPLATES, STATUS_LABELS, Template, emailStatus, formatDateTime } from "@/lib/campaigns";
import { CampaignComposer, type CampaignDraft, type SendingMode } from "@/components/dashboard/CampaignComposer";
import { CampaignsList } from "@/components/dashboard/CampaignsList";
import { TemplatesPanel } from "@/components/dashboard/TemplatesPanel";
import { ActivityLog, type EmailLog } from "@/components/dashboard/ActivityLog";
import { ConfirmDialog, type ConfirmRequest } from "@/components/dashboard/ConfirmDialog";
import { KnowledgeBase } from "@/components/dashboard/KnowledgeBase";
import { LeadsPage } from "@/components/leads/LeadsPage";
import { GettingStarted } from "@/components/dashboard/GettingStarted";
import { InsightsPage, type InsightsSection } from "@/components/insights/InsightsPage";

interface StatsData {
  total_emails: number;
  sent_count: number;
  simulated_count: number;
  failed_count: number;
  success_rate: number;
  is_live_ready: boolean;
  default_from: string;
  /** Whether the spam detector's parts are shown (backend setting SPAM_DETECTOR_ENABLED) */
  spam_detector_enabled?: boolean;
}

type Tab = "campaigns" | "new" | "leads" | "insights" | "templates" | "activity" | "knowledge";

// Insights (send times, inbox check, warm-up, review history, tracking, prediction quality) is hidden for now: it moves
// to the new spam detector app. Its code stays here, and warm-up limits, the pre-send review and tracking keep running
// on the server. Set to true to bring the tab back.
const SHOW_INSIGHTS = false;

const PAGES: Record<Tab, { title: string; sub: string }> = {
  campaigns: { title: "Campaigns", sub: "See how your emails are doing and what's coming up next." },
  new: { title: "New campaign", sub: "Five quick steps: name it, add people, write it, test it, send it." },
  templates: { title: "Templates", sub: "Ready-to-use emails you can start from." },
  activity: { title: "Sent emails", sub: "Every email your campaigns have sent, and whether it arrived." },
  knowledge: { title: "Spam guide", sub: "Check any email, and learn the words and habits that send emails to spam." },
  leads: { title: "Leads", sub: "Everyone your campaigns have emailed. Set a stage as the conversation moves on: Ready to talk business, Customer or Lost stops their follow-up emails." },
  insights: { title: "Insights", sub: "When to send, how your emails are landing, and how your team uses the pre-send review." },
};


const STATUS_ORDER: CampaignStatus[] = ["sent", "scheduled", "sending", "draft", "paused", "failed"];

/** Emails sent on each of the last 7 days (oldest first), for the bar chart on the Emails sent card.
 * `now` comes from the browser after data loads: reading the clock during render breaks Next's prerender. */
function lastSevenDays(logs: EmailLog[], now: number) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const key = d.toDateString();
    return {
      label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
      count: logs.filter((l) => l.status !== "failed" && new Date(l.sent_at).toDateString() === key).length,
    };
  });
  return { days, max: Math.max(1, ...days.map((d) => d.count)), today: days[6].count };
}

/** "in 3 hours", "in 2 days" */
function timeUntil(iso: string, now: number) {
  const minutes = Math.max(0, (new Date(iso).getTime() - now) / 60000);
  if (minutes < 60) return `in ${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 60 * 24) return `in ${Math.round(minutes / 60)} hours`;
  const days = Math.round(minutes / (60 * 24));
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function MiniRing({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg className="mini-ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle className="mini-ring-track" cx="28" cy="28" r={r} />
      <circle className="mini-ring-fill" cx="28" cy="28" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(value, 100) / 100)} />
    </svg>
  );
}

const initials = (u: AuthUser) =>
  (u.full_name || u.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-trigger" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu">
        <span className="avatar" aria-hidden="true">{initials(user)}</span>
        <span className="user-trigger-name truncate">{user.full_name?.split(" ")[0] || "Account"}</span>
        <ChevronDown size={15} className="user-trigger-chevron" />
      </button>
      {open && (
        <div className="user-dropdown">
          <div className="user-dropdown-head">
            <span className="avatar" aria-hidden="true">{initials(user)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 600 }}>{user.full_name || "Your account"}</div>
              <div className="truncate field-hint">{user.email}</div>
            </div>
          </div>
          <button
            className="user-dropdown-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function CampaignDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("campaigns");
  const [composer, setComposer] = useState<{ key: number; template?: Template; draft?: CampaignDraft }>({ key: 0 });
  // Whether the composer holds unsent work (changes only when that flips, so it re-renders rarely)
  const [composerDirty, setComposerDirty] = useState(false);
  // Set when another page links to a specific Insights section; cleared when Insights is opened from the nav
  const [insightsSection, setInsightsSection] = useState<InsightsSection | undefined>();

  const [stats, setStats] = useState<StatsData | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const fetchData = useCallback(async () => {
    // Each request is handled on its own so one failure doesn't blank the whole dashboard
    const load = async <T,>(path: string, apply: (data: T) => void): Promise<string | null> => {
      try {
        const res = await apiFetch(path);
        const data = await res.json();
        if (res.ok) {
          apply(data);
          return null;
        }
        return errorMessage(data, "Some information couldn't be loaded. Please try again in a moment.");
      } catch {
        return "offline";
      }
    };
    const errors = await Promise.all([
      load<StatsData>("/emails/stats", setStats),
      load<EmailLog[]>("/emails/logs?limit=100", setLogs),
      load<Campaign[]>("/campaigns", setCampaigns),
      load<Template[]>("/templates", setSavedTemplates),
    ]);
    setProblem(errors.find((e) => e) ?? null);
    setNow(Date.now());
    setLoaded(true);
  }, []);

  const checkSession = useCallback(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiFetch("/auth/me")
      .then(async (res) => {
        if (res.ok) {
          setSessionError(false);
          setUser(await res.json());
        } else if (res.status !== 401) setSessionError(true);
      })
      .catch(() => setSessionError(true));
  }, [router]);

  // Auth guard: no valid JWT -> /login. Data loading only starts once the user is confirmed.
  useEffect(() => {
    const timer = setTimeout(checkSession, 0);
    return () => clearTimeout(timer);
  }, [checkSession]);

  useEffect(() => {
    if (!user) return;
    const firstLoad = setTimeout(fetchData, 0);
    const interval = setInterval(fetchData, 10000);
    return () => {
      clearTimeout(firstLoad);
      clearInterval(interval);
    };
  }, [user, fetchData]);

  // CADTRI-style header: full-width bar at the top of the page, compact floating pill once scrolled.
  // Two thresholds (hysteresis) stop it flickering when the scroll position sits right at the edge.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled((was) => (was ? window.scrollY > 8 : window.scrollY > 40)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Open the page named in the URL, and follow the browser's Back/Forward buttons
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      setActiveTab(hash in PAGES ? (hash as Tab) : "campaigns");
    };
    const first = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => {
      clearTimeout(first);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (message?: string, error?: boolean) => {
    if (message) setToast({ message, error });
    fetchData();
  };

  // Each page has its own URL (#templates, #activity…) so Back, refresh and bookmarks work (deep linking).
  // Focus moves to the main region so screen readers announce the new page.
  const goTo = (tab: Tab) => {
    setActiveTab(tab);
    if (window.location.hash !== `#${tab}`) window.history.pushState(null, "", `#${tab}`);
    window.scrollTo({ top: 0 });
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  const startCampaign = (template?: Template, draft?: CampaignDraft) => {
    const start = () => {
      setComposer((c) => ({ key: c.key + 1, template, draft }));
      goTo("new");
    };
    // A fresh composer replaces the old one, so ask before throwing away unsent work
    if (!composerDirty) return start();
    setConfirmRequest({
      title: "Replace your unsent campaign?",
      message: "You have a campaign you haven't sent yet. Starting a new one will clear it.",
      confirmLabel: "Start new campaign",
      cancelLabel: "Keep my draft",
      danger: true,
      onConfirm: start,
    });
  };

  const logOut = () => {
    clearToken();
    router.replace("/login");
  };

  const handleLogout = () =>
    setConfirmRequest({
      title: "Log out?",
      message: "Are you sure you want to log out? Your campaigns keep running, and you can log back in any time.",
      confirmLabel: "Yes, log out",
      cancelLabel: "No, stay",
      onConfirm: logOut,
    });

  const templates = useMemo(() => [...savedTemplates, ...STARTER_TEMPLATES], [savedTemplates]);
  const campaignNames = useMemo(() => Object.fromEntries(campaigns.map((c) => [c.id, c.name])), [campaigns]);
  const upcoming = useMemo(
    () =>
      campaigns
        .filter((c) => c.status === "scheduled" && c.next_run_at)
        .sort((x, y) => new Date(x.next_run_at!).getTime() - new Date(y.next_run_at!).getTime()),
    [campaigns]
  );
  const statusMix = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({ status, count: campaigns.filter((c) => c.status === status).length })).filter((m) => m.count > 0),
    [campaigns]
  );
  const week = useMemo(() => (now ? lastSevenDays(logs, now) : null), [logs, now]);
  const mode: SendingMode = !stats ? "live" : !stats.is_live_ready ? "off" : stats.default_from.includes("@resend.dev") ? "test" : "live";

  if (!user) {
    return (
      <div className="loading-screen">
        {sessionError ? (
          <>
            <div className="empty-icon"><WifiOff size={26} /></div>
            <h3>We couldn&apos;t load your account.</h3>
            <p>Please check your connection and try again.</p>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button className="btn btn-primary" onClick={checkSession}>Try again</button>
              <button className="btn btn-secondary" onClick={logOut}>Log out</button>
            </div>
          </>
        ) : (
          <>
            <div className="loader" />
            Loading your dashboard…
          </>
        )}
      </div>
    );
  }

  // The spam detector is moving to its own app; the backend says whether its parts still show here
  const spamOn = !!stats?.spam_detector_enabled;
  // "New campaign" is the call-to-action at the end of the nav pill
  const nav: { id: Tab; label: string; count?: number }[] = [
    { id: "campaigns", label: "Campaigns", count: campaigns.length },
    { id: "leads", label: "Leads" },
    ...(SHOW_INSIGHTS ? [{ id: "insights" as Tab, label: "Insights" }] : []),
    { id: "templates", label: "Templates" },
    { id: "activity", label: "Sent emails" },
    ...(spamOn ? [{ id: "knowledge" as Tab, label: "Spam guide" }] : []),
  ];
  const quickActions = [
    { title: "Send a new email", text: "Write it, pick who gets it, send or schedule.", icon: <Plus size={18} />, tone: "primary", onClick: () => startCampaign() },
    { title: "Start from a template", text: "Use a ready-made email and just edit it.", icon: <LayoutTemplate size={18} />, tone: "info", onClick: () => goTo("templates") },
    { title: "Check who received it", text: "See every email and whether it arrived.", icon: <Inbox size={18} />, tone: "success", onClick: () => goTo("activity") },
    ...(spamOn
      ? [{ title: "Avoid the spam folder", text: "Words to avoid and what to write instead.", icon: <ShieldCheck size={18} />, tone: "violet", onClick: () => goTo("knowledge") }]
      : []),
  ];
  const emailsSent = stats ? stats.sent_count + stats.simulated_count : 0;
  const firstName = user.full_name?.split(" ")[0];

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to main content</a>
      <header className={`topbar ${scrolled ? "is-scrolled" : ""}`}>
        <div className="topbar-surface" aria-hidden="true" />
        <div className="topbar-inner">
          <button className="topbar-brand" onClick={() => goTo("campaigns")} aria-label="Go to campaigns">
            <Brand />
          </button>

          <nav className="topnav" aria-label="Main">
            <div className="topnav-links">
              {nav.map((n) => (
                <button
                  key={n.id}
                  className={`topnav-item ${activeTab === n.id ? "active" : ""}`}
                  aria-current={activeTab === n.id ? "page" : undefined}
                  onClick={() => {
                    if (n.id === "insights") setInsightsSection(undefined);
                    goTo(n.id);
                  }}
                >
                  {n.label}
                  {n.count ? <span className="count">{n.count}</span> : null}
                </button>
              ))}
            </div>
            <span className="topnav-divider" aria-hidden="true" />
            <button
              className={`topnav-cta ${activeTab === "new" ? "is-active" : ""}`}
              aria-current={activeTab === "new" ? "page" : undefined}
              aria-label="New campaign"
              onClick={() => goTo("new")}
            >
              <Plus size={16} strokeWidth={2.75} aria-hidden="true" />
              <span>New campaign</span>
            </button>
          </nav>

          <div className="topbar-actions">
            <ThemeToggle />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </div>
      </header>

      <main className="main" id="main" tabIndex={-1}>
        <div className="page-head">
          <div>
            <div className="page-eyebrow">
              {now ? new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : " "}
            </div>
            <h1 className="page-title">
              {activeTab === "campaigns" && firstName ? `Welcome back, ${firstName}` : PAGES[activeTab].title}
            </h1>
            <p className="page-sub">{PAGES[activeTab].sub}</p>
          </div>
        </div>

        {problem && (
          <div className="alert alert-warning" role="status" style={{ marginBottom: "1.25rem" }}>
            <WifiOff size={18} />
            <div>
              {problem === "offline"
                ? "We're having trouble connecting. Your dashboard will update automatically once the connection is back."
                : problem}
            </div>
          </div>
        )}

        {activeTab === "campaigns" && (
          <>
            {loaded && (
              <GettingStarted
                campaignsCount={campaigns.length}
                refreshKey={campaigns.length * 100000 + logs.length}
                onNewCampaign={() => startCampaign()}
                onOpenWarmup={SHOW_INSIGHTS ? () => {
                  setInsightsSection("warmup");
                  goTo("insights");
                } : undefined}
                onOpenLeads={() => goTo("leads")}
              />
            )}
            <section className="stats stats--hero" aria-label="Summary">
              {/* Campaigns: dark feature card with a breakdown of every campaign's status */}
              <div className="stat stat--feature">
                <div className="stat-top">
                  Campaigns
                  <span className="stat-icon"><Megaphone size={17} /></span>
                </div>
                <div className="stat-value">{campaigns.length}</div>
                <div className="mix-bar" aria-hidden="true">
                  {statusMix.map((m) => (
                    <span key={m.status} className={`mix-${m.status}`} style={{ flex: m.count }} />
                  ))}
                </div>
                <div className="mix-legend">
                  {statusMix.length ? (
                    statusMix.map((m) => (
                      <span key={m.status}><i className={`mix-${m.status}`} />{m.count} {STATUS_LABELS[m.status].toLowerCase()}</span>
                    ))
                  ) : (
                    <span>No campaigns yet</span>
                  )}
                </div>
              </div>

              {/* Emails sent: total plus a 7-day bar chart */}
              <div className="stat stat--info">
                <div className="stat-top">
                  Emails sent
                  <span className="stat-icon"><Send size={17} /></span>
                </div>
                <div className="stat-value">{stats ? emailsSent.toLocaleString() : "—"}</div>
                <div
                  className="spark"
                  role="img"
                  aria-label={week ? `Emails sent each day, last 7 days: ${week.days.map((d) => d.count).join(", ")}` : "Emails sent each day"}
                >
                  {week?.days.map((d, i) => (
                    <div key={i} className={i === week.days.length - 1 ? "today" : ""} title={`${d.count} sent`}>
                      <i style={{ transform: `scaleY(${Math.max(d.count / week.max, 0.09)})` }} />
                      <span>{d.label}</span>
                    </div>
                  ))}
                </div>
                <div className="stat-foot">{week?.today ? `${week.today} sent today` : "Last 7 days"}</div>
              </div>

              {/* Success rate: ring chart */}
              <div className="stat stat--success">
                <div className="stat-top">
                  Success rate
                  <span className="stat-icon"><MailCheck size={17} /></span>
                </div>
                <div className="stat-row">
                  <div className="stat-value">{stats && stats.total_emails ? `${stats.success_rate}%` : "—"}</div>
                  <MiniRing value={stats?.total_emails ? stats.success_rate : 0} />
                </div>
                <div className="stat-foot">
                  {stats?.total_emails
                    ? stats.failed_count
                      ? `${stats.failed_count} of ${stats.total_emails.toLocaleString()} couldn't be sent`
                      : `All ${stats.total_emails.toLocaleString()} emails went out`
                    : "Nothing sent yet"}
                </div>
              </div>

              {/* Next send: calendar tile, or a shortcut to schedule one */}
              <div className="stat stat--violet">
                <div className="stat-top">
                  Next send
                  <span className="stat-icon"><CalendarClock size={17} /></span>
                </div>
                {upcoming[0]?.next_run_at ? (
                  <div className="next-send">
                    <div className="cal" aria-hidden="true">
                      <span>{new Date(upcoming[0].next_run_at).toLocaleDateString(undefined, { month: "short" })}</span>
                      <strong>{new Date(upcoming[0].next_run_at).getDate()}</strong>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="next-when">{formatDateTime(upcoming[0].next_run_at)}</div>
                      <div className="truncate next-name">{upcoming[0].name}</div>
                      {now && <div className="field-hint">{timeUntil(upcoming[0].next_run_at, now)}</div>}
                    </div>
                  </div>
                ) : (
                  <div className="next-empty">
                    <p>Nothing scheduled yet</p>
                    <button className="act" onClick={() => startCampaign()}>
                      <CalendarClock size={15} /> Schedule an email
                    </button>
                  </div>
                )}
              </div>
            </section>
            <div className="dash-grid">
              <div className="dash-main">
                <div className="dash-section-head">
                  <h2>Your campaigns</h2>
                  <span className="field-hint">Click &ldquo;View results&rdquo; on any campaign to see who opened it.</span>
                </div>
                {loaded ? (
                  <CampaignsList campaigns={campaigns} onChanged={notify} onNew={() => goTo("new")} confirm={setConfirmRequest} />
                ) : (
                  <div className="card empty"><div className="loader" /></div>
                )}
              </div>

              <aside className="dash-side">
                <div className="side-card">
                  <h3 className="side-title">Quick actions</h3>
                  <div className="quick-actions">
                    {quickActions.map((a) => (
                      <button key={a.title} className={`quick-action tone-${a.tone}-card`} onClick={a.onClick}>
                        <span className="quick-action-icon">{a.icon}</span>
                        <span className="quick-action-text">
                          <strong>{a.title}</strong>
                          <span>{a.text}</span>
                        </span>
                        <ArrowRight size={16} className="quick-action-arrow" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="side-card">
                  <h3 className="side-title">Latest emails</h3>
                  {logs.length === 0 ? (
                    <p className="field-hint">Emails you send will appear here.</p>
                  ) : (
                    <ul className="mini-log">
                      {logs.slice(0, 6).map((l) => {
                        const s = emailStatus(l.status, l.last_event);
                        return (
                          <li key={l.id}>
                            <span className={`mini-log-dot is-${s.tone}`} aria-hidden="true" />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="truncate mini-log-to">{l.recipient}</div>
                              <div className="truncate field-hint">{l.subject}</div>
                            </div>
                            <div className="mini-log-meta">
                              <span className={`pill tone-${s.tone} no-dot`}>{s.label}</span>
                              <span className="field-hint">{formatDateTime(l.sent_at)}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button className="side-link" onClick={() => goTo("activity")}>
                    See all sent emails <ArrowRight size={14} />
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}

        {/* Kept mounted (just hidden) so a half-written campaign survives a trip to the spam guide */}
        <div hidden={activeTab !== "new"}>
          <CampaignComposer
            key={composer.key}
            initialTemplate={composer.template}
            initialDraft={composer.draft}
            onDirtyChange={setComposerDirty}
            templates={templates}
            defaultFrom={stats?.default_from ?? ""}
            mode={mode}
            spamEnabled={spamOn}
            onOpenGuide={() => goTo("knowledge")}
            onTemplateSaved={(msg) => notify(msg)}
            onCreated={(msg) => {
              notify(msg);
              setComposer((c) => ({ key: c.key + 1 }));
              goTo("campaigns");
            }}
          />
        </div>
        {activeTab === "templates" && (
          <TemplatesPanel
            templates={templates}
            onChanged={notify}
            onUse={(t) => startCampaign(t)}
            onNew={() => startCampaign()}
            confirm={setConfirmRequest}
            spamEnabled={spamOn}
          />
        )}
        {activeTab === "activity" && <ActivityLog logs={logs} campaignNames={campaignNames} />}
        {activeTab === "knowledge" && spamOn && <KnowledgeBase onChanged={notify} confirm={setConfirmRequest} />}
        {activeTab === "leads" && (
          <LeadsPage
            notify={(msg, isError) => notify(msg, isError)}
            onOpenModels={SHOW_INSIGHTS ? () => {
              setInsightsSection("models");
              goTo("insights");
            } : undefined}
          />
        )}
        {activeTab === "insights" && SHOW_INSIGHTS && (
          <InsightsPage
            key={insightsSection ?? "default"}
            initialSection={insightsSection}
            defaultFrom={stats?.default_from ?? ""}
            notify={(msg, isError) => notify(msg, isError)}
            onNewCampaign={() => startCampaign()}
            onUseDraft={(draft) => startCampaign(undefined, draft)}
            spamEnabled={spamOn}
          />
        )}
      </main>

      {/* Always mounted, so screen readers announce each new message; errors interrupt, successes wait */}
      <div aria-live="polite">
        {toast && (
          <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
            {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
