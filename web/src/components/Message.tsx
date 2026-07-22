import type { Message as Msg, User } from "../types";
import { avatarOf, renderText, timeOf } from "../format";

type Props = {
  msg: Msg;
  users: Map<string, User>;
  /** Same author as the message above within a couple of minutes: drop the header. */
  compact?: boolean;
  onOpenThread?: () => void;
};

export function Message({ msg, users, compact, onOpenThread }: Props) {
  const user = users.get(msg.user);
  const name = user?.profile.display_name || user?.name || msg.user;
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
            <span className="time">{timeOf(msg.ts)}</span>
          </div>
        )}
        {/* renderText escapes before it inserts any markup — see format.ts. */}
        <div className="text" dangerouslySetInnerHTML={{ __html: renderText(msg.text) }} />
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
