import { useState } from "react";
import type { Channel } from "../types";
import { avatarOf } from "../format";

type Props = {
  team: string;
  me: string;
  meId: string;
  channels: Channel[];
  current?: string;
  unread: Set<string>;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onLogout: () => void;
};

export function Sidebar(props: Props) {
  const { team, me, meId, channels, current, unread, onSelect, onCreate, onLogout } = props;
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const avatar = avatarOf(me, meId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await onCreate(name);
      setName("");
      setOpen(false);
      setError("");
    } catch (err) {
      const code = err instanceof Error ? err.message : "unknown_error";
      setError(code === "name_taken" ? "Name taken." : code === "invalid_name" ? "Bad name." : code);
    }
  }

  return (
    <nav className="sidebar">
      <header className="team">{team}</header>

      <div className="section">
        <span>Channels</span>
        <button className="icon" onClick={() => setOpen(!open)} title="Create channel">
          +
        </button>
      </div>

      {open && (
        <form className="create" onSubmit={create}>
          <input
            autoFocus
            placeholder="new-channel"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <div className="error">{error}</div>}
        </form>
      )}

      <ul>
        {channels.map((c) => (
          <li key={c.id}>
            <button
              className={c.id === current ? "channel active" : "channel"}
              onClick={() => onSelect(c.id)}
            >
              <span className="hash">{c.is_private ? "\u{1F512}" : "#"}</span>
              <span className="name">{c.name}</span>
              {unread.has(c.id) && c.id !== current && <span className="dot" />}
            </button>
          </li>
        ))}
      </ul>

      <footer>
        <span className="avatar" style={{ background: avatar.color }}>
          {avatar.initials}
        </span>
        <span className="me">{me}</span>
        <button className="link" onClick={onLogout}>
          Sign out
        </button>
      </footer>
    </nav>
  );
}
