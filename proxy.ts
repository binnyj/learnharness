import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized } from "./src/server/desktop-access.ts";
import { localSessionAuthorized, sameSecret, trustedLocalRequest } from "./src/server/local-access.ts";

export function proxy(request: NextRequest) {
 const desktop = process.env.LH_DESKTOP_SERVER === "1" || !!process.env.LH_DESKTOP_API_SECRET;
 const bootstrap = request.nextUrl.pathname === "/api/local-session" && request.method === "POST";
 const api = request.nextUrl.pathname.startsWith("/api/");
 const allowed = desktop ? (api ? desktopAPIAuthorized(request.headers) : sameSecret(request.cookies.get("lh_desktop_session")?.value, process.env.LH_DESKTOP_API_SECRET))
  : bootstrap ? trustedLocalRequest(request) && sameSecret(request.headers.get("x-learnharness-login"), process.env.LH_WEB_API_SECRET)
  : localSessionAuthorized(request);
 if (!allowed) return NextResponse.json({ error: "Access denied. Open the private sign-in link printed by npm run dev, or use the trusted desktop window." }, { status: 403, headers: { "Cache-Control": "no-store" } });
 const response = NextResponse.next();
 // frame-src 'none' stops a running demo iframe from navigating itself to a
 // local or remote URL (srcdoc demos are unaffected). Verified in Chrome.
 response.headers.set("Content-Security-Policy", "frame-ancestors 'none'; frame-src 'none'");
 response.headers.set("Cache-Control", "no-store");
 return response;
}
export const config = { matcher: ["/api/:path*", "/", "/chat/:path*", "/settings/:path*"] };
