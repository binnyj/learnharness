import { setTestKey } from "../../electron/secure-json.cjs";
setTestKey(Buffer.alloc(32, 7));
