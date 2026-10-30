"use client";

import React from "react";
import { Info, MailPlus, Plus, Trash2 } from "lucide-react";
import { FOLLOW_UP_WAITS, FollowUpDraft, MAX_FOLLOW_UPS } from "@/lib/campaigns";

// Same opt-out line the spam check suggests: follow-ups are marketing email too, so CAN-SPAM applies to each one
const UNSUBSCRIBE_LINE = "Don't want these emails? Reply \"unsubscribe\" and we'll take you off our list.";

const STARTERS: FollowUpDraft[] = [
  {
    wait_days: 3,
    subject: "Following up, {{first_name}}",
    body: `Hi {{first_name}},\n\nJust checking whether my last email reached you at a good time. Happy to share a few examples of similar projects if that's useful.\n\nBest regards,\n\n${UNSUBSCRIBE_LINE}`,
  },
  {
    wait_days: 5,
    subject: "One last note, {{first_name}}",
    body: `Hi {{first_name}},\n\nI don't want to fill your inbox, so this is my last note for now. If the timing changes, just reply and we'll pick it up from there.\n\nBest regards,\n\n${UNSUBSCRIBE_LINE}`,
  },
];

/** Optional follow-up emails for a one-off campaign: each waits a few days and stops when the person replies */
export function FollowUpsEditor({
  value,
  onChange,
  recurring,
}: {
  value: FollowUpDraft[];
  onChange: (next: FollowUpDraft[]) => void;
  /** Repeating campaigns can't have follow-ups */
  recurring: boolean;
}) {
  const update = (i: number, patch: Partial<FollowUpDraft>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="followups">
      <div className="followups-head">
        <div>
          <h3 className="followups-title"><MailPlus size={16} /> Automatic follow-ups</h3>
          <p className="field-hint">
            Optional. Sent only to people who haven&apos;t replied, at each person&apos;s best time to read email.
          </p>
        </div>
        {!recurring && value.length < MAX_FOLLOW_UPS && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...value, STARTERS[value.length]])}>
            <Plus size={14} /> Add follow-up
          </button>
        )}
      </div>

      {recurring ? (
        <p className="field-hint followups-note"><Info size={14} /> Follow-ups are available for one-off campaigns, not repeating ones.</p>
      ) : (
        <>
          {value.map((f, i) => (
            <div key={i} className="followup">
              <div className="followup-top">
                <span className="followup-step">Follow-up {i + 1}</span>
                <label className="followup-wait">
                  <span>Send</span>
                  <select className="input" value={f.wait_days} onChange={(e) => update(i, { wait_days: Number(e.target.value) })} aria-label={`Wait before follow-up ${i + 1}`}>
                    {FOLLOW_UP_WAITS.map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                  <span>after the {i === 0 ? "first email" : "previous follow-up"}</span>
                </label>
                <button type="button" className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove follow-up ${i + 1}`}>
                  <Trash2 size={15} />
                </button>
              </div>
              <label className="field">
                <span className="field-label">Subject line</span>
                <input className="input" maxLength={255} value={f.subject} onChange={(e) => update(i, { subject: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Message</span>
                <textarea className="input textarea" rows={5} value={f.body} onChange={(e) => update(i, { body: e.target.value })} />
              </label>
            </div>
          ))}
          {value.length > 0 && (
            <p className="field-hint followups-note">
              <Info size={14} />
              Follow-ups stop for anyone who replies, bounces, reports spam, becomes sales-ready, or is marked as sales-qualified, customer or lost.
              If someone usually takes a day or more to reply, they get extra time before the next email.
              Keep the unsubscribe line and your postal address in each follow-up, as in your first email.
            </p>
          )}
        </>
      )}
    </div>
  );
}
