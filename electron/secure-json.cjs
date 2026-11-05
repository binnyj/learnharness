"use strict";
// Encrypted files retain existing adapter paths. The encryption key is stored
// in macOS Keychain, never beside the ciphertext. No plaintext fallback.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
let cachedKey;
let testKey;
function setTestKey(key) {
 if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== "test") throw new Error("Test key injection is unavailable outside node:test");
 testKey = key;
}
function key() {
 // Tests pass an Error to simulate an unavailable or locked Keychain.
 if (testKey instanceof Error) throw testKey;
 if (testKey) return testKey;
 if (cachedKey) return cachedKey;
 if (process.platform !== "darwin") throw new Error("Secure credential storage requires a supported OS credential backend; this build supports macOS Keychain.");
 const service = "com.learnharness.local-credentials.v1";
 const account = `uid-${process.getuid()}`;
 function read() { return execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim(); }
 let value;
 try { value = read(); } catch (e) {
  if (e.status !== 44) throw new Error("Unlock macOS Keychain to access LearnHarness credentials.");
  const candidate = crypto.randomBytes(32).toString("hex");
  // This command carries only a random wrapping key, never provider tokens.
  // A same-user process inspecting process arguments is outside this boundary.
  try { execFileSync("/usr/bin/security", ["add-generic-password", "-s", service, "-a", account, "-w", candidate], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }); } catch { /* A competing process may have created it. Read back below. */ }
  value = read();
 }
 if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid LearnHarness Keychain record.");
 cachedKey = Buffer.from(value, "hex");
 return cachedKey;
}
function encode(text, secret = key()) {
 const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
 const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
 return JSON.stringify({ format: "learnharness-encrypted-v1", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
function decode(text, secret = key()) {
 const v = JSON.parse(text);
 if (v.format !== "learnharness-encrypted-v1") throw new Error("Invalid encrypted credential record.");
 const decipher = crypto.createDecipheriv("aes-256-gcm", secret, Buffer.from(v.iv, "base64"));
 decipher.setAuthTag(Buffer.from(v.tag, "base64"));
 return Buffer.concat([decipher.update(Buffer.from(v.data, "base64")), decipher.final()]).toString("utf8");
}
/** Windows sharing violations (a scanner or editor holding the file) are
 * retried briefly, like src/store/atomic-write.ts; credentials never fall
 * back to an in-place write. */
function renameRetrying(temporary, file) {
 const deadline = Date.now() + 1000;
 for (let delay = 5; ; delay = Math.min(delay * 2, 40)) {
  try { fs.renameSync(temporary, file); return; }
  catch (error) {
   const sharing = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(error && error.code);
   if (!sharing || Date.now() >= deadline) throw error;
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  }
 }
}
function writeSecureText(file, text) {
 JSON.parse(text);
 const encrypted = encode(text);
 const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
 const temporary = `${file}.${crypto.randomUUID()}.tmp`;
 let fd;
 try {
  fd = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(fd, encrypted); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
  // Verify the bytes actually written before replacing the existing credential.
  if (decode(fs.readFileSync(temporary, "utf8")) !== text) throw new Error("Credential verification failed.");
  renameRetrying(temporary, file);
 } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temporary); } catch {} }
}
function readSecureText(file, validate = JSON.parse) {
 const st = fs.lstatSync(file);
 if (!st.isFile() || st.nlink !== 1 || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new Error("Unsafe credential file.");
 const text = fs.readFileSync(file, "utf8"), parsed = JSON.parse(text);
 if (parsed?.format === "learnharness-encrypted-v1") return decode(text);
 validate(text);
 // Migration is atomic and only replaces plaintext after verified encryption.
 writeSecureText(file, text);
 return text;
}
module.exports = { readSecureText, writeSecureText, encode, decode, setTestKey };
