import { useState } from "react";

type Props = { placeholder: string; onSend: (text: string) => Promise<void> };

export function Composer({ placeholder, onSend }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText(""); // Clear first so typing can continue while the POST is in flight.
    try {
      await onSend(body);
      setError("");
    } catch (err) {
      setText(body); // Failed send: give the text back rather than losing it.
      setError(err instanceof Error ? err.message : "unknown_error");
    }
  }

  return (
    <div className="composer">
      {error && <div className="error">{error}</div>}
      <textarea
        rows={1}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
    </div>
  );
}
