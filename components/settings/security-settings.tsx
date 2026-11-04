"use client";
import { useEffect, useState } from "react";
export function SecuritySettings() {
 const [folders, setFolders] = useState(""); const [status, setStatus] = useState(""); const [ready, setReady] = useState(false);
 // Broad folders the server refused; non-null turns Save into "Save anyway" until the text changes.
 const [broad, setBroad] = useState<string[] | null>(null);
 useEffect(() => { void fetch("/api/security/folders").then(async r => { if (!r.ok) throw new Error(); const v = await r.json(); setFolders(v.folders.join("\n")); setReady(true); }).catch(() => setStatus("Could not load folder permissions.")); }, []);
 async function save() {
  const confirmBroad = broad !== null;
  setReady(false); setStatus("Saving folder permissions…");
  try {
   const r = await fetch("/api/security/folders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folders: folders.split("\n").map(p => p.trim()).filter(Boolean), confirmBroad }) });
   const v = await r.json();
   if (r.status === 409 && v.code === "broad_folder") { setBroad(v.broad); setStatus(""); return; }
   if (!r.ok) throw new Error(v.error);
   setBroad(null); setFolders(v.folders.join("\n")); setStatus("Folder permissions saved.");
  }
  catch (e) { setStatus(e instanceof Error ? e.message : "Save failed."); } finally { setReady(true); }
 }
 return <section className="space-y-2 py-4">
  <h3 className="font-medium">Learning folder access</h3>
  <p className="text-sm text-muted-foreground">The tutor can only read approved folders. Leave this empty to disable file access. Credential and application-data locations remain blocked.</p>
  <label className="block text-sm" htmlFor="learning-folders">Absolute folder paths, one per line</label>
  <textarea disabled={!ready} id="learning-folders" className="w-full rounded border bg-background p-2 text-sm" rows={3} value={folders} onChange={e => { setFolders(e.target.value); setBroad(null); }} />
  {broad && <p role="alert" className="text-sm text-destructive">{`Warning: ${broad.join(", ")} ${broad.length === 1 ? "is a very broad folder" : "are very broad folders"}. The tutor could read almost any file inside, including private documents. Prefer a dedicated study folder such as ~/Documents/learning. Press Save anyway to approve it.`}</p>}
  <button type="button" disabled={!ready} onClick={() => void save()} className="rounded border px-3 py-2 disabled:opacity-50">{broad ? "Save anyway" : "Save folder permissions"}</button>
  <p role="status" className="text-sm">{status}</p>
 </section>;
}
