"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell, AuthAlert, Field } from "@/components/AuthShell";
import { API_URL, NETWORK_ERROR, errorMessage } from "@/lib/auth";

function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!token) {
    return (
      <AuthAlert type="error">
        This link isn&apos;t complete. <Link href="/forgot-password">Request a new reset link</Link>.
      </AuthAlert>
    );
  }

  if (success) {
    return (
      <>
        <AuthAlert type="success">{success}</AuthAlert>
        <Link href="/login" className="btn btn-primary auth-submit">
          Go to log in
        </Link>
      </>
    );
  }

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
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();
      if (res.ok) setSuccess(data.message);
      else setError(errorMessage(data, "We couldn't reset your password. Please try again."));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {error && (
        <AuthAlert type="error">
          {error}
          {/expired|invalid|already been used/i.test(error) && (
            <Link href="/forgot-password" style={{ display: "block", marginTop: "0.35rem", fontWeight: 600 }}>
              Request a new link
            </Link>
          )}
        </AuthAlert>
      )}
      <form onSubmit={handleSubmit} className="auth-form">
        <Field
          label="New password"
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
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
          {loading ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="For your security, you'll be logged out on all other devices."
      footer={<Link href="/login">Back to log in</Link>}
    >
      <Suspense fallback={<div className="loader" />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
