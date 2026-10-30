"use client";

import React, { useEffect, useRef } from "react";
import { useDialogFocus } from "./useDialogFocus";

export interface ConfirmRequest {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, !!request);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="dialog-title">{request.title}</h3>
        <p>{request.message}</p>
        <div className="dialog-actions">
          {/* Destructive actions start on Cancel, so a stray Enter can't delete anything */}
          <button autoFocus={!!request.danger} className="btn btn-secondary" onClick={onClose}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            autoFocus={!request.danger}
            className={`btn ${request.danger ? "btn-danger-solid" : "btn-primary"}`}
            onClick={() => {
              onClose();
              request.onConfirm();
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
