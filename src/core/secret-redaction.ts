/**
 * Secret redaction (Phase 1 security, 2026-11-03). Pure and browser-safe:
 * callers pass the environment. Live API keys are reflected into the
 * process environment (server/keys.ts fill-gap), so the environment is the
 * one place every credential an engine can send is visible. Values are
 * replaced verbatim wherever they appear — tool results, provider error
 * text, background-job error records — before they are shown or saved.
 */
import { AUTH_PROVIDER_ENV_VARS, CUSTOM_PROVIDER } from "./auth-keys.ts";

export const REDACTED = "[redacted]";
/** Shorter values are too likely to be ordinary words or numbers. */
const MIN_SECRET_LENGTH = 8;
const SECRET_NAME = /(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

/** Every credential-like value in `env`, longest first so overlapping values redact fully. */
export function secretValues(env: Record<string, string | undefined>): string[] {
	const values = new Set<string>();
	for (const [name, value] of Object.entries(env)) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length < MIN_SECRET_LENGTH) continue;
		if (AUTH_PROVIDER_ENV_VARS.has(name) || name === CUSTOM_PROVIDER.envVar || SECRET_NAME.test(name)) values.add(trimmed);
	}
	return [...values].sort((a, b) => b.length - a.length);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) if (out.includes(secret)) out = out.split(secret).join(REDACTED);
	return out;
}

/** Redacts strings inside plain JSON-shaped values; other objects pass through untouched. */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
	if (secrets.length === 0) return value;
	if (typeof value === "string") return redactSecrets(value, secrets) as T;
	if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets)) as T;
	if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, secrets)])) as T;
	}
	return value;
}
