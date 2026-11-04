import { BroadFolderError, learningFolders, saveLearningFolders } from "@/src/server";
export async function GET() { return Response.json({ folders: learningFolders() }); }
export async function PUT(req: Request) {
 try { const body = await req.json(); return Response.json({ folders: saveLearningFolders(body.folders, body.confirmBroad === true) }); }
 catch (error) {
  if (error instanceof BroadFolderError) return Response.json({ error: error.message, code: "broad_folder", broad: error.folders }, { status: 409 });
  return Response.json({ error: "Use existing absolute folder paths (one per line)." }, { status: 400 });
 }
}
