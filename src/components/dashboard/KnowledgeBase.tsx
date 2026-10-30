"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Info,
  Lightbulb,
  MailSearch,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { humanizeTags } from "@/lib/campaigns";
import { Knowledge, SEVERITY_LABEL, SEVERITY_TONE, Severity } from "@/lib/spam";
import type { ConfirmRequest } from "./ConfirmDialog";
import { Pagination, usePagination } from "./Pagination";
import { EmailChecker } from "./EmailChecker";

type Tab = "check" | "words" | "audience" | "tips";

export function KnowledgeBase({ onChanged, confirm }: { onChanged: (msg?: string, isError?: boolean) => void; confirm: (r: ConfirmRequest) => void }) {
  const [data, setData] = useState<Knowledge | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("words");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [form, setForm] = useState<{ phrase: string; severity: Severity; alternative: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/spam/knowledge");
      const body: Knowledge = await res.json();
      // Industry-specific wording first: it's the most relevant section for an architecture firm
      if (res.ok) {
        const industry = new Set(body.categories.filter((c) => c.industry).map((c) => c.id));
        const first = (id: string) => (industry.has(id) ? 0 : 1);
        setData({
          ...body,
          categories: [...body.categories].sort((x, y) => first(x.id) - first(y.id)),
          keywords: [...body.keywords].sort((x, y) => first(x.category) - first(y.category)),
        });
      }
      else setLoadError(errorMessage(body, "We couldn't load the guide."));
    } catch {
      setLoadError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const keywords = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.keywords.filter(
      (k) =>
        (category === "all" || k.category === category) &&
        (severity === "all" || k.severity === severity) &&
        (!q || k.phrase.includes(q) || k.alternative.toLowerCase().includes(q))
    );
  }, [data, query, category, severity]);
  const pager = usePagination(keywords, `${query}|${category}|${severity}`, 25);

  const overview = useMemo(() => {
    if (!data) return null;
    const by = (s: Severity) => data.keywords.filter((k) => k.severity === s).length;
    const industry = new Set(data.categories.filter((c) => c.industry).map((c) => c.id));
    const perCategory: Record<string, number> = {};
    for (const k of data.keywords) perCategory[k.category] = (perCategory[k.category] ?? 0) + 1;
    return {
      total: data.keywords.length,
      high: by("high"),
      medium: by("medium"),
      low: by("low"),
      industry: data.keywords.filter((k) => industry.has(k.category)).length,
      custom: data.keywords.filter((k) => k.source === "custom").length,
      perCategory,
    };
  }, [data]);

  const addKeyword = async () => {
    if (!form?.phrase.trim()) return;
    setSaving(true);
    const res = await apiFetch("/spam/keywords", {
      method: "POST",
      body: JSON.stringify({ phrase: form.phrase, severity: form.severity, alternative: form.alternative || null, note: form.note || null }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      onChanged(`"${form.phrase.trim()}" added. Campaigns using it will now be flagged.`);
      setForm(null);
      load();
    } else {
      const body = res ? await res.json().catch(() => null) : null;
      onChanged(res ? errorMessage(body, "We couldn't add the keyword.") : NETWORK_ERROR, true);
    }
  };

  const removeKeyword = (id: string, phrase: string) =>
    confirm({
      title: "Remove this keyword?",
      message: <>“{phrase}” will no longer be flagged in your emails.</>,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: async () => {
        const res = await apiFetch(`/spam/keywords/${id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok) {
          onChanged(`"${phrase}" removed.`);
          load();
        } else onChanged("We couldn't remove the keyword.", true);
      },
    });

  if (loadError) {
    return (
      <div className="alert alert-warning">
        <Info size={18} />
        <div>{loadError}</div>
      </div>
    );
  }
  if (!data || !overview) return <div className="card empty"><div className="loader" /></div>;

  const activeCategory = data.categories.find((c) => c.id === category);
  const industryIds = new Set(data.categories.filter((c) => c.industry).map((c) => c.id));
  const customCount = data.keywords.filter((k) => k.source === "custom").length;

  return (
    <div className="animate-fade-in stack">
      <section className="kb-hero">
        <div className="kb-hero-main">
          <span className="kb-hero-badge"><Building2 size={14} /> Written for architecture firms</span>
          <h2>Keep your emails out of the spam folder</h2>
          <p>
            These words and patterns make spam filters, and busy general managers, treat an email as advertising. The spam check in
            <strong> New campaign</strong> uses this list as you type.
          </p>
          <div className="kb-hero-stats">
            <div><strong>{overview.total.toLocaleString()}</strong><span>Words and phrases</span></div>
            <div><strong>{overview.high}</strong><span>High risk</span></div>
            <div><strong>{overview.industry}</strong><span>Architecture & property</span></div>
            <div><strong>{overview.custom}</strong><span>Added by your team</span></div>
          </div>
        </div>
        <div className="kb-hero-side">
          <div className="kb-hero-side-title">Risk mix</div>
          <div className="kb-risk-bar" aria-hidden="true">
            <span className="high" style={{ flex: overview.high }} />
            <span className="medium" style={{ flex: overview.medium }} />
            <span className="low" style={{ flex: overview.low }} />
          </div>
          <ul className="kb-risk-legend">
            <li><i className="high" /> High risk <strong>{overview.high}</strong></li>
            <li><i className="medium" /> Medium risk <strong>{overview.medium}</strong></li>
            <li><i className="low" /> Low risk <strong>{overview.low}</strong></li>
          </ul>
          <div className="kb-hero-side-title" style={{ marginTop: "1.1rem" }}>Spam score</div>
          <div className="kb-legend">
            <div><span className="pill tone-success">0–19</span> Looks good</div>
            <div><span className="pill tone-warning">20–44</span> Needs a few changes</div>
            <div><span className="pill tone-danger">45+</span> Likely spam</div>
          </div>
        </div>
      </section>

      <div className="kb-tabcards" role="group" aria-label="Spam guide sections">
        {(
          [
            ["check", <MailSearch key="i" size={20} />, "Check an email", "Paste any email and see its inbox score"],
            ["words", <ShieldAlert key="i" size={20} />, `Spam words`, `${data.keywords.length} words to avoid, and what to write instead`],
            ["audience", <Users key="i" size={20} />, "Audience guide", `How to write to ${data.audience_guide.length} kinds of contacts`],
            ["tips", <Lightbulb key="i" size={20} />, "Writing tips", "Simple habits that keep you in the inbox"],
          ] as const
        ).map(([id, icon, label, sub]) => (
          <button key={id} aria-pressed={tab === id} className={`kb-tabcard ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            <span className="kb-tabcard-icon">{icon}</span>
            <span className="kb-tabcard-text">
              <strong>{label}</strong>
              <span>{sub}</span>
            </span>
          </button>
        ))}
      </div>

      {tab === "check" && <EmailChecker onOpenGuide={() => setTab("words")} />}

      {tab === "words" && (
        <>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="filters">
              <button className={`filter ${category === "all" ? "active" : ""}`} onClick={() => setCategory("all")}>All · {overview.total}</button>
              {data.categories.map((c) => (
                <button key={c.id} className={`filter ${c.industry ? "filter-industry" : ""} ${category === c.id ? "active" : ""}`} onClick={() => setCategory(c.id)}>
                  {c.industry && <Building2 size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                  {c.name} <span className="filter-count">{overview.perCategory[c.id] ?? 0}</span>
                </button>
              ))}
              {customCount > 0 && (
                <button className={`filter ${category === "custom" ? "active" : ""}`} onClick={() => setCategory("custom")}>Your keywords · {customCount}</button>
              )}
            </div>
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="search">
              <Search size={16} />
              <input className="input" placeholder="Search a word or phrase" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search spam words" />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <select className="input" style={{ width: "auto" }} value={severity} onChange={(e) => setSeverity(e.target.value as "all" | Severity)} aria-label="Filter by risk">
                <option value="all">All risk levels</option>
                <option value="high">High risk</option>
                <option value="medium">Medium risk</option>
                <option value="low">Low risk</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => setForm({ phrase: "", severity: "medium", alternative: "", note: "" })}>
                <Plus size={15} /> Add keyword
              </button>
            </div>
          </div>

          {form && (
            <div className="card kb-form">
              <h3 className="card-title" style={{ marginBottom: "0.9rem" }}>Add your own keyword</h3>
              <div className="grid-2">
                <label className="field">
                  <span className="field-label">Word or phrase</span>
                  <input className="input" autoFocus placeholder="e.g. cheap renovation" value={form.phrase} onChange={(e) => setForm({ ...form, phrase: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field-label">Risk level</span>
                  <select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
                    <option value="high">High: almost always flagged</option>
                    <option value="medium">Medium: risky, especially in subjects</option>
                    <option value="low">Low: fine occasionally</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Write instead (optional)</span>
                  <input className="input" placeholder="e.g. cost-efficient refurbishment" value={form.alternative} onChange={(e) => setForm({ ...form, alternative: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field-label">Why (optional)</span>
                  <input className="input" placeholder="e.g. clients see it as low quality" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </label>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={addKeyword} disabled={!form.phrase.trim() || saving}>
                  {saving ? "Adding…" : "Add keyword"}
                </button>
              </div>
            </div>
          )}

          {activeCategory && (
            <div className="alert alert-info">
              <Info size={18} />
              <div><strong>{activeCategory.name}:</strong> {activeCategory.why}</div>
            </div>
          )}

          <div className="card card-flush" id="kb-list">
            <div className="table-wrap">
              <table className="table kb-table">
                <thead>
                  <tr>
                    <th>Don&apos;t write</th>
                    <th aria-label="becomes" />
                    <th>Write this instead</th>
                    <th>Risk</th>
                    <th>Category</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((k) => (
                    <tr key={`${k.category}-${k.phrase}`} className={`kb-row risk-${k.severity}`}>
                      <td><span className="kb-avoid"><XCircle size={14} /> {k.phrase}</span></td>
                      <td className="kb-arrow"><ArrowRight size={15} /></td>
                      <td><span className="kb-instead"><CheckCircle2 size={14} /> {k.alternative}</span></td>
                      <td><span className={`pill no-dot ${SEVERITY_TONE[k.severity]}`}>{SEVERITY_LABEL[k.severity]}</span></td>
                      <td className="text-2 kb-cat" title={k.why}>
                        {industryIds.has(k.category) && <Building2 size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                        {k.category_name}
                      </td>
                      <td style={{ width: 48 }}>
                        {k.source === "custom" && k.id && (
                          <button className="icon-btn danger" onClick={() => removeKeyword(k.id!, k.phrase)} aria-label={`Remove ${k.phrase}`}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {keywords.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-2" style={{ textAlign: "center", padding: "2rem" }}>
                        No matching words. Not flagged here doesn&apos;t mean safe in every context, so keep the tone professional.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination {...pager} noun="words" scrollTo="kb-list" />
          </div>
        </>
      )}

      {tab === "audience" && (
        <div className="audience-grid">
          {data.audience_guide.map((r) => (
            <article key={r.role} className="card audience-card">
              <div className="audience-head">
                <span className="audience-avatar"><UserRound size={20} /></span>
                <div style={{ minWidth: 0 }}>
                  <h3 className="card-title">{r.role}</h3>
                  <span className="field-hint"><Clock size={12} style={{ verticalAlign: "-1px" }} /> Best time: {r.best_time}</span>
                </div>
              </div>
              <div>
                <div className="field-hint">Cares about</div>
                <p>{r.cares_about}</p>
              </div>
              <div>
                <div className="field-hint">How to write</div>
                <p>{r.how_to_write}</p>
              </div>
              <div className="subject-example good">
                <CheckCircle2 size={15} /> <span>{humanizeTags(r.good_subject)}</span>
              </div>
              <div className="subject-example bad">
                <XCircle size={15} /> <span>{r.avoid_subject}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "tips" && (
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "1rem" }}><Lightbulb size={17} /> Best practices</h3>
            <ol className="tips-list">
              {data.best_practices.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.4rem" }}><Building2 size={17} /> Professional wording that reads well</h3>
            <p className="card-sub" style={{ marginBottom: "1rem" }}>Industry terms managers and developers trust. Use them instead of sales language.</p>
            <div className="vocab">
              {data.vocabulary.map((v) => (
                <span key={v} className="pill tone-primary no-dot">{v}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
