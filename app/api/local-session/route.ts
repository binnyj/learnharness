import { LOCAL_COOKIE, sameSecret, trustedLocalRequest } from "@/src/server";
export async function POST(req: Request) {
 if (!trustedLocalRequest(req) || !sameSecret(req.headers.get("x-learnharness-login"), process.env.LH_WEB_API_SECRET)) return new Response("Forbidden", { status: 403 });
 return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": `${LOCAL_COOKIE}=${process.env.LH_WEB_API_SECRET}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` } });
}
