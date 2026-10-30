"use client";

import React, { useId, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";
import { ThemeToggle } from "./ThemeToggle";

/** Monogram: a gable "A" with a blueprint-blue crossbar */
export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="6 6 20 20" width="22" height="22">
        <path d="M9 23.5 16 8.5l7 15" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11.8 18h8.4" fill="none" stroke="var(--mark-accent)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Brand() {
  return (
    <div className="auth-brand">
      <BrandMark />
      <div className="brand-text">
        <span className="brand-name">{BRAND_NAME}</span>
        <span className="brand-product">{PRODUCT_NAME}</span>
      </div>
    </div>
  );
}

/** Decorative line elevation of a building, drawn like an architect's sketch */
function BuildingDrawing() {
  const windows = [];
  for (let floor = 0; floor < 6; floor++)
    for (let col = 0; col < 4; col++) windows.push(<rect key={`a${floor}-${col}`} x={52 + col * 30} y={92 + floor * 42} width="18" height="26" />);
  for (let floor = 0; floor < 4; floor++)
    for (let col = 0; col < 3; col++) windows.push(<rect key={`b${floor}-${col}`} x={232 + col * 34} y={196 + floor * 40} width="22" height="24" />);
  return (
    <svg className="auth-drawing" viewBox="0 0 400 380" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      {/* tower */}
      <path d="M40 360V70h128v290" />
      <path d="M40 70l64-34 64 34" />
      <path d="M104 36v-20" />
      {/* lower block with a cantilevered roof */}
      <path d="M168 360V170h166v190" />
      <path d="M156 170h196" strokeWidth="2" />
      {/* entrance */}
      <path d="M86 360v-36h36v36" />
      <path d="M260 360v-18h40v18" />
      {/* ground line and a tree */}
      <path d="M0 360h400" strokeWidth="1.6" />
      <circle cx="372" cy="318" r="18" />
      <path d="M372 336v24" />
      {/* dimension lines */}
      <path d="M24 70v290M20 70h8M20 360h8" strokeDasharray="3 4" />
      <path d="M168 154h166M168 150v8M334 150v8" strokeDasharray="3 4" />
      <g strokeWidth="1">{windows}</g>
    </svg>
  );
}

const FEATURES = [
  ["Reach", "Paste a list or upload a spreadsheet of clients and partners."],
  ["Refine", "Test two subject lines, check spam risk and keep what works."],
  ["Schedule", "Send at the best time for each audience, or repeat every week."],
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <BuildingDrawing />
        <Brand />
        <div className="auth-hero">
          <span className="auth-eyebrow">Client communications</span>
          {/* A styled paragraph, not a heading: the page's own <h1> ("Welcome back") must come first for screen readers */}
          <p className="auth-hero-title">Email campaigns, designed with the same care as <em>your buildings.</em></p>
          <p>Write once, personalise for every client, and let each campaign go out at the right moment.</p>
        </div>

        <ol className="auth-features">
          {FEATURES.map(([title, text], i) => (
            <li key={title} className="auth-feature">
              <span className="auth-feature-num">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ol>

        <div className="auth-mock" aria-hidden="true">
          <div className="auth-mock-head">
            <span>Riverside office launch</span>
            <span className="auth-mock-status">Sent</span>
          </div>
          <div className="auth-mock-stats">
            <div><strong>48</strong><span>Recipients</span></div>
            <div><strong>98%</strong><span>Delivered</span></div>
            <div><strong>62%</strong><span>Opened</span></div>
          </div>
          <div className="auth-mock-bar"><span style={{ width: "62%" }} /></div>
        </div>
      </aside>

      <section className="auth-main">
        <ThemeToggle className="auth-theme" />
        <div className="auth-card animate-fade-in">
          <Brand />
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

export function AuthAlert({ type, children }: { type: "error" | "success"; children: React.ReactNode }) {
  return (
    <div className={`alert ${type === "error" ? "alert-danger" : "alert-success"}`} role={type === "error" ? "alert" : "status"}>
      {type === "error" ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
      <div>{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  type,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const input = (
    <input
      id={id}
      className="input"
      type={isPassword && visible ? "text" : type}
      aria-describedby={hint ? `${id}-hint` : undefined}
      {...props}
    />
  );
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {isPassword ? (
        <div className="password-wrap">
          {input}
          <button
            type="button"
            className="password-toggle"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      ) : (
        input
      )}
      {hint && <span id={`${id}-hint`} className="field-hint" style={{ fontWeight: 400 }}>{hint}</span>}
    </div>
  );
}
