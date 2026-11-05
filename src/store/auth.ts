import { readSecureText, writeSecureText } from "../../electron/secure-json.cjs";
/** Existing AuthStore contract over encrypted, owner-only local records.
 * Legacy valid JSON migrates through verified atomic encryption. Ordinary
 * reads fail closed; mutations and custom-pair reads preserve unreadable data.
 * Provider environment-variable precedence remains in src/server/keys.ts.
 */

import { AUTH_FILE } from "../../config.ts";
import type { AuthStore } from "../core/ports.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { CUSTOM_AUTH_BINDING, parseCustomAuthBinding, type CustomAuthBinding } from "../core/custom-provider-auth.ts";

function validateAuthText(text: string): void {
 const value = JSON.parse(text);
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid credential record");
 if (Object.hasOwn(value, CUSTOM_AUTH_BINDING) && !parseCustomAuthBinding(value[CUSTOM_AUTH_BINDING])) throw new Error("Invalid credential binding");
}

/** The flat string→string map, or {} for absent/corrupt/non-object. */
function readMap(strict = false): Record<string, string> {
	try {
		const raw = JSON.parse(readSecureText(AUTH_FILE, validateAuthText));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return Object.fromEntries(
			Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][],
		);
	} catch (error) {
		if (strict && (error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Credential storage unavailable or corrupt; existing data was preserved.");
		return {}; // absent
	}
}

/** Write the map encrypted and atomically at mode 0600: secure-json stages
 *  a 0600 temp file, verifies it decrypts to the same text, then renames —
 *  a partial write never leaves a relaxed or truncated credential file. */
function writeMap(map: Record<string, unknown>): void {
	writeSecureText(AUTH_FILE, JSON.stringify(map));
}

export const authStore: AuthStore = {
	authVars() {
		return readMap();
	},
	setAuthVar(name, value) {
		assertOrdinaryVar(name);
		const map = readMap(true);
		map[name] = value;
		writeMap(map);
	},
	deleteAuthVar(name) {
		assertOrdinaryVar(name);
		const map = readMap(true);
		if (!(name in map)) return; // absent = silent success, idempotent
		delete map[name];
		writeMap(map);
	},
};

/** Custom writes must never turn an unreadable/corrupt private file into {}.
 * Other providers retain their existing adapter semantics. Unknown JSON values
 * survive custom-only updates, not just the ordinary string projection. */
function readCustomMap(): Record<string, unknown> {
	let text: string;
	try { text = readSecureText(AUTH_FILE, validateAuthText); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("Custom authorization storage unavailable"); }
	let raw: unknown;
	try { raw = JSON.parse(text); } catch { throw new Error("Custom authorization storage unavailable"); }
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Custom authorization storage unavailable");
	const map = raw as Record<string, unknown>;
	if (Object.hasOwn(map, CUSTOM_AUTH_BINDING) && !parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING])) throw new Error("Invalid custom authorization record");
	if (Object.hasOwn(map, CUSTOM_PROVIDER.envVar) && typeof map[CUSTOM_PROVIDER.envVar] !== "string") throw new Error("Invalid custom credential record");
	return map;
}
function assertOrdinaryVar(name: string): void {
	if (name === CUSTOM_AUTH_BINDING || name === CUSTOM_PROVIDER.envVar) throw new Error("Use the custom endpoint editor");
}
/** One immutable file snapshot. Keyless callers never invoke fileKey(). */
export function readCustomAuth() {
	const map = readCustomMap();
	return { binding: parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING]), fileKey: () => map[CUSTOM_PROVIDER.envVar] as string | undefined };
}
/** Replace just the custom pair in ONE existing atomic record write. */
export function writeCustomAuth(binding: CustomAuthBinding | undefined, fileKey: string | undefined): void {
	const map = readCustomMap();
	if (binding && !parseCustomAuthBinding(JSON.stringify(binding))) throw new Error("Invalid custom authorization record");
	if (fileKey === undefined) delete map[CUSTOM_PROVIDER.envVar];
	else Object.defineProperty(map, CUSTOM_PROVIDER.envVar, { value: fileKey, enumerable: true, configurable: true, writable: true });
	if (binding === undefined) delete map[CUSTOM_AUTH_BINDING];
	else Object.defineProperty(map, CUSTOM_AUTH_BINDING, { value: JSON.stringify(binding), enumerable: true, configurable: true, writable: true });
	writeMap(map);
}
