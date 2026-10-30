"use client";

import React, { useLayoutEffect, useRef } from "react";
import { Severity } from "@/lib/spam";

export type Mark = { start: number; end: number; severity: Severity };

// Everything that decides where text wraps, copied from the field so the marks line up with its text
const COPIED = [
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "textIndent",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius",
] as const;

/**
 * Highlights flagged words inside a plain <input> or <textarea> (its only child).
 * A <textarea> can't style its own text, so a copy of the text with <mark>s is drawn behind the
 * transparent field and kept in step with its size and scroll position.
 */
export function HighlightBox({ value, marks, children }: { value: string; marks: Mark[]; children: React.ReactElement }) {
  const box = useRef<HTMLSpanElement>(null);
  const back = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const field = box.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    const backdrop = back.current;
    if (!field || !backdrop) return;
    const syncScroll = () => {
      backdrop.scrollTop = field.scrollTop;
      backdrop.scrollLeft = field.scrollLeft;
    };
    const syncBox = () => {
      const cs = getComputedStyle(field);
      for (const p of COPIED) backdrop.style[p] = cs[p];
      backdrop.style.whiteSpace = field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
      // clientWidth leaves out a textarea's scrollbar, so text wraps at the same width
      backdrop.style.width = `${field.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;
      backdrop.style.height = `${field.offsetHeight}px`;
      syncScroll();
    };
    syncBox();
    const observer = new ResizeObserver(syncBox);
    observer.observe(field);
    // A single-line input scrolls sideways without firing "scroll" in every browser
    const events = ["scroll", "input", "keyup", "mouseup", "select"] as const;
    events.forEach((e) => field.addEventListener(e, syncScroll));
    return () => {
      observer.disconnect();
      events.forEach((e) => field.removeEventListener(e, syncScroll));
    };
  }, []);

  // Keep scroll aligned after React writes a new value (e.g. a one-click fix)
  useLayoutEffect(() => {
    const field = box.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (field && back.current) {
      back.current.scrollTop = field.scrollTop;
      back.current.scrollLeft = field.scrollLeft;
    }
  }, [value, marks]);

  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of [...marks].sort((x, y) => x.start - y.start)) {
    if (m.start < at || m.end > value.length) continue; // overlapping or out of date
    parts.push(value.slice(at, m.start));
    parts.push(
      <mark key={m.start} className={`hl hl-${m.severity}`}>
        {value.slice(m.start, m.end)}
      </mark>
    );
    at = m.end;
  }
  // The trailing space keeps a final empty line the same height as in the textarea
  parts.push(value.slice(at) + " ");

  return (
    <span className="hl-box" ref={box}>
      <span className="hl-back" ref={back} aria-hidden="true">
        {parts}
      </span>
      {children}
    </span>
  );
}
