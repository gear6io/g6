import { useLayoutEffect, useRef, useState } from "react";

type Props = { placeholder: string; onSend: (text: string) => Promise<void> };

const MAX_HEIGHT = 200; // Matches max-height on .composer textarea.

export function Composer({ placeholder, onSend }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow with the text. Reset to auto first so scrollHeight can also shrink.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight omits the border, but box-sizing: border-box counts it in height.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, MAX_HEIGHT)}px`;
  }, [text]);

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
        ref={box}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
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
