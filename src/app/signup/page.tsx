"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthShell, AuthAlert, Field } from "@/components/AuthShell";
import { API_URL, NETWORK_ERROR, errorMessage } from "@/lib/auth";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError("Your password needs at least one letter and one number.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });
      const data = await res.json();
      if (res.ok) setSentTo(email);
      else setError(errorMessage(data, "We couldn't create your account. Please try again."));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your inbox" footer={<Link href="/login">Back to log in</Link>}>
        <div className="empty" style={{ padding: "1rem 0 0", alignItems: "flex-start", textAlign: "left" }}>
          <div className="empty-icon"><MailCheck size={26} /></div>
          <p style={{ maxWidth: "none" }}>
            We sent a verification link to <strong>{sentTo}</strong>. Click the link in that email to activate your account, then log in.
          </p>
          <p className="muted" style={{ fontSize: "0.86rem", maxWidth: "none" }}>
            Can&apos;t find it? Check your spam folder. You can request a new link from the log in page.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start sending email campaigns in a few minutes."
      footer={
        <>
          Already have an account? <Link href="/login">Log in</Link>
        </>
      }
    >
      {error && <AuthAlert type="error">{error}</AuthAlert>}
      <form onSubmit={handleSubmit} className="auth-form">
        <Field label="Full name" autoComplete="name" placeholder="Jane Doe" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Field label="Work email" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          hint="Use 8 or more characters with a letter and a number."
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
          {loading ? "Creating your account…" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
