import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CloudGatewayError,
  gatewayOrigin,
  health,
  listActions,
  listDevUsers,
  listMilestones,
  milestoneTimeline,
  overview,
  resolveExtraction,
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
    const milestones = await listMilestones({
      cursor: "AbC=",
      limit: 50,
    });
    assert.deepEqual(milestones, PAGE, "no dates, ages or ids are remapped");

    const url = new URL(fetchStub.calls[0].url);
    assert.equal(url.pathname, "/api/cloud/v1/milestones");
    assert.equal(
      url.searchParams.get("cursor"),
      "AbC=",
      "the opaque cursor survives the round trip",
    );
    assert.equal(url.searchParams.get("limit"), "50");

    await listMilestones();
    const second = new URL(fetchStub.calls[1].url);
    assert.equal(second.pathname, "/api/cloud/v1/milestones");
    assert.equal(second.search, "", "an empty query stays empty");
  } finally {
    fetchStub.restore();
  }
});

test("the actor-scoped routes send the account as a query, never a header", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    await listActions("U024BE7LH");
    await overview("U024BE7LH");
    await listDevUsers();

    const paths = fetchStub.calls.map((call) => new URL(call.url).pathname);
    assert.deepEqual(paths, [
      "/api/cloud/v1/actions",
      "/api/cloud/v1/overview",
      "/api/cloud/v1/dev/users",
    ]);

    for (const call of fetchStub.calls.slice(0, 2)) {
      assert.equal(
        new URL(call.url).searchParams.get("account_id"),
        "U024BE7LH",
      );
    }
    assert.equal(
      new URL(fetchStub.calls[2].url).search,
      "",
      "the directory takes no parameters",
    );

    // The backend validates the account and writes the header itself, so the
    // browser sends none — which is why it is absent from the CORS allowlist.
    for (const call of fetchStub.calls) {
      assert.equal(call.init?.headers, undefined, "no browser-set headers");
    }
  } finally {
    fetchStub.restore();
  }

  const source = fs.readFileSync(path.join(clientDir, "client.ts"), "utf8");
  assert.ok(
    !/X-G6-Actor-ID/i.test(source),
    "the actor header is a backend concern",
  );
});

test("the milestone routes carry no account and page on their own key", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const id = "0123456789abcdef0123456789abcdef";
  try {
    await listMilestones({ limit: 12 });
    await milestoneTimeline(id, { from: "2026-07-10", to: "2026-08-08" });
    await milestoneTimeline(id);

    const [list, timeline, bare] = fetchStub.calls.map(
      (call) => new URL(call.url),
    );
    assert.equal(list.pathname, "/api/cloud/v1/milestones");
    assert.equal(list.searchParams.get("limit"), "12");

    assert.equal(timeline.pathname, `/api/cloud/v1/milestones/${id}/timeline`);
    assert.equal(timeline.searchParams.get("from"), "2026-07-10");
    assert.equal(timeline.searchParams.get("to"), "2026-08-08");
    assert.equal(bare.search, "", "Cloud supplies its own 30-day default range");

    // A milestone's history is the same for every viewer.
    for (const url of [list, timeline, bare]) {
      assert.equal(url.searchParams.get("account_id"), null);
    }
  } finally {
    fetchStub.restore();
  }
});

test("a merged milestone keeps Cloud's own 410 code", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(
        JSON.stringify({
          error: {
            code: "milestone_merged",
            message: "merged into another identity",
          },
        }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
  );
  try {
    await assert.rejects(
      milestoneTimeline("0123456789abcdef0123456789abcdef"),
      (err) => {
        assert.ok(err instanceof CloudGatewayError);
        assert.equal(err.code, "milestone_merged");
        return true;
      },
    );
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
    await assert.rejects(listMilestones({ cursor: "nope" }), (err) => {
      assert.ok(err instanceof CloudGatewayError);
      assert.equal(err.code, "invalid_cursor");
      assert.equal(err.message, "cursor is malformed");
      return true;
    });
  } finally {
    fetchStub.restore();
  }
});

test("resolve posts the request as written and adds no query string", async () => {
  const reply = {
    type: "raw",
    data: { results: [{ queryName: "extraction", nextCursor: "", rows: [] }] },
  };
  const fetchStub = stubFetch(
    () =>
      new Response(JSON.stringify(reply), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  try {
    const request = {
      provider: "slack",
      reference: { type: "trace", id: "0123456789abcdef0123456789abcdef" },
      depth: "context",
      limit: 50,
    };
    const got = await resolveExtraction(request);
    assert.deepEqual(got, reply);

    const [call] = fetchStub.calls;
    // The reference travels in the body, not the URL: a thread id is not a
    // filter and must not end up in a log line as one.
    assert.equal(
      call.url,
      "http://localhost:3000/api/cloud/v1/extractions/resolve",
    );
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), request);
  } finally {
    fetchStub.restore();
  }
});

test("a resolve failure throws with Cloud's own code, like every other route", async () => {
  const fetchStub = stubFetch(
    () =>
      new Response(
        JSON.stringify({
          error: { code: "signal_not_found", message: "no such reference" },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
  );
  try {
    await assert.rejects(
      resolveExtraction({
        provider: "github",
        reference: { type: "trace", id: "0123456789abcdef0123456789abcdef" },
      }),
      (err) => {
        assert.ok(err instanceof CloudGatewayError);
        assert.equal(err.code, "signal_not_found");
        return true;
      },
    );
  } finally {
    fetchStub.restore();
  }
});
