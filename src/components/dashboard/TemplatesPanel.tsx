"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bookmark, Hand, Mail, Newspaper, PenLine, Plus, Reply, Rocket, Search, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { NETWORK_ERROR, apiFetch, errorMessage } from "@/lib/auth";
import { Template, humanizeTags } from "@/lib/campaigns";
import { SpamLevel } from "@/lib/spam";
import type { ConfirmRequest } from "./ConfirmDialog";
import { useDialogFocus } from "./useDialogFocus";

type Tone = "primary" | "info" | "violet" | "success" | "warning";
type Filter = "all" | "builtin" | "saved" | "text" | "html";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "builtin", label: "Ready-made" },
  { id: "saved", label: "Saved by you" },
  { id: "text", label: "Simple text" },
  { id: "html", label: "HTML design" },
];

/** Picks an icon and colour from the template name, so every card is recognisable at a glance */
function look(t: Template): { icon: React.ReactNode; tone: Tone } {
  const n = t.name.toLowerCase();
  if (n.includes("welcome")) return { icon: <Hand size={20} />, tone: "primary" };
  if (n.includes("newsletter") || n.includes("update")) return { icon: <Newspaper size={20} />, tone: "info" };
  if (n.includes("launch") || n.includes("new")) return { icon: <Rocket size={20} />, tone: "violet" };
  if (n.includes("follow") || n.includes("reply")) return { icon: <Reply size={20} />, tone: "success" };
  return { icon: t.builtin ? <Mail size={20} /> : <Bookmark size={20} />, tone: t.builtin ? "warning" : "primary" };
}

const plain = (t: Template) =>
  humanizeTags(t.content_type === "html" ? t.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : t.body);

export function TemplatesPanel({
  templates,
  onChanged,
  onUse,
  onNew,
  confirm,
  spamEnabled,
}: {
  templates: Template[];
  onChanged: (msg?: string, isError?: boolean) => void;
  onUse: (t: Template) => void;
  onNew: () => void;
  confirm: (r: ConfirmRequest) => void;
  /** false while the spam detector is moving to its own app: no spam-risk bar on the cards */
  spamEnabled: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const remove = (t: Template) =>
    confirm({
      title: "Delete this template?",
      message: (
        <>
          <strong>{t.name}</strong> will be removed from your templates. Campaigns that already used it aren&apos;t affected.
        </>
      ),
      confirmLabel: "Delete template",
      danger: true,
      onConfirm: async () => {
        const res = await apiFetch(`/templates/${t.id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok) onChanged(`"${t.name}" was deleted.`);
        else onChanged(res ? errorMessage(await res.json(), "We couldn't delete the template.") : NETWORK_ERROR, true);
      },
    });

  // Spam score for every template, so risky wording is visible before it's reused
  const [scores, setScores] = useState<Record<string, { score: number; level: SpamLevel; label: string }>>({});
  useEffect(() => {
    if (!templates.length || !spamEnabled) return;
    apiFetch("/spam/check-batch", {
      method: "POST",
      body: JSON.stringify({ items: templates.slice(0, 50).map((t) => ({ subject: t.subject, body: t.body, content_type: t.content_type })) }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const results: { score: number; level: SpamLevel; label: string }[] = await res.json();
        setScores(Object.fromEntries(results.map((r, i) => [templates[i].id ?? templates[i].name, r])));
      })
      .catch(() => {});
  }, [templates, spamEnabled]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (t: Template) => {
      const byFilter =
        filter === "all" ||
        (filter === "builtin" && t.builtin) ||
        (filter === "saved" && !t.builtin) ||
        (filter === "text" && t.content_type === "text") ||
        (filter === "html" && t.content_type === "html");
      const byQuery = !q || [t.name, t.subject, t.body].some((s) => s.toLowerCase().includes(q));
      return byFilter && byQuery;
    };
  }, [filter, query]);

  const allSaved = templates.filter((t) => !t.builtin);
  const saved = allSaved.filter(matches);
  const starters = templates.filter((t) => t.builtin).filter(matches);
  const showSavedEmpty = !allSaved.length && !query.trim() && (filter === "all" || filter === "saved");
  const nothingFound = !saved.length && !starters.length && !showSavedEmpty;

  const card = (t: Template, i: number) => {
    const { icon, tone } = look(t);
    const spam = scores[t.id ?? t.name];
    return (
      <article key={t.id ?? `starter-${i}`} className={`tpl-card tpl--${tone}`}>
        <div className="tpl-cover">
          <span className="tpl-cover-icon">{icon}</span>
          <div className="tpl-mail" aria-hidden="true">
            <div className="tpl-mail-bar"><i /><i /><i /></div>
            <div className="tpl-mail-subject truncate">{humanizeTags(t.subject)}</div>
            <div className="tpl-mail-body">{plain(t)}</div>
          </div>
        </div>

        <div className="tpl-body">
          <div className="tpl-head">
            <h3 className="truncate">{t.name}</h3>
            {!t.builtin && (
              <button className="more-trigger" onClick={() => remove(t)} title="Delete template" aria-label={`Delete ${t.name}`}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="tpl-tags">
            {t.builtin ? (
              <span className="pill tone-neutral no-dot"><Sparkles size={11} /> Ready-made</span>
            ) : (
              <span className="pill tone-primary no-dot"><Bookmark size={11} /> Saved by you</span>
            )}
            <span className="pill tone-neutral no-dot">{t.content_type === "html" ? "HTML design" : "Simple text"}</span>
          </div>
          <div className="tpl-subject">
            <span>Subject</span>
            {humanizeTags(t.subject)}
          </div>
          {spam && (
            <div className={`tpl-spam tpl-spam--${spam.level}`} title="Spam risk score: 0 is safe, 100 is very likely to land in spam">
              <div className="tpl-spam-label">
                <span>Spam risk</span>
                <strong>{spam.label}</strong>
              </div>
              <div className="tpl-spam-track"><span style={{ transform: `scaleX(${(Math.max(spam.score, 4)) / 100})` }} /></div>
            </div>
          )}
        </div>

        <div className="tpl-foot">
          <button className="act act-accent tpl-use" onClick={() => onUse(t)}>
            Use this template <ArrowRight size={15} />
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="animate-fade-in">
      <section className="tpl-hero">
        <div className="tpl-hero-main">
          <span className="kb-hero-badge"><WandSparkles size={13} /> Save time</span>
          <h2>Pick a template, change a few words, and send.</h2>
          <ol className="tpl-steps">
            <li><b>1</b> Choose a template below</li>
            <li><b>2</b> Edit the words to suit you</li>
            <li><b>3</b> Pick who gets it and send</li>
          </ol>
        </div>
        <div className="tpl-hero-side">
          <div className="tpl-hero-stats">
            <div><strong>{templates.filter((t) => t.builtin).length}</strong><span>Ready-made</span></div>
            <div><strong>{allSaved.length}</strong><span>Saved by you</span></div>
          </div>
          <button className="act act-primary tpl-hero-btn" onClick={() => setCreating(true)}>
            <Plus size={16} /> New template
          </button>
          <button className="act tpl-hero-btn" onClick={onNew}>
            <PenLine size={16} /> Write a campaign from scratch
          </button>
        </div>
      </section>

      <div className="toolbar tpl-toolbar">
        <div className="filters" role="group" aria-label="Filter templates">
          {FILTERS.map((f) => (
            <button key={f.id} className={`filter ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} />
          <input className="input" placeholder="Search templates" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" />
        </label>
      </div>

      {showSavedEmpty && (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>Saved by you</div>
          <div className="tpl-empty">
            <span className="tpl-empty-icon"><Bookmark size={22} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>No saved templates yet</strong>
              <p>Click <b>New template</b> to write one here, or click <b>Save as a template</b> while writing a campaign.</p>
            </div>
            <button className="act" onClick={() => setCreating(true)}>
              <Plus size={15} /> New template
            </button>
          </div>
        </>
      )}

      {saved.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 0 }}>Saved by you</div>
          <div className="tpl-grid">{saved.map(card)}</div>
        </>
      )}

      {starters.length > 0 && (
        <>
          <div className="section-label">Ready-made templates</div>
          <div className="tpl-grid">{starters.map(card)}</div>
        </>
      )}

      {nothingFound && (
        <div className="card empty">
          <div className="empty-icon"><Search size={24} /></div>
          <h3>No templates match</h3>
          <p>Try a different word or filter.</p>
        </div>
      )}

      {creating && (
        <NewTemplateDialog
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            onChanged(`"${name}" saved. It's under Saved by you.`);
          }}
        />
      )}
    </div>
  );
}

const TAGS = [
  { tag: "{{first_name}}", label: "First name" },
  { tag: "{{name}}", label: "Full name" },
  { tag: "{{email}}", label: "Email" },
];

/** Writes a template straight from the Templates page (no campaign needed) */
function NewTemplateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [form, setForm] = useState({ name: "", subject: "", body: "", content_type: "text" as "text" | "html" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogFocus(ref, true);

  // The dashboard re-renders every 10 s with a new onClose; a ref keeps the Escape listener (and the form) steady
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Puts a personalisation tag where the cursor is in the message */
  const insert = (tag: string) => {
    const el = bodyRef.current;
    const at = el ? el.selectionStart : form.body.length;
    const end = el ? el.selectionEnd : at;
    setForm((f) => ({ ...f, body: f.body.slice(0, at) + tag + f.body.slice(end) }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tag.length, at + tag.length);
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/templates", { method: "POST", body: JSON.stringify({ ...form, name: form.name.trim() }) });
      if (res.ok) return onSaved(form.name.trim());
      setError(errorMessage(await res.json(), "The template couldn't be saved."));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={() => !saving && onClose()}>
      <div ref={ref} className="dialog tpl-new" role="dialog" aria-modal="true" aria-labelledby="new-template-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="new-template-title">New template</h3>
        <p>Write it once, then pick it with <b>Use this template</b> whenever you start a campaign.</p>
        <form className="tpl-new-form" onSubmit={save}>
          <label className="field">
            <span className="field-label">Template name</span>
            <input className="input" required maxLength={120} autoFocus value={form.name} placeholder="Kitchen remodel intro"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <div className="field">
            <span className="field-label">Format</span>
            <div className="segmented" role="group" aria-label="Format">
              <button type="button" className={form.content_type === "text" ? "active" : ""} onClick={() => setForm({ ...form, content_type: "text" })}>Simple text</button>
              <button type="button" className={form.content_type === "html" ? "active" : ""} onClick={() => setForm({ ...form, content_type: "html" })}>HTML design</button>
            </div>
          </div>
          <label className="field">
            <span className="field-label">Subject</span>
            <input className="input" required maxLength={255} value={form.subject} placeholder="Ideas for your kitchen, {{first_name}}"
              onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Message</span>
            <textarea ref={bodyRef} className="input textarea" required rows={9} value={form.body}
              placeholder={form.content_type === "html" ? "<p>Hi {{first_name}},</p>" : "Hi {{first_name}},"}
              onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <div className="tpl-new-tags">
            <span className="field-hint">Add to the message:</span>
            {TAGS.map((t) => (
              <button key={t.tag} type="button" className="btn btn-secondary btn-sm" onClick={() => insert(t.tag)}>{t.label}</button>
            ))}
          </div>
          {error && <p className="field-hint mb-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" disabled={saving}><Plus size={15} /> {saving ? "Saving…" : "Save template"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
