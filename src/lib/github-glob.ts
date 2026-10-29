// Which files in a GitHub artifact hold the results (ver_85). A pattern without a
// slash matches the file's own name in any folder ("*.xml"); one with a slash
// matches the whole path ("reports/**/*.xml"). Several patterns: comma separated.

function toRegex(pattern: string) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      // "**/" is any number of folders, including none.
      if (pattern[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i++;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

export function globMatch(glob: string, path: string) {
  const patterns = glob
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const name = path.split("/").pop() ?? path;
  return (patterns.length ? patterns : ["*.xml"]).some((p) => toRegex(p).test(p.includes("/") ? path : name));
}
