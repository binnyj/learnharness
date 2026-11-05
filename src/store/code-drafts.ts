/**
 * The CodeDraftStore adapter (Phase 2, owner 2026-11-03): one JSON map per
 * chat at data/code-drafts/<chatId>.json, {key: {files, updatedAt}}.
 * Temp-file rename keeps each write whole; a corrupt map reads as empty.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import type { CodeDraftStore } from "../core/ports.ts";
import { MAX_CODE_FILE_CHARS, MAX_CODE_FILES, type CodeFile } from "../core/code-answer.ts";

const ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_DRAFTS_PER_CHAT = 200;

function draftFile(chatId: string): string {
	if (!ID.test(chatId)) throw new Error("Invalid chat id");
	return path.join(PATHS.codeDrafts, `${chatId}.json`);
}

type DraftMap = Record<string, { files: CodeFile[]; updatedAt: string }>;

function readMap(chatId: string): DraftMap {
	try {
		const raw = JSON.parse(fs.readFileSync(draftFile(chatId), "utf8")) as unknown;
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as DraftMap) : {};
	} catch {
		return {};
	}
}

function writeMap(chatId: string, map: DraftMap): void {
	const file = draftFile(chatId);
	if (Object.keys(map).length === 0) {
		fs.rmSync(file, { force: true });
		return;
	}
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, JSON.stringify(map), { mode: 0o600 });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function validFiles(files: unknown): files is CodeFile[] {
	return Array.isArray(files) && files.length > 0 && files.length <= MAX_CODE_FILES &&
		files.every((f) => f && typeof f.name === "string" && typeof f.content === "string" && f.content.length <= MAX_CODE_FILE_CHARS);
}

export const codeDraftStore: CodeDraftStore = {
	getDraft(chatId, key) {
		if (!ID.test(key)) return null;
		const entry = readMap(chatId)[key];
		return entry && validFiles(entry.files) ? entry.files : null;
	},
	saveDraft(chatId, key, files) {
		if (!ID.test(key)) throw new Error("Invalid draft key");
		if (!validFiles(files)) throw new Error("Invalid draft files");
		const map = readMap(chatId);
		map[key] = { files: files.map((f) => ({ name: f.name, content: f.content })), updatedAt: new Date().toISOString() };
		// Keep the newest drafts if a chat somehow accumulates many.
		const keys = Object.keys(map).sort((a, b) => map[b]!.updatedAt.localeCompare(map[a]!.updatedAt));
		for (const old of keys.slice(MAX_DRAFTS_PER_CHAT)) delete map[old];
		writeMap(chatId, map);
	},
	clearDraft(chatId, key) {
		if (!ID.test(key)) return;
		const map = readMap(chatId);
		if (!(key in map)) return;
		delete map[key];
		writeMap(chatId, map);
	},
	deleteChatDrafts(chatId) {
		fs.rmSync(draftFile(chatId), { force: true });
	},
};
