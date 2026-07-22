import { useLayoutEffect, useRef, useState } from "react";
import type { Channel, User } from "../types";

type Props = {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  users: User[];
  channels: Channel[];
};

const MAX_HEIGHT = 200; // Matches max-height on .composer textarea.

/** A half-typed `@name` / `#name` ending at the caret. The charset is the one the server encodes. */
const PARTIAL = /(^|\s)([@#])([a-z0-9._-]*)$/i;
const MAX_SUGGESTIONS = 8;

export function Composer({ placeholder, onSend, users, channels }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // Where the open typeahead started, so a pick knows what it replaces.
  const [menu, setMenu] = useState<{ sigil: string; query: string; start: number }>();
  const [pick, setPick] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const caretTo = useRef<number>(null);

  // Nothing is sent as a token — the server linkifies `@name` on write, so the
  // textarea stays plain text the author can edit.
  const options = !menu
    ? []
    : (menu.sigil === "@"
        ? [...users.map((u) => u.name), "here", "channel"]
        : channels.map((c) => c.name)
      )
        .filter((n) => n.startsWith(menu.query))
        .slice(0, MAX_SUGGESTIONS);
  const active = Math.min(pick, options.length - 1);

  // Grow with the text. Reset to auto first so scrollHeight can also shrink.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight omits the border, but box-sizing: border-box counts it in height.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight + border, MAX_HEIGHT)}px`;
    // A pick rewrote the value; put the caret after what it inserted.
    if (caretTo.current !== null) {
      el.focus();
      el.setSelectionRange(caretTo.current, caretTo.current);
      caretTo.current = null;
    }
  }, [text]);

  function onChange(value: string, caret: number) {
    setText(value);
    const m = PARTIAL.exec(value.slice(0, caret));
    setMenu(m ? { sigil: m[2], query: m[3].toLowerCase(), start: caret - m[3].length - 1 } : undefined);
    setPick(0);
  }

  function choose(name: string) {
    if (!menu) return;
    const caret = box.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, menu.start)}${menu.sigil}${name} ${text.slice(caret)}`);
    caretTo.current = menu.start + name.length + 2; // sigil + name + trailing space
    setMenu(undefined);
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText(""); // Clear first so typing can continue while the POST is in flight.
    setMenu(undefined);
    try {
      await onSend(body);
      setError("");
    } catch (err) {
      setText(body); // Failed send: give the text back rather than losing it.
      setError(err instanceof Error ? err.message : "unknown_error");
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (options.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : options.length - 1;
        setPick((active + step) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault(); // Enter picks while the menu is open; it only sends when closed.
        choose(options[active]);
        return;
      }
      if (e.key === "Escape") {
        setMenu(undefined);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="composer">
      {error && <div className="error">{error}</div>}
      {options.length > 0 && (
        <ul className="typeahead" role="listbox" aria-label="Mention suggestions">
          {options.map((name, i) => (
            <li
              key={name}
              id={`mention-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // mousedown, not click: the textarea must not lose focus first.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(name);
              }}
            >
              {menu?.sigil}
              {name}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={box}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-activedescendant={options.length > 0 ? `mention-${active}` : undefined}
        value={text}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={onKeyDown}
        onBlur={() => setMenu(undefined)}
      />
    </div>
  );
}
