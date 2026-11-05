/**
 * POST /api/stt/local/transcribe — one dictated phrase as raw 16 kHz mono
 * 16-bit PCM (application/octet-stream) → {text}. Transcribed in memory on
 * this machine; the audio is never stored. Behind the sign-in check.
 */
import { LocalSttUnavailable, MAX_PHRASE_BYTES, transcribeLocally } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_PHRASE_BYTES) return Response.json({ error: "Phrase too long (30 s maximum)." }, { status: 413 });
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength > MAX_PHRASE_BYTES) return Response.json({ error: "Phrase too long (30 s maximum)." }, { status: 413 });
	try {
		return Response.json({ text: await transcribeLocally(body) }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof LocalSttUnavailable) return Response.json({ error: error.message, code: "model_missing" }, { status: 503 });
		if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
		console.error("[stt/local] transcription failed:", error instanceof Error ? error.message : error);
		return Response.json({ error: "Local transcription failed." }, { status: 500 });
	}
}
