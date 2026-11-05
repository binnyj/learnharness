/**
 * /api/chats/[id]/code-drafts?key=<toolCallId> — unsubmitted code drafts
 * (Phase 2). GET → {files|null}; PUT {files} saves; DELETE clears.
 */
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function keyOf(request: Request): string | null {
	const key = new URL(request.url).searchParams.get("key");
	return key && /^[A-Za-z0-9_-]{1,200}$/.test(key) ? key : null;
}

async function chatOr404(ctx: Ctx): Promise<string | Response> {
	const { id } = await ctx.params;
	if (!/^[A-Za-z0-9_-]+$/.test(id) || !stores.chatStore.getChat(id)) return Response.json({ error: "No such session" }, { status: 404 });
	return id;
}

export async function GET(request: Request, ctx: Ctx) {
	const id = await chatOr404(ctx);
	if (id instanceof Response) return id;
	const key = keyOf(request);
	if (!key) return Response.json({ error: "key is required" }, { status: 400 });
	return Response.json({ files: stores.codeDraftStore.getDraft(id, key) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, ctx: Ctx) {
	const id = await chatOr404(ctx);
	if (id instanceof Response) return id;
	const key = keyOf(request);
	if (!key) return Response.json({ error: "key is required" }, { status: 400 });
	try {
		const body = (await request.json()) as { files?: unknown };
		stores.codeDraftStore.saveDraft(id, key, body.files as never);
		return Response.json({ ok: true });
	} catch {
		return Response.json({ error: "Invalid draft" }, { status: 400 });
	}
}

export async function DELETE(request: Request, ctx: Ctx) {
	const id = await chatOr404(ctx);
	if (id instanceof Response) return id;
	const key = keyOf(request);
	if (!key) return Response.json({ error: "key is required" }, { status: 400 });
	stores.codeDraftStore.clearDraft(id, key);
	return Response.json({ ok: true });
}
