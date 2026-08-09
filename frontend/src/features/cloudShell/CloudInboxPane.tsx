// The same inbox as the compact window, at the width the expanded one has.
// Same data, same rows, same empty and failed states — this is a second
// rendering of one surface, not a second inbox.
import {
  InboxBody,
  InboxSummary,
  UserSelect,
} from "@/features/cloudInbox/CloudMiniInbox";
import { useCloudWindow } from "@/features/cloudShell/CloudWindowProvider";

export function CloudInboxPane() {
  const { inbox: data } = useCloudWindow();
  const { inbox, retryInbox, retryUsers, select, selected, users } = data;
  const visible = inbox.status === "ready" ? inbox.value.actions : [];

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pb-10 pt-7 sm:px-7">
      <h1 className="text-[22px] font-semibold text-foreground">Inbox</h1>

      <div className="mt-1 flex items-center justify-between gap-3">
        {users.status === "ready" && selected ? (
          <UserSelect onSelect={select} selected={selected} users={users.value} />
        ) : (
          <span />
        )}
        {inbox.status === "ready" ? (
          <InboxSummary
            className="min-w-0 flex-1 justify-end"
            overview={inbox.value.overview}
          />
        ) : null}
      </div>

      {/* The rows keep their own 16px gutter, so the column supplies none. */}
      <div className="mt-4 -mx-4 border-t border-border">
        <InboxBody
          inbox={inbox}
          onRetryInbox={retryInbox}
          onRetryUsers={retryUsers}
          selected={selected}
          users={users}
          visible={visible}
        />
      </div>
    </div>
  );
}
