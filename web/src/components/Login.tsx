import { useState } from "react";
import * as api from "../api";

const MESSAGES: Record<string, string> = {
  invalid_auth: "Wrong username or password.",
  invalid_username: "Lowercase letters, digits, . _ - only, 32 characters max.",
  password_too_short: "Password must be at least 8 characters.",
  name_taken: "That username is taken.",
};

/** One form for both: try to register, then log in. An existing name is not an error here. */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      try {
        await api.register(username, password);
      } catch (err) {
        // Already registered is the common case; let login decide.
        if (!(err instanceof api.SlackError) || err.message !== "name_taken") throw err;
      }
      await api.login(username, password);
      onSignedIn();
    } catch (err) {
      const code = err instanceof Error ? err.message : "unknown_error";
      setError(MESSAGES[code] ?? code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>gear6</h1>
        <p className="muted">Sign in, or pick a new name to create an account.</p>
        <input
          autoFocus
          name="username"
          autoComplete="username"
          aria-label="Username"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          aria-label="Password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button disabled={busy || !username || !password}>{busy ? "…" : "Continue"}</button>
      </form>
    </div>
  );
}
