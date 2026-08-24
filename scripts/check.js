import { readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { spawnSync } from "node:child_process";

const roots = [
  "server.js",
  "src",
  "public"
];

function findJavaScript(path) {
  if (extname(path) === ".js") {
    return [path];
  }

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);

    if (entry.isDirectory()) {
      return findJavaScript(child);
    }

    return extname(entry.name) === ".js" ? [child] : [];
  });
}

const files = roots.flatMap(findJavaScript);

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Checked ${files.length} JavaScript files.`);