// Runs one hostile demo through the real verifier in its own process, so the
// browser helper exits with it. Prints the DemoRunResult as JSON.
import { realHeadless } from "../../src/agent/subagents/headless.ts";
const html = process.argv[2] ?? "";
const probe = process.argv[3];
const result = await realHeadless.runDemo(html, { settleMs: 1000, ...(probe ? { probe } : {}) });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(0);
