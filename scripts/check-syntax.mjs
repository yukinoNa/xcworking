import fs from "node:fs";
import { execFileSync } from "node:child_process";

const targets = ["public/index.html", "public/order.html", "public/admin.html", "public/apply-campus.html", "public/apply-business.html"];

for (const f of targets) {
  const html = fs.readFileSync(f, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) { console.log(f + ": no inline script"); continue; }
  let bad = false;
  for (const s of scripts) {
    fs.writeFileSync(".check.js", s);
    try { execFileSync("node", ["--check", ".check.js"], { stdio: "pipe" }); }
    catch (e) { bad = true; console.log(f + ": SYNTAX ERROR"); console.log(String(e.stderr).split("\n").slice(0, 12).join("\n")); }
  }
  if (!bad) console.log(f + ": OK");
}

fs.writeFileSync(".check.js", fs.readFileSync("public/apply.js", "utf8"));
try { execFileSync("node", ["--check", ".check.js"], { stdio: "pipe" }); console.log("public/apply.js: OK"); }
catch (e) { console.log("public/apply.js: SYNTAX ERROR"); console.log(String(e.stderr).split("\n").slice(0, 12).join("\n")); }

fs.rmSync(".check.js", { force: true });
