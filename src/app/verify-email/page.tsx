"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell, AuthAlert } from "@/components/AuthShell";
import { API_URL, NETWORK_ERROR, errorMessage } from "@/lib/auth";

function VerifyEmailStatus() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<{ status: "loading" | "success" | "error"; message: string }>({
    status: "loading",
    message: "Confirming your email…",
  });
  // Tokens are single-use, so make sure React's dev double-invoke doesn't submit twice
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;

    fetch(`${API_URL}/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        setState(
          res.ok
            ? { status: "success", message: data.message }
            : { status: "error", message: errorMessage(data, "We couldn't confirm your email.") }
        );
      })
      .catch(() => setState({ status: "error", message: NETWORK_ERROR }));
  }, [token]);

  if (!token) {
    return <AuthAlert type="error">This link isn&apos;t complete. Please open the link from your email again.</AuthAlert>;
  }

  if (state.status === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }} className="text-2">
        <div className="loader" /> {state.message}
      </div>
    );
  }

  return (
    <>
      <AuthAlert type={state.status}>{state.message}</AuthAlert>
      {state.status === "success" ? (
        <Link href="/login" className="btn btn-primary auth-submit">
          Continue to log in
        </Link>
      ) : (
        <p className="auth-subtitle">Try logging in. If your email still needs confirming, we&apos;ll offer to send you a fresh link.</p>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Confirm your email" footer={<Link href="/login">Back to log in</Link>}>
      <Suspense fallback={<div className="loader" />}>
        <VerifyEmailStatus />
      </Suspense>
    </AuthShell>
  );
}
