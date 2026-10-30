"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell, AuthAlert, Field } from "@/components/AuthShell";
import { API_URL, NETWORK_ERROR, errorCode, errorMessage, getToken, setToken } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace("/");
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setNeedsVerification(false);
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.access_token);
        router.replace("/");
        return;
      }
      setNeedsVerification(errorCode(data) === "email_not_verified");
      setError(errorMessage(data, "We couldn't log you in. Please try again."));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setError(null);
    const res = await fetch(`${API_URL}/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    const data = res ? await res.json() : null;
    if (res?.ok) {
      setNeedsVerification(false);
      setNotice(data.message);
    } else {
      setError(res ? errorMessage(data, "We couldn't send the email. Please try again.") : NETWORK_ERROR);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your email campaigns."
      footer={
        <>
          New here? <Link href="/signup">Create an account</Link>
        </>
      }
    >
      {error && (
        <AuthAlert type="error">
          {error}
          {needsVerification && (
            <button type="button" className="link-btn" onClick={resendVerification}>
              Send me a new verification email
            </button>
          )}
        </AuthAlert>
      )}
      {notice && <AuthAlert type="success">{notice}</AuthAlert>}

      <form onSubmit={handleSubmit} className="auth-form">
        <Field label="Email" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" placeholder="Your password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="auth-row-end">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}
