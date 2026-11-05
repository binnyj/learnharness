/**
 * Local dictation (owner, 2026-11-05): the phrase splitter, the pinned and
 * fingerprint-checked model download, request limits and the engine
 * setting. No network and no real model: downloads use a fake fetch.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-local-stt-"));
process.env.LH_DATA_DIR = path.join(tmp, "data");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const splitter = await import("../src/core/phrase-splitter.ts");
const stt = await import("../src/server/local-stt.ts");
const { parseDictationSettingsBody } = await import("../src/server/settings-body.ts");
const { sanitizeUserSettings, FACTORY_SETTINGS } = await import("../src/core/settings.ts");

const FRAME = 2048; // the worklet's 128 ms frames
const silence = () => new Int16Array(FRAME);
const speech = () => Int16Array.from({ length: FRAME }, (_, i) => Math.round(Math.sin(i / 5) * 8000));

describe("phrase splitter", () => {
	it("never produces a phrase from silence alone", () => {
		let s = splitter.freshSplitter();
		for (let i = 0; i < 50; i++) {
			const step = splitter.splitStep(s, silence());
			assert.equal(step.phrase, undefined);
			s = step.state;
		}
		assert.equal(splitter.splitFlush(s), undefined);
	});

	it("cuts a phrase at a pause and keeps a short lead-in", () => {
		let s = splitter.freshSplitter();
		for (let i = 0; i < 5; i++) s = splitter.splitStep(s, silence()).state;
		for (let i = 0; i < 10; i++) s = splitter.splitStep(s, speech()).state;
		let phrase: Int16Array | undefined;
		for (let i = 0; i < 10 && !phrase; i++) {
			const step = splitter.splitStep(s, silence());
			s = step.state;
			phrase = step.phrase;
		}
		assert.ok(phrase, "a 0.7 s pause ends the phrase");
		const frames = phrase!.length / FRAME;
		assert.ok(frames >= 10 + 3 && frames <= 10 + 3 + 6, `lead-in + speech + pause (${frames} frames)`);
	});

	it("cuts long speech at Whisper's window and flushes speech in progress on stop", () => {
		let s = splitter.freshSplitter();
		let phrase: Int16Array | undefined;
		for (let i = 0; i < 400 && !phrase; i++) {
			const step = splitter.splitStep(s, speech());
			s = step.state;
			phrase = step.phrase;
		}
		assert.ok(phrase && phrase.length <= 30 * 16_000, "cut before 30 s");
		s = splitter.splitStep(splitter.freshSplitter(), speech()).state;
		assert.equal(splitter.splitFlush(s)?.length, FRAME);
	});
});

describe("pinned model", () => {
	beforeEach(() => stt.resetLocalSttForTests());

	it("pins one revision and fingerprints every file it needs", () => {
		assert.match(stt.LOCAL_STT_REVISION, /^[0-9a-f]{40}$/);
		assert.equal(stt.LOCAL_STT_FILES.length, 12);
		for (const f of stt.LOCAL_STT_FILES) assert.match(f.sha256, /^[0-9a-f]{64}$/, f.name);
		assert.ok(stt.LOCAL_STT_FILES.some((f) => f.name === "onnx/encoder_model_quantized.onnx"));
		assert.equal(stt.localSttStatus(path.join(tmp, "none")).state, "missing");
	});

	it("rejects files that are missing, the wrong size, or fail the fingerprint", () => {
		const root = path.join(tmp, "tampered");
		const dir = path.join(root, stt.LOCAL_STT_MODEL);
		assert.match(JSON.stringify(stt.verifyModelFiles(root)), /missing/);
		for (const f of stt.LOCAL_STT_FILES) {
			fs.mkdirSync(path.dirname(path.join(dir, f.name)), { recursive: true });
			fs.writeFileSync(path.join(dir, f.name), "");
			fs.truncateSync(path.join(dir, f.name), f.size); // right size, wrong bytes
		}
		assert.equal(stt.localSttStatus(root).state, "ready", "status is a cheap size check");
		assert.match(JSON.stringify(stt.verifyModelFiles(root)), /failed its fingerprint check/);
		fs.truncateSync(path.join(dir, stt.LOCAL_STT_FILES[0]!.name), 1); // checked first
		assert.match(JSON.stringify(stt.verifyModelFiles(root)), /wrong size/);
	});

	it("downloads only from the pinned revision and installs nothing when a file is wrong", async () => {
		const root = path.join(tmp, "download-bad");
		const urls: string[] = [];
		const fake = async (url: string) => { urls.push(url); return new Response(new Uint8Array([1, 2, 3])); };
		await assert.rejects(() => stt.downloadLocalSttModel(root, fake), /failed its fingerprint check|Nothing was installed/);
		assert.equal(fs.existsSync(root), false, "nothing installed");
		assert.ok(urls.every((u) => u.startsWith(`https://huggingface.co/${stt.LOCAL_STT_MODEL}/resolve/${stt.LOCAL_STT_REVISION}/`)), urls.join("\n"));
		assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.includes(".download-")), [], "staging is removed");
		assert.equal(stt.localSttStatus(root).state, "error");
	});

	it("stops reading a file that is larger than its pinned size", async () => {
		const root = path.join(tmp, "download-big");
		const fake = async () => new Response(new Uint8Array(stt.LOCAL_STT_FILES[0]!.size + 10));
		await assert.rejects(() => stt.downloadLocalSttModel(root, fake), /larger than expected/);
		assert.equal(fs.existsSync(root), false);
	});

	it("bounds phrases and refuses to transcribe without a verified model", async () => {
		await assert.rejects(() => stt.transcribeLocally(new Uint8Array(3)), RangeError, "odd byte count");
		await assert.rejects(() => stt.transcribeLocally(new Uint8Array(100)), RangeError, "too short");
		await assert.rejects(() => stt.transcribeLocally(new Uint8Array(stt.MAX_PHRASE_BYTES + 2)), RangeError, "too long");
		await assert.rejects(() => stt.transcribeLocally(new Uint8Array(32_000), path.join(tmp, "none")), stt.LocalSttUnavailable);
		assert.equal(stt.cleanTranscript(" [BLANK_AUDIO] hello  (music) world "), "hello world");
	});
});

describe("engine setting", () => {
	it("defaults to local and accepts only known engines", () => {
		assert.equal(FACTORY_SETTINGS.dictation.engine, "local");
		assert.deepEqual(parseDictationSettingsBody({ language: "en", engine: "deepgram" }), { ok: true, settings: { language: "en", engine: "deepgram" } });
		assert.equal(parseDictationSettingsBody({ engine: "google" }).ok, false);
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { language: "en", engine: "google" } })?.dictation, { language: "en" });
		assert.deepEqual(sanitizeUserSettings({ version: 1, dictation: { engine: "local" } })?.dictation, { engine: "local" });
	});
});
