import { index, route, rootRoute } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/invite/$code", "invite.$code.tsx"),
  // DEAD CODE — repos routes unwired for gear6. The Buzz Nostr repo browser
  // needs kind:30617 events + git smart-HTTP, which the gear6 backend does not
  // serve. Files kept under features/repos/ for a future forge. See
  // web/src/features/repos/README.md.
  // route("/repos", "repos.tsx"),
  // route("/repos/$repoId", "repos.$repoId.tsx"),
  // route("/repos/$repoId/blob/$", "repos.$repoId.blob.$.tsx"),
]);
