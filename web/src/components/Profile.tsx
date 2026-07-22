import { useState } from "react";
import * as api from "../api";
import type { Profile as P } from "../types";

const MESSAGES: Record<string, string> = {
  invalid_profile: "One of those fields is too long, or the emoji is not a :shortcode:.",
  invalid_email: "That does not look like an email address.",
  email_taken: "Another account already uses that address.",
};

const FIELDS: { key: keyof P; label: string; placeholder: string }[] = [
  { key: "display_name", label: "Display name", placeholder: "how you appear in messages" },
  { key: "real_name", label: "Full name", placeholder: "your name" },
  { key: "title", label: "Title", placeholder: "what you do" },
  { key: "status_text", label: "Status", placeholder: "in a meeting" },
  { key: "status_emoji", label: "Status emoji", placeholder: ":coffee:" },
  { key: "email", label: "Email", placeholder: "you@example.com" },
];

type Props = {
  profile: P;
  away: boolean;
  onSaved: (p: P) => void;
  onPresence: (away: boolean) => void;
  onClose: () => void;
};

/**
 * `users.profile.set` is a partial update, so this sends only what actually
 * changed — which also means two tabs editing different fields do not clobber
 * each other.
 */
export function Profile({ profile, away, onSaved, onPresence, onClose }: Props) {
  const [draft, setDraft] = useState<P>(profile);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changed = Object.fromEntries(
    FIELDS.filter((f) => (draft[f.key] ?? "") !== (profile[f.key] ?? "")).map((f) => [
      f.key,
      draft[f.key] ?? "",
    ]),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Object.keys(changed).length) return onClose();
    setBusy(true);
    setError("");
    try {
      onSaved(await api.usersProfileSet(changed));
      onClose();
    } catch (err) {
      const code = err instanceof Error ? err.message : "unknown_error";
      setError(MESSAGES[code] ?? code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <form className="profile" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Your profile</h2>
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <input
              value={(draft[f.key] as string) ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
            />
          </label>
        ))}

        <label className="row">
          <input type="checkbox" checked={away} onChange={(e) => onPresence(e.target.checked)} />
          <span>Show me as away</span>
        </label>

        {error && <div className="error">{error}</div>}
        <div className="row actions">
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy}>{busy ? "…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
