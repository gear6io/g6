import type { Message as Msg, User } from "../types";
import { avatarOf, renderText, timeOf } from "../format";

type Props = {
  msg: Msg;
  users: Map<string, User>;
  meId: string;
  /** Same author as the message above within a couple of minutes: drop the header. */
  compact?: boolean;
  onOpenThread?: () => void;
  onOpenChannel?: (id: string) => void;
};

export function Message({ msg, users, meId, compact, onOpenThread, onOpenChannel }: Props) {
  const user = users.get(msg.user);
  // Slack's fallback order. `real_name` is seeded from the username at registration,
  // so the bare id only shows for an author this tab has never resolved.
  const name = user?.profile.display_name || user?.profile.real_name || user?.name || msg.user;
  const status = user?.profile.status_emoji;
  const avatar = avatarOf(name, msg.user);
  const replies = msg.reply_count ?? 0;

  return (
    <div className={compact ? "msg compact" : "msg"}>
      {compact ? (
        <span className="gutter">{timeOf(msg.ts)}</span>
      ) : (
        <span className="avatar" style={{ background: avatar.color }}>
          {avatar.initials}
        </span>
      )}
      <div className="body">
        {!compact && (
          <div className="meta">
            <span className="author">{name}</span>
            {/* Shortcode, not a glyph — there is no emoji table, so show it as typed. */}
            {status && (
              <span className="status-emoji" title={user?.profile.status_text || status}>
                {status}
              </span>
            )}
            <span className="time">{timeOf(msg.ts)}</span>
          </div>
        )}
        {/* renderText escapes before it inserts any markup — see format.ts. */}
        {/* One delegated handler: a channel pill inside innerHTML cannot carry its own. */}
        <div
          className="text"
          onClick={(e) => {
            const pill = (e.target as HTMLElement).closest<HTMLElement>("[data-channel]");
            if (pill?.dataset.channel) onOpenChannel?.(pill.dataset.channel);
          }}
          dangerouslySetInnerHTML={{
            __html: renderText(msg.text, { mentions: msg.mentions, meId }),
          }}
        />
        {onOpenThread && replies > 0 && (
          <button className="replies" onClick={onOpenThread}>
            {replies} {replies === 1 ? "reply" : "replies"}
            {msg.latest_reply && <span className="muted"> · last {timeOf(msg.latest_reply)}</span>}
          </button>
        )}
      </div>
      {onOpenThread && replies === 0 && (
        <button className="reply-action" onClick={onOpenThread} title="Reply in thread">
          Reply
        </button>
      )}
    </div>
  );
}
