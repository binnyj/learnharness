import { timingSafeEqual } from "node:crypto";
export const LOCAL_COOKIE = "lh_local_session";
export function sameSecret(actual: string | null | undefined, expected: string | undefined): boolean {
 if (!expected || expected.length < 64 || !actual) return false;
 const a = Buffer.from(actual), b = Buffer.from(expected);
 return a.length === b.length && timingSafeEqual(a, b);
}
export function trustedLocalRequest(req: Request, env: Record<string, string | undefined> = process.env): boolean {
 const expected = env.LH_WEB_ORIGIN;
 if (!expected) return false;
 try {
  const origin = new URL(expected);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") return false;
  const target = new URL(req.url);
  // Next dev normalizes the internal URL to localhost; the validated Host
  // remains the externally requested authority. Never trust forwarded headers.
  if (req.headers.get("host") !== origin.host || target.protocol !== origin.protocol || target.port !== origin.port || !["127.0.0.1", "localhost"].includes(target.hostname)) return false;
  if (req.headers.has("origin") && req.headers.get("origin") !== expected) return false;
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
 } catch { return false; }
}
export function localSessionAuthorized(req: Request, env: Record<string, string | undefined> = process.env): boolean {
 if (!trustedLocalRequest(req, env)) return false;
 const cookie = req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${LOCAL_COOKIE}=`))?.slice(LOCAL_COOKIE.length + 1);
 return sameSecret(cookie, env.LH_WEB_API_SECRET);
}
