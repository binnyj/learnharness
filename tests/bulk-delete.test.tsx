/**
 * Deleting several sessions (owner, 2026-11-03): the delete loop reuses the
 * single-session route one at a time and skips refusals; the select-mode
 * row and the multi-session dialog render as designed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteSessionsBody, deleteSessionsInOrder } from "../components/delete-session-dialog.tsx";
import { SessionRow } from "../components/sidebar.tsx";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("deleteSessionsInOrder", () => {
	it("deletes each session through the single route, in order, with the chosen mode", async () => {
		const calls: string[] = [];
		const fake = (async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method} ${url}`);
			return json(200, { ok: true, graphRevision: calls.length * 10 });
		}) as typeof fetch;
		const r = await deleteSessionsInOrder(["a", "b", "c"], "delete-nodes", fake);
		assert.deepEqual(calls, ["DELETE /api/chats/a?mode=delete-nodes", "DELETE /api/chats/b?mode=delete-nodes", "DELETE /api/chats/c?mode=delete-nodes"]);
		assert.deepEqual(r, { deleted: ["a", "b", "c"], skipped: [], graphRevision: 30 });
	});

	it("skips refused sessions with the server's own line and keeps going", async () => {
		const fake = (async (url: string) => {
			if (url.includes("/b?")) return json(409, { error: "A turn is running — wait for it to finish", code: "turn_in_flight" });
			if (url.includes("/c?")) throw new TypeError("offline");
			return json(200, { ok: true, graphRevision: 5 });
		}) as typeof fetch;
		const r = await deleteSessionsInOrder(["a", "b", "c", "d"], "preserve-graph", fake);
		assert.deepEqual(r.deleted, ["a", "d"]);
		assert.deepEqual(r.skipped, [{ id: "b", error: "A turn is running — wait for it to finish" }, { id: "c", error: "Network error." }]);
		assert.equal(r.graphRevision, 5);
	});
});

describe("select-mode UI", () => {
	const chat = { id: "c1", title: "React counters", createdAt: "", updatedAt: "" } as never;
	it("a selecting row shows a tick box and reports its state", () => {
		const off = renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} selecting checked={false} />);
		const on = renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} selecting checked />);
		assert.match(off, /data-testid="session-row-check"/);
		assert.match(off, /aria-pressed="false"/);
		assert.match(on, /aria-pressed="true"/);
		const normal = renderToStaticMarkup(<SessionRow chat={chat} active={false} onOpen={() => {}} />);
		assert.ok(!normal.includes("session-row-check"), "no tick box outside select mode");
	});

	it("the dialog lists every session, offers one traces box, and reports skips", () => {
		const chats = [{ id: "a", title: "First" }, { id: "b", title: "Second" }];
		const ask = renderToStaticMarkup(<DeleteSessionsBody chats={chats} traces={false} busy={false} report={null} onTraces={() => {}} onClose={() => {}} onRun={() => {}} />);
		assert.match(ask, /Delete 2 sessions\?/);
		assert.match(ask, /First/);
		assert.match(ask, /Second/);
		assert.match(ask, /Also remove their graph traces/);
		assert.match(ask, />Delete 2</);
		const after = renderToStaticMarkup(<DeleteSessionsBody chats={[chats[1]!]} traces={false} busy={false} report={{ deleted: 1, skipped: [{ title: "Second", error: "A turn is running" }] }} onTraces={() => {}} onClose={() => {}} onRun={() => {}} />);
		assert.match(after, /1 session not deleted/);
		assert.match(after, /Deleted 1\. 1 skipped/);
		assert.match(after, /Second: A turn is running/);
		assert.match(after, /Try again/);
	});
});
