import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AUTH_FILE, PATHS, SETTINGS_FILE } from "../../../config.ts";

// Deny by default. Read each time so revocation applies to subsequent operations.
export function approvedSourceRoots(): string[] {
 try {
  const roots = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))?.security?.learningFolders;
  return Array.isArray(roots) ? roots.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)) : [];
 } catch { return []; }
}
function within(root: string, target: string): boolean {
 const rel = path.relative(root, target);
 return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
function canonical(p: string): string { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
export function protectedSourcePath(p: string): boolean {
 const parts = p.toLowerCase().split(/[\\/]/);
 if (parts.some(v => [".ssh", ".aws", ".gnupg", ".config", ".codex", ".npm", ".git", "keychains", ".kube", ".docker", ".gcloud", ".azure"].includes(v))) return true;
 const name = path.basename(p).toLowerCase();
 if (/^(\.env($|\.)|\.npmrc$|\.netrc$|\.pgpass$|auth\.json($|\.)|.*credentials.*|.*secret.*|.*token.*|service-account.*\.json$|\.[a-z0-9_]*history$|fish_history$|.*\.(pem|p12|pfx)$|id_(rsa|ed25519|ecdsa)($|\.))/.test(name)) return true;
 return [AUTH_FILE, SETTINGS_FILE, PATHS.data, path.join(os.homedir(), "Library"), path.join(os.homedir(), ".local/share/learnharness-security")]
  .some(v => within(canonical(v), p));
}
export function authorizeSourcePath(p: string, roots = approvedSourceRoots()): string {
 const requested = path.resolve(p);
 if (protectedSourcePath(requested)) throw new Error("File access denied: protected location.");
 const target = fs.realpathSync(requested);
 if (protectedSourcePath(target) || !roots.some(root => { const resolved = canonical(root); return resolved === path.resolve(root) && within(resolved, target); })) {
  throw new Error("File access denied. Approve a learning folder in Settings → General first.");
 }
 const stat = fs.statSync(target);
 if (!stat.isFile() && !stat.isDirectory()) throw new Error("File access denied: unsupported file type.");
 if (stat.isFile() && stat.size > 25 * 1024 * 1024) throw new Error("File access denied: files must be at most 25 MiB.");
 if (stat.isFile() && stat.nlink > 1) throw new Error("File access denied: hard-linked files are not supported.");
 if (stat.isFile() && path.extname(target).toLowerCase() === ".key" && pemKeyFile(target)) throw new Error("File access denied: protected location.");
 return target;
}
// Keynote decks share the .key extension; only PEM-encoded key material is blocked.
function pemKeyFile(file: string): boolean {
 let fd: number | undefined;
 try { fd = fs.openSync(file, "r"); const head = Buffer.alloc(64); const n = fs.readSync(fd, head, 0, 64, 0); return head.subarray(0, n).toString("utf8").trimStart().startsWith("-----BEGIN"); }
 catch { return true; }
 finally { if (fd !== undefined) fs.closeSync(fd); }
}
