/**
 * POST /api/code/compile — bundle a code answer for the sandbox (Phase 2).
 * Body: {language, files}. Compiles only; learner code never runs on the
 * server. Authorized by proxy.ts like every API route.
 */
import { compileCode } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	let body: { language?: unknown; files?: unknown };
	try {
		body = await request.json();
	} catch {
		return Response.json({ ok: false, errors: ["Request body must be JSON."] }, { status: 400 });
	}
	const result = await compileCode(body.language, body.files);
	return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
