/**
 * Local dictation model (owner, 2026-11-05).
 * GET → the model's status; POST → start the pinned, fingerprint-verified
 * download (returns at once; poll GET for progress). Behind the sign-in check.
 */
import { downloadLocalSttModel, localSttStatus, LOCAL_STT_TOTAL_BYTES } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ ...localSttStatus(), totalBytes: LOCAL_STT_TOTAL_BYTES }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
	void downloadLocalSttModel().catch(() => {}); // failures surface through GET
	return Response.json({ ...localSttStatus(), totalBytes: LOCAL_STT_TOTAL_BYTES }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
