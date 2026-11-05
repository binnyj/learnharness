/**
 * LOCAL DICTATION (owner, 2026-11-05): Whisper runs in this server process
 * via transformers.js + onnxruntime-node, so dictated audio never leaves the
 * machine. Owner requirements: pinned, verified, nothing fetched at run time.
 *
 * - The model is ONE exact revision of onnx-community/whisper-base.en. Only
 *   the files Whisper needs are downloaded, each checked against a SHA-256
 *   fingerprint written here, into a temp folder that is moved into place
 *   only when every file verifies. A mismatch deletes the download.
 * - Before the pipeline loads, every file is re-verified. transformers.js
 *   is configured to read local files only (no remote models, no cache
 *   writes elsewhere).
 * - Audio arrives as raw 16 kHz mono PCM from the browser, is transcribed
 *   in memory and never written to disk.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

export const LOCAL_STT_MODEL = "onnx-community/whisper-base.en";
export const LOCAL_STT_REVISION = "51eefc0af78b103839eda9e7e4f4186acc6517fe";
const SOURCE = `https://huggingface.co/${LOCAL_STT_MODEL}/resolve/${LOCAL_STT_REVISION}`;

/** Every file the pipeline reads, with its fingerprint and exact size. */
export const LOCAL_STT_FILES: readonly { name: string; sha256: string; size: number }[] = [
	{ name: "added_tokens.json", sha256: "560be47bea388757f8d4cc185c5d82067426cbb6361e38016dd90ddc01ab203a", size: 34604 },
	{ name: "config.json", sha256: "c8a0de5ed8a083565a4319db29d0c210fda35b4d6076c2d711cae53ae00f3cb1", size: 2197 },
	{ name: "generation_config.json", sha256: "3479b1f44a07e41db799e22599222fee5816738036def94a39841cb9cdbb4120", size: 1556 },
	{ name: "merges.txt", sha256: "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5", size: 456318 },
	{ name: "normalizer.json", sha256: "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd", size: 52666 },
	{ name: "preprocessor_config.json", sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d", size: 339 },
	{ name: "special_tokens_map.json", sha256: "98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9", size: 2173 },
	{ name: "tokenizer.json", sha256: "5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0", size: 2405679 },
	{ name: "tokenizer_config.json", sha256: "93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c", size: 282662 },
	{ name: "vocab.json", sha256: "f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f", size: 999186 },
	{ name: "onnx/encoder_model_quantized.onnx", sha256: "6e8001198c490bbae018c0044f630c2915efb826bad957006ce36152d0ab2a10", size: 23201320 },
	{ name: "onnx/decoder_model_merged_quantized.onnx", sha256: "dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909", size: 53692803 },
];
export const LOCAL_STT_TOTAL_BYTES = LOCAL_STT_FILES.reduce((n, f) => n + f.size, 0);

/** 16 kHz mono 16-bit PCM: at most 30 s per phrase (Whisper's window). */
export const LOCAL_STT_SAMPLE_RATE = 16_000;
export const MAX_PHRASE_BYTES = 30 * LOCAL_STT_SAMPLE_RATE * 2;
export const MIN_PHRASE_BYTES = Math.round(0.2 * LOCAL_STT_SAMPLE_RATE) * 2;

/** transformers.js reads `<localModelPath>/<model id>/…`. */
export function modelRoot(dataDir: string = PATHS.data): string {
	return path.join(dataDir, "models", `whisper-base.en-${LOCAL_STT_REVISION.slice(0, 12)}`);
}
function modelDir(root: string): string {
	return path.join(root, LOCAL_STT_MODEL);
}

export type LocalSttStatus =
	| { state: "missing" }
	| { state: "downloading"; receivedBytes: number; totalBytes: number }
	| { state: "ready" }
	| { state: "error"; error: string };

type Shared = { download: Promise<void> | null; received: number; error: string | null; pipeline: Promise<Transcriber> | null; queue: Promise<unknown> };
type Transcriber = (audio: Float32Array) => Promise<{ text?: string } | { text?: string }[]>;
const shared: Shared = ((globalThis as Record<string, unknown>).__lhLocalStt ??= {
	download: null, received: 0, error: null, pipeline: null, queue: Promise.resolve(),
}) as Shared;

function sha256File(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Every file present with the right size and fingerprint. */
export function verifyModelFiles(root: string = modelRoot()): { ok: true } | { ok: false; problem: string } {
	for (const f of LOCAL_STT_FILES) {
		const file = path.join(modelDir(root), f.name);
		let stat: fs.Stats;
		try { stat = fs.lstatSync(file); } catch { return { ok: false, problem: `missing ${f.name}` }; }
		if (!stat.isFile()) return { ok: false, problem: `${f.name} is not a regular file` };
		if (stat.size !== f.size) return { ok: false, problem: `${f.name} has the wrong size` };
		if (sha256File(file) !== f.sha256) return { ok: false, problem: `${f.name} failed its fingerprint check` };
	}
	return { ok: true };
}

/** Cheap status (sizes only); the full fingerprint check runs before loading. */
export function localSttStatus(root: string = modelRoot()): LocalSttStatus {
	if (shared.download) return { state: "downloading", receivedBytes: shared.received, totalBytes: LOCAL_STT_TOTAL_BYTES };
	if (shared.error) return { state: "error", error: shared.error };
	const complete = LOCAL_STT_FILES.every((f) => {
		try { const st = fs.lstatSync(path.join(modelDir(root), f.name)); return st.isFile() && st.size === f.size; } catch { return false; }
	});
	return complete ? { state: "ready" } : { state: "missing" };
}

type Fetch = (url: string) => Promise<Response>;

/** Download every file into a temp folder, verify each, then move the whole
 *  folder into place. Idempotent while running; a verified model is kept. */
export function downloadLocalSttModel(root: string = modelRoot(), fetchImpl: Fetch = (url) => fetch(url, { redirect: "follow" })): Promise<void> {
	if (shared.download) return shared.download;
	if (verifyModelFiles(root).ok) return Promise.resolve();
	shared.error = null;
	shared.received = 0;
	const staging = `${root}.download-${randomUUID()}`;
	const run = (async () => {
		try {
			for (const f of LOCAL_STT_FILES) {
				const res = await fetchImpl(`${SOURCE}/${f.name}`);
				if (!res.ok || !res.body) throw new Error(`could not download ${f.name} (HTTP ${res.status})`);
				const target = path.join(modelDir(staging), f.name);
				fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
				const out = fs.openSync(target, "wx", 0o600);
				const hash = createHash("sha256");
				let size = 0;
				try {
					const reader = res.body.getReader();
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						size += value.byteLength;
						// Never accept more than the pinned size.
						if (size > f.size) throw new Error(`${f.name} is larger than expected`);
						hash.update(value);
						fs.writeSync(out, value);
						shared.received += value.byteLength;
					}
				} finally { fs.closeSync(out); }
				if (size !== f.size || hash.digest("hex") !== f.sha256) throw new Error(`${f.name} failed its fingerprint check`);
			}
			fs.rmSync(root, { recursive: true, force: true });
			fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
			fs.renameSync(staging, root);
			const check = verifyModelFiles(root);
			if (!check.ok) throw new Error(check.problem);
		} catch (error) {
			shared.error = `Model download failed: ${error instanceof Error ? error.message : String(error)}. Nothing was installed.`;
			throw new Error(shared.error);
		} finally {
			fs.rmSync(staging, { recursive: true, force: true });
			shared.download = null;
		}
	})();
	shared.download = run;
	run.catch(() => {});
	return run;
}

async function loadPipeline(root: string): Promise<Transcriber> {
	const check = verifyModelFiles(root);
	if (!check.ok) throw new LocalSttUnavailable(`The local speech model is not ready (${check.problem}). Download it in Settings → Providers → Dictation.`);
	const { pipeline, env } = await import("@huggingface/transformers");
	// Local files only: no model hub requests and no cache folders elsewhere.
	env.allowRemoteModels = false;
	env.allowLocalModels = true;
	env.localModelPath = `${root}${path.sep}`;
	env.useFSCache = false;
	env.useBrowserCache = false;
	const asr = await pipeline("automatic-speech-recognition", LOCAL_STT_MODEL, { dtype: "q8", device: "cpu" });
	return asr as unknown as Transcriber;
}

export class LocalSttUnavailable extends Error {}

/** Transcribe one phrase of 16 kHz mono 16-bit little-endian PCM. Calls run
 *  one at a time; the loaded pipeline is reused. */
export function transcribeLocally(pcm: Uint8Array, root: string = modelRoot()): Promise<string> {
	if (pcm.byteLength % 2 !== 0 || pcm.byteLength < MIN_PHRASE_BYTES || pcm.byteLength > MAX_PHRASE_BYTES) {
		return Promise.reject(new RangeError("Audio must be 0.2–30 seconds of 16 kHz mono 16-bit PCM."));
	}
	const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
	const audio = Float32Array.from(samples, (v) => v / 32768);
	const job = shared.queue.then(async () => {
		shared.pipeline ??= loadPipeline(root).catch((error) => { shared.pipeline = null; throw error; });
		const asr = await shared.pipeline;
		const out = await asr(audio);
		const text = Array.isArray(out) ? out.map((o) => o.text ?? "").join(" ") : out.text ?? "";
		return cleanTranscript(text);
	});
	shared.queue = job.catch(() => {});
	return job;
}

/** Whisper marks silence and noise with bracketed tags; drop them. */
export function cleanTranscript(text: string): string {
	return text.replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)\]|\((?:music|silence|inaudible|noise)\)/gi, "").replace(/\s+/g, " ").trim();
}

/** Test seam: forget the loaded pipeline and any download state. */
export function resetLocalSttForTests(): void {
	shared.download = null; shared.received = 0; shared.error = null; shared.pipeline = null; shared.queue = Promise.resolve();
}
