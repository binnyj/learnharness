import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { settingsStore } from "../store/settings.ts";
export function learningFolders(): string[] {
 const value = settingsStore.readSettings()?.security as { learningFolders?: unknown } | undefined;
 return Array.isArray(value?.learningFolders) ? value.learningFolders.filter((p): p is string => typeof p === "string") : [];
}
/** Raised when a grant would expose a whole system or home folder and the user has not confirmed it. */
export class BroadFolderError extends Error {
 constructor(readonly folders: string[]) { super(`These folders are very broad: ${folders.join(", ")}. Approving them lets the tutor read almost everything inside.`); }
}
function canonical(p: string): string { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
export function broadFolders(roots: string[]): string[] {
 const broad = new Set(["/", os.homedir(), "/Users", "/System", "/Library", "/Volumes", "/Applications", "/private", "/etc"].map(canonical));
 return roots.filter(p => broad.has(p));
}
export function saveLearningFolders(value: unknown, confirmBroad = false): string[] {
 if (!Array.isArray(value) || value.length > 32 || value.some(p => typeof p !== "string" || !path.isAbsolute(p))) throw new Error("Enter up to 32 absolute folder paths.");
 const roots = [...new Set(value.map(p => fs.realpathSync(p)))];
 if (roots.some(p => !fs.statSync(p).isDirectory())) throw new Error("Each path must be an existing folder.");
 const broad = broadFolders(roots);
 if (broad.length > 0 && confirmBroad !== true) throw new BroadFolderError(broad);
 const record = settingsStore.readSettings() ?? { version: 1 };
 settingsStore.writeSettings({ ...record, security: { learningFolders: roots } });
 return roots;
}
