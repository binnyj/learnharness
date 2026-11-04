// Shared by verification and visible demos. No remote dependencies or connections.
export const DEMO_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function restrictDemoHtml(html: string): string {
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}">` + html;
}
export function demoEnvelope(html: string): string {
 const escaped = restrictDemoHtml(html).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${DEMO_CSP.replace("frame-src 'none'", "frame-src about:")}"><iframe sandbox="allow-scripts" style="border:0;width:100vw;height:100vh" srcdoc="${escaped}"></iframe>`;
}
