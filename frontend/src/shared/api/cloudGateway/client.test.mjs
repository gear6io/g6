import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CloudGatewayError,
  gatewayOrigin,
  health,
  listOpenConstraints,
  listOpenDecisions,
} from "./client.ts";

const clientDir = path.dirname(fileURLToPath(import.meta.url));

/** Record every request and answer with a canned Response. */
function stubFetch(reply) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return reply();
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const PAGE = {
  data: [
    {
      id: "9f2c1b0e",
      kind: "decision",
      subject: "pick a queue",
      entity: null,
      work_item_ids: ["t-1"],
      work_item_count: 1,
      opened_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      age_seconds: 86_400,
      confidence: 0.42,
    },
  ],
  page: { limit: 50, next_cursor: "AbC=" },
  generated_at: "2026-01-03T00:00:00Z",
};

test("every call goes to the backend origin, never to a Cloud origin", async () => {
  const fetchStub = stubFetch(() => new Response("ok", { status: 200 }));
  try {
    await health();
    assert.equal(
      fetchStub.calls[0].url,
      "http://localhost:3000/api/cloud/healthz",
    );
    assert.equal(gatewayOrigin(), "http://localhost:3000");
  } finally {
    fetchStub.restore();
  }

  // Belt and braces: the Cloud base URL is a backend-only concept and must not
  // appear anywhere in the client's source.
  const source = fs.readFileSync(path.join(clientDir, "client.ts"), "utf8");
  assert.ok(
    !source.includes("GEAR6_CLOUD_BASE_URL"),
    "the webview must not know the Cloud upstream setting",
  );
  assert.ok(
    !/VITE_(?!RELAY_URL)[A-Z_]*CLOUD/.test(source),
    "the Cloud origin must not be a frontend env var",
  );
});

test("healthz maps a ready backend to ready", async () => {
  const fetchStub = stubFetch(() => new Response("ok", { status: 200 }));
  try {
    assert.deepEqual(await health(), { ready: true });
  } finally {
    fetchStub.restore();
  }
});

test("a gateway error envelope keeps its code", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(
        JSON.stringify({
          error: {
            code: "cloud_not_configured",
            message: "no upstream configured",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
  );
  try {
    assert.deepEqual(await health(), {
      ready: false,
      code: "cloud_not_configured",
      message: "no upstream configured",
    });
  } finally {
    fetchStub.restore();
  }
});

test("Cloud's plain-text 503 readiness is reachable-but-not-ready", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response("read model unavailable", {
        status: 503,
        headers: { "content-type": "text/plain" },
      }),
  );
  try {
    const result = await health();
    assert.equal(result.ready, false);
    assert.equal(result.code, "cloud_not_ready");
    assert.equal(result.message, "read model unavailable");
  } finally {
    fetchStub.restore();
  }
});

test("a dead backend is an unavailable result, not a rejection", async () => {
  const fetchStub = stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  try {
    const result = await health();
    assert.equal(result.ready, false);
    assert.equal(result.code, "cloud_unreachable");
  } finally {
    fetchStub.restore();
  }
});

test("a backend that never answers reports a timeout", async () => {
  const fetchStub = stubFetch(() => {
    const err = new Error("signal timed out");
    err.name = "TimeoutError";
    throw err;
  });
  try {
    const result = await health();
    assert.equal(result.ready, false);
    assert.equal(result.code, "cloud_timeout");
  } finally {
    fetchStub.restore();
  }
});

test("list responses are returned exactly as received", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const decisions = await listOpenDecisions({
      cursor: "AbC=",
      limit: 50,
      entity_id: "0123456789abcdef0123456789abcdef",
    });
    assert.deepEqual(decisions, PAGE, "no dates, ages or ids are remapped");

    const url = new URL(fetchStub.calls[0].url);
    assert.equal(url.pathname, "/api/cloud/v1/open-decisions");
    assert.equal(
      url.searchParams.get("cursor"),
      "AbC=",
      "the opaque cursor survives the round trip",
    );
    assert.equal(url.searchParams.get("limit"), "50");

    await listOpenConstraints();
    const second = new URL(fetchStub.calls[1].url);
    assert.equal(second.pathname, "/api/cloud/v1/open-constraints");
    assert.equal(second.search, "", "an empty query stays empty");
  } finally {
    fetchStub.restore();
  }
});

test("a Cloud error on a list route throws with Cloud's own code", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(
        JSON.stringify({
          error: { code: "invalid_cursor", message: "cursor is malformed" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );
  try {
    await assert.rejects(listOpenDecisions({ cursor: "nope" }), (err) => {
      assert.ok(err instanceof CloudGatewayError);
      assert.equal(err.code, "invalid_cursor");
      assert.equal(err.message, "cursor is malformed");
      return true;
    });
  } finally {
    fetchStub.restore();
  }
});
