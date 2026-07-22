/** `ts` is "<seconds>.<micros>". Only ever convert it for display — it is the message key. */
export function timeOf(ts: string): string {
  const d = new Date(Number(ts) * 1000);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayOf(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** `*bold*` style span for one marker: bounded by non-word chars, no leading/trailing space. */
const emphasis = (m: string) =>
  new RegExp(`(^|\\W)${m}([^${m}\\s\\n](?:[^${m}\\n]*[^${m}\\s\\n])?)${m}(?=\\W|$)`, "g");

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What the server sends alongside a message so mentions can render a name, not an id. */
export type RenderCtx = { mentions?: Record<string, string>; meId?: string };

/**
 * Slack's `mrkdwn` subset plus its mention tokens. Everything is HTML-escaped
 * first, so the only tags in the output are the ones this function inserts — that
 * is what makes the result safe to hand to dangerouslySetInnerHTML.
 *
 * Code spans are lifted out before the emphasis pass and restored afterwards, so
 * `*` and `_` inside code stay literal. The placeholder is delimited by NUL,
 * which is stripped from the input first so authored text can never forge one.
 *
 * Mention pills ride the same stash: a name like `dev_ops` would otherwise be
 * eaten by the `_italic_` pass. They are decoded after escaping, hence `&lt;@…&gt;`.
 */
export function renderText(raw: string, ctx: RenderCtx = {}): string {
  const code: string[] = [];
  // Sidecar names are raw text; a token's inline label already went through escapeHtml.
  const label = (id: string, inline?: string) =>
    (ctx.mentions?.[id] !== undefined ? escapeHtml(ctx.mentions[id]) : inline) || id;
  const stash = (html: string) => `\u0000${code.push(html) - 1}\u0000`;

  let s = escapeHtml(raw.replace(/\u0000/g, ""))
    .replace(/```\n?([\s\S]*?)```/g, (_, body: string) => stash(`<pre>${body.replace(/\n$/, "")}</pre>`))
    .replace(/`([^`\n]+)`/g, (_, body: string) => stash(`<code>${body}</code>`))
    .replace(/&lt;@(U\d+)(?:\|([^&|]*))?&gt;/g, (_, id: string, name?: string) =>
      stash(`<span class="mention${id === ctx.meId ? " me" : ""}">@${label(id, name)}</span>`),
    )
    .replace(/&lt;!(here|channel|everyone)(?:\|[^&]*)?&gt;/g, (_, kind: string) =>
      stash(`<span class="mention broadcast">@${kind}</span>`),
    )
    .replace(/&lt;#(C\d+)(?:\|([^&|]*))?&gt;/g, (_, id: string, name?: string) =>
      stash(`<span class="mention channel" data-channel="${id}">#${label(id, name)}</span>`),
    );

  s = s
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    // The span may not start or end with whitespace, so "2 * 3 * 4" stays arithmetic.
    .replace(emphasis("\\*"), "$1<strong>$2</strong>")
    .replace(emphasis("_"), "$1<em>$2</em>")
    .replace(emphasis("~"), "$1<del>$2</del>")
    .replace(/\n/g, "<br>");

  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)]);
}

/** Stable per-user colour and initials — the backend stores no avatars. */
export function avatarOf(name: string, id: string): { initials: string; color: string } {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return {
    initials: name.slice(0, 2).toUpperCase(),
    color: `hsl(${Math.abs(hash) % 360} 45% 45%)`,
  };
}
