#!/usr/bin/env node
/* 账号管理命令行。在项目根目录执行：
 *   node scripts/user.js add <用户名> <密码> [admin|member]
 *   node scripts/user.js passwd <用户名> <新密码>
 *   node scripts/user.js disable <用户名>
 *   node scripts/user.js enable <用户名>
 *   node scripts/user.js del <用户名>
 *   node scripts/user.js list
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const readUsers = () => {
  try {
    const list = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const writeUsers = (list) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), "utf8");
};

const makeHash = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
};

const [cmd, ...args] = process.argv.slice(2);

function die(msg) {
  console.error("错误：" + msg);
  process.exit(1);
}

if (!cmd || cmd === "help" || cmd === "-h") {
  console.log(`账号管理工具

用法：
  node scripts/user.js add <用户名> <密码> [admin|member]   新建账号
  node scripts/user.js passwd <用户名> <新密码>             重置密码
  node scripts/user.js disable <用户名>                     停用账号
  node scripts/user.js enable <用户名>                      恢复账号
  node scripts/user.js del <用户名>                         删除账号
  node scripts/user.js list                                 列出所有账号

示例：
  node scripts/user.js add zhangsan MyPass2026 admin
  node scripts/user.js add lisi Lisi@2026`);
  process.exit(0);
}

const users = readUsers();

if (cmd === "list") {
  if (!users.length) {
    console.log("还没有任何账号。用 add 命令创建第一个管理员：");
    console.log("  node scripts/user.js add 你的用户名 你的密码 admin");
    process.exit(0);
  }
  console.log("用户名".padEnd(18) + "姓名".padEnd(14) + "角色".padEnd(10) + "状态".padEnd(8) + "最近登录");
  console.log("-".repeat(78));
  for (const u of users) {
    const state = u.enabled === false ? "已停用" : "正常";
    const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-CN") : "从未";
    console.log(
      String(u.username).padEnd(18) + String(u.name || "").padEnd(14) +
      String(u.role).padEnd(10) + state.padEnd(8) + last
    );
  }
  process.exit(0);
}

if (cmd === "add") {
  const [username, password, roleArg] = args;
  if (!username || !password) die("需要用户名和密码");
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) die("用户名 3-24 位，只能用字母、数字和 _ . -");
  if (password.length < 6) die("密码至少 6 位");
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) die("用户名已存在");
  const role = roleArg === "admin" ? "admin" : "member";
  const { salt, hash } = makeHash(password);
  users.push({ username, name: username, role, salt, hash, enabled: true, mustChangePassword: true, createdAt: new Date().toISOString() });
  writeUsers(users);
  console.log(`已创建账号 ${username}（${role === "admin" ? "管理员" : "成员"}）`);
  process.exit(0);
}

const target = users.find((u) => u.username === args[0]);

if (["passwd", "disable", "enable", "del"].includes(cmd)) {
  if (!args[0]) die("需要用户名");
  if (!target) die("找不到账号 " + args[0]);
}

if (cmd === "passwd") {
  const pw = args[1];
  if (!pw) die("需要新密码");
  if (pw.length < 6) die("密码至少 6 位");
  const { salt, hash } = makeHash(pw);
  target.salt = salt;
  target.hash = hash;
  target.mustChangePassword = true;
  writeUsers(users);
  console.log("已重置 " + target.username + " 的密码");
} else if (cmd === "disable") {
  target.enabled = false;
  writeUsers(users);
  console.log("已停用 " + target.username);
} else if (cmd === "enable") {
  target.enabled = true;
  writeUsers(users);
  console.log("已恢复 " + target.username);
} else if (cmd === "del") {
  const admins = users.filter((u) => u.role === "admin" && u.enabled !== false);
  if (target.role === "admin" && admins.length <= 1) die("至少要保留一个管理员");
  writeUsers(users.filter((u) => u.username !== target.username));
  console.log("已删除 " + target.username);
} else {
  die("未知命令：" + cmd);
}
