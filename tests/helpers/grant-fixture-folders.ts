import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export async function grantFixtureFolders() {
 const { SETTINGS_FILE } = await import("../../config.ts");
 if (!process.env.LH_DATA_DIR || !path.resolve(SETTINGS_FILE).startsWith(fs.realpathSync(os.tmpdir())) && !path.resolve(SETTINGS_FILE).startsWith(os.tmpdir())) throw new Error("Fixture grants require isolated temporary settings");
 fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
 let settings: Record<string, unknown> = {}; try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE,"utf8")); } catch {}
 settings.security = { learningFolders: [fs.realpathSync(os.tmpdir()), path.resolve(import.meta.dirname, "../fixtures")] };
 fs.writeFileSync(SETTINGS_FILE,JSON.stringify(settings));
}
