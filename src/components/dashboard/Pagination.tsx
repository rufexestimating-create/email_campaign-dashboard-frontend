"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Client-side paging. The page goes back to 1 whenever `resetKey` changes (e.g. a new search or filter),
 * without an effect: the stored page only counts while it belongs to the current key.
 */
export function usePagination<T>(items: T[], resetKey: string, initialSize = 25) {
  const [size, setSize] = useState(initialSize);
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(state.key === resetKey ? state.page : 1, pageCount);
  return {
    page,
    pageCount,
    size,
    total: items.length,
    pageItems: items.slice((page - 1) * size, page * size),
    setPage: (p: number) => setState({ key: resetKey, page: p }),
    setSize: (s: number) => {
      setSize(s);
      setState({ key: resetKey, page: 1 });
    },
  };
}

/** 1 … 4 5 6 … 31 */
function pageList(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? ["gap" as const, p] : [p]));
}

export function Pagination({
  page,
  pageCount,
  size,
  total,
  setPage,
  setSize,
  noun,
  sizes = [10, 25, 50, 100],
  scrollTo,
}: ReturnType<typeof usePagination> & { noun: string; sizes?: number[]; scrollTo?: string }) {
  if (total === 0) return null;
  const go = (p: number) => {
    setPage(p);
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);

  return (
    <nav className="pager" aria-label={`${noun} pages`}>
      <div className="pager-info">
        Showing <strong>{from.toLocaleString()}–{to.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong> {noun}
      </div>
      <div className="pager-controls">
        <label className="pager-size">
          <span>Per page</span>
          <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page">
            {sizes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {pageCount > 1 && (
          <div className="pager-pages">
            <button className="pager-btn" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            {pageList(page, pageCount).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} className="pager-gap">…</span>
              ) : (
                <button key={p} className={`pager-btn ${p === page ? "active" : ""}`} onClick={() => go(p)} aria-current={p === page ? "page" : undefined}>
                  {p}
                </button>
              )
            )}
            <button className="pager-btn" onClick={() => go(page + 1)} disabled={page === pageCount} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
