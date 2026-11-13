import { tmpdir } from "node:os";
import { join } from "node:path";

/** The folder the test server shares with the update helper (ver_239); ver239.spec.ts plays the helper. */
export const SERVER_UPDATE_DIR = join(tmpdir(), "flaw-patrol-e2e-server-update");
