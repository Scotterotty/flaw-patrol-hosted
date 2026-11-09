// Copies a new version of the hidden game into public/delve-game, so a game update drops in
// without touching Flaw Patrol's own code:
//
//   node scripts/delve-sync.mjs <folder with the game's index.html, sp/ and t/>
//
// The game file stays as it is apart from four small, checked edits:
//   1. three.js and the two fonts load from this folder instead of a CDN or Google Fonts;
//   2. fp-delve.js loads before the game, so saves go to the person's account;
//   3. its three storage calls use that account save instead of the browser's localStorage;
//   4. one line before window.__delve hands fp-delve.js the game's own functions to wrap.
// Every Flaw Patrol part of the game (Pick a dungeon, Practice, run dungeons, Your bugs) lives in
// public/delve-game/fp-delve.js. The edit fails loudly if the game changed where it hooks in.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "delve-game");
const from = process.argv[2];
if (!from || !existsSync(join(from, "index.html"))) {
  console.error("Usage: node scripts/delve-sync.mjs <folder with index.html, sp/ and t/>");
  process.exit(1);
}

/** The game's own names that fp-delve.js may read and replace. */
const NAMES = [
  "G", "meta", "slots", "over", "wantDaily", "SCREENS", "MON", "BOSS", "REDUCE", "HEROES",
  "KM", "KR", "load", "save", "drop", "el", "show", "say", "esc", "S", "toast",
  "newRun", "nextFloor", "die", "killMon", "bossCard", "renderLog", "renderTitle", "openLoad",
  "switchSlot", "loadMeta", "saveSlots", "persist", "hashStr", "curSlot", "render", "beginRun",
];

let html = readFileSync(join(from, "index.html"), "utf8");
const swap = (what, from_, to) => {
  if (!html.includes(from_)) throw new Error(`The game changed: couldn't find ${what}. Update scripts/delve-sync.mjs.`);
  html = html.split(from_).join(to);
};

swap("the three.js script", '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script src="three.min.js"></script>\n<script src="fp-delve.js"></script>');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/, '<link rel="stylesheet" href="fonts/fonts.css">');
if (html.includes("fonts.googleapis.com")) throw new Error("The game changed how it loads fonts. Update scripts/delve-sync.mjs.");
swap("the storage calls", "localStorage.", "DELVE_STORE.");
if ((html.match(/DELVE_STORE\./g) ?? []).length !== 3) throw new Error("The game now uses storage in more places. Check each one before syncing.");
const hook = `window.__fpDelveHook&&window.__fpDelveHook({${NAMES.map((n) => `get ${n}(){return ${n};},set ${n}(v){${n}=v;}`).join(",")}});\n`;
swap("window.__delve", "\nwindow.__delve={", `\n${hook}window.__delve={`);
html = html.replace("<title>The Delve Pocket</title>", "<title>The Delve</title>");

for (const dir of ["sp", "t"]) {
  rmSync(join(out, dir), { recursive: true, force: true });
  cpSync(join(from, dir), join(out, dir), { recursive: true, filter: (p) => !p.endsWith(".png") });
}
writeFileSync(join(out, "index.html"), html);

// three.js r128 (the version the game is written for) and the two fonts, so nothing loads from outside.
const req = createRequire(join(root, "package.json"));
const three = join(from, "three.min.js");
if (existsSync(three)) cpSync(three, join(out, "three.min.js"));
if (!existsSync(join(out, "three.min.js"))) console.warn("! Put three.js r128's build/three.min.js in public/delve-game (npm pack three@0.128.0).");
mkdirSync(join(out, "fonts"), { recursive: true });
const font = (pkg, file) => cpSync(join(dirname(req.resolve(`${pkg}/package.json`)), "files", file), join(out, "fonts", file));
font("@fontsource/press-start-2p", "press-start-2p-latin-400-normal.woff2");
for (const w of [400, 600, 700]) font("@fontsource/inter", `inter-latin-${w}-normal.woff2`);
writeFileSync(
  join(out, "fonts", "fonts.css"),
  `@font-face{font-family:"Press Start 2P";font-weight:400;font-display:swap;src:url(press-start-2p-latin-400-normal.woff2) format("woff2")}\n` +
    [400, 600, 700].map((w) => `@font-face{font-family:Inter;font-weight:${w};font-display:swap;src:url(inter-latin-${w}-normal.woff2) format("woff2")}`).join("\n") +
    "\n",
);
console.log(`Game copied into public/delve-game (${NAMES.length} hooks).`);
