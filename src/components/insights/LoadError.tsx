"use client";

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

/** A failed load, with a way out: the error in plain words and a Try again button */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="alert alert-danger" role="alert">
      <AlertCircle size={18} />
      <div className="load-error">
        <span>{message}</span>
        <button className="btn btn-secondary btn-sm" onClick={onRetry}><RefreshCw size={14} /> Try again</button>
      </div>
    </div>
  );
}
