"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AuthShell, AuthAlert, Field } from "@/components/AuthShell";
import { API_URL, NETWORK_ERROR, errorMessage } from "@/lib/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) setSuccess(data.message);
      else setError(errorMessage(data, "We couldn't send the reset email. Please try again."));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={<Link href="/login">Back to log in</Link>}
    >
      {error && <AuthAlert type="error">{error}</AuthAlert>}
      {success ? (
        <AuthAlert type="success">{success} The link works for one hour.</AuthAlert>
      ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          <Field label="Email" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
