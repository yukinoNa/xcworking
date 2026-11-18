import express from "express";
import multer from "multer";
import XLSX from "xlsx";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const SCHEDULE_JSON = path.join(DATA_DIR, "schedule.json");
const SCHEDULE_XLSX = path.join(DATA_DIR, "schedule.xlsx");
const CYCLES_FILE = path.join(DATA_DIR, "cycles.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const PORT = Number(process.env.PORT) || 5173;

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

/* 内部看板口令：环境变量优先，否则自动生成并存入 data/admin-key.txt */
const KEY_FILE = path.join(DATA_DIR, "admin-key.txt");
const ADMIN_KEY = (() => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, "utf8").trim();
  const key = crypto.randomBytes(3).toString("hex").toUpperCase();
  fs.writeFileSync(KEY_FILE, key, "utf8");
  return key;
})();

function requireAdmin(req, res, next) {
  const given = req.get("x-admin-key") || "";
  if (given && given === ADMIN_KEY) return next();
  res.status(401).json({ error: "需要管理口令" });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

/* ---------- 订单数据层 ---------- */

async function readOrders() {
  try {
    const list = JSON.parse(await fsp.readFile(ORDERS_FILE, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeOrders(list) {
  const tmp = ORDERS_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fsp.rename(tmp, ORDERS_FILE);
}

function newOrderId(list) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const today = list.filter((o) => String(o.id).startsWith(ymd)).length;
  return `${ymd}-${String(today + 1).padStart(2, "0")}`;
}

/* ---------- 排期表：系统自己的数据（含起止日期） ---------- */

async function readScheduleItems() {
  try {
    const data = JSON.parse(await fsp.readFile(SCHEDULE_JSON, "utf8"));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function writeScheduleItems(items) {
  const tmp = SCHEDULE_JSON + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify({ items }, null, 2), "utf8");
  await fsp.rename(tmp, SCHEDULE_JSON);
}

const LEGACY_COLUMNS = { 日期: "date", 项目: "title", 类型: "type", 负责人: "owner", 需求方: "client", 状态: "status", 备注: "note" };

/* 首次运行把旧的 schedule.xlsx 导进来；之后一律以 schedule.json 为准 */
function sampleSchedule() {
  const d = (offset) => {
    const t = new Date();
    t.setDate(t.getDate() + offset);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  };
  return [
    { id: "S001", title: "校运会开幕式跟拍", type: "摄影", owner: "王同学", client: "体育部", status: "制作中", start: d(1), end: d(2), note: "需带补光灯", source: "manual" },
    { id: "S002", title: "迎新晚会主视觉设计", type: "设计", owner: "陈同学", client: "学生会", status: "制作中", start: d(3), end: d(9), note: "含海报、背景板", source: "manual" },
    { id: "S003", title: "公众号推文 · 校园秋景", type: "推文", owner: "李同学", client: "校办", status: "已交付", start: d(-4), end: d(-4), note: "配图 3 张", source: "manual" },
    { id: "S004", title: "社团招新海报", type: "绘画", owner: "张同学", client: "社团联合会", status: "待接单", start: d(6), end: d(11), note: "", source: "manual" },
  ];
}

async function importLegacyXlsxOnce() {
  if (fs.existsSync(SCHEDULE_JSON)) return;
  if (!fs.existsSync(SCHEDULE_XLSX)) {
    await writeScheduleItems(sampleSchedule());
    return;
  }
  try {
    const wb = XLSX.readFile(SCHEDULE_XLSX, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    const items = raw
      .map((r) => {
        const row = {};
        for (const [zh, key] of Object.entries(LEGACY_COLUMNS)) row[key] = String(r[zh] ?? "").trim();
        return row;
      })
      .filter((r) => r.date || r.title)
      .map((r, i) => ({
        id: "S" + String(i + 1).padStart(3, "0"),
        title: r.title,
        type: r.type,
        owner: r.owner,
        client: r.client,
        status: r.status || "待接单",
        start: r.date,
        end: r.date,
        note: r.note,
        source: "import",
      }));
    await writeScheduleItems(items);
    console.log(`  已从 schedule.xlsx 导入 ${items.length} 条排期（原文件保留作备份，之后不再读取）`);
  } catch (err) {
    console.log("  导入 schedule.xlsx 失败：" + err.message);
    await writeScheduleItems([]);
  }
}

function newScheduleId(items) {
  let max = 0;
  for (const i of items) {
    const m = /^S(\d+)$/.exec(String(i.id || ""));
    if (m) max = Math.max(max, +m[1]);
  }
  return "S" + String(max + 1).padStart(3, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* 接单 ↔ 排期联动：制作中/已交付 的单自动出现在排期表，退回或拒接则移除 */
const ACTIVE_ORDER_STATUSES = ["制作中", "已交付"];

async function syncOrderToSchedule(order) {
  const items = await readScheduleItems();
  const idx = items.findIndex((i) => i.orderId === order.id);
  const shouldExist = ACTIVE_ORDER_STATUSES.includes(order.status);

  if (shouldExist && idx === -1) {
    const today = todayStr();
    const end = order.deadline && order.deadline >= today ? order.deadline : today;
    items.push({
      id: newScheduleId(items),
      orderId: order.id,
      title: order.title,
      type: order.type,
      owner: "",
      client: order.company || order.requester || "",
      status: order.status,
      start: today,
      end,
      note: order.urgent ? "加急" : "",
      source: "order",
      channel: order.channel,
    });
    await writeScheduleItems(items);
    return;
  }

  if (!shouldExist && idx !== -1) {
    items.splice(idx, 1);
    await writeScheduleItems(items);
    return;
  }

  if (shouldExist && idx !== -1) {
    items[idx].status = order.status;
    if (order.deadline) items[idx].end = order.deadline;
    if (items[idx].end < items[idx].start) items[idx].end = items[idx].start;
    await writeScheduleItems(items);
  }
}

/* ---------- 制作周期 ---------- */

function readCycles() {
  try {
    return JSON.parse(fs.readFileSync(CYCLES_FILE, "utf8"));
  } catch {
    return { items: [] };
  }
}

function isUrgent(type, deadline) {
  if (!deadline) return false;
  const item = readCycles().items.find((i) => i.type === type);
  if (!item || !item.days) return false;
  const target = new Date(deadline + "T23:59:59");
  if (isNaN(target.getTime())) return false;
  return (target.getTime() - Date.now()) / 86400000 < item.days;
}

/* ---------- 素材上传 ---------- */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
});

/* ---------- API ---------- */

app.get("/api/schedule", async (_req, res) => {
  try {
    const items = await readScheduleItems();
    const updatedAt = fs.existsSync(SCHEDULE_JSON) ? fs.statSync(SCHEDULE_JSON).mtimeMs : null;
    res.json({ items, updatedAt });
  } catch (err) {
    res.status(500).json({ error: "读取排期表失败：" + err.message });
  }
});

const SCHEDULE_STATUSES = ["待接单", "制作中", "已交付"];

app.post("/api/schedule", requireAdmin, async (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim();
  const start = String(b.start ?? "").trim();
  if (!title || !start) return res.status(400).json({ error: "请填写项目名称和开始日期。" });
  const status = String(b.status ?? "待接单").trim();
  if (!SCHEDULE_STATUSES.includes(status)) return res.status(400).json({ error: "状态不合法。" });
  const items = await readScheduleItems();
  const item = {
    id: newScheduleId(items),
    title,
    type: String(b.type ?? "").trim(),
    owner: String(b.owner ?? "").trim(),
    client: String(b.client ?? "").trim(),
    status,
    start,
    end: String(b.end ?? "").trim() || start,
    note: String(b.note ?? "").trim(),
    source: "manual",
  };
  items.push(item);
  await writeScheduleItems(items);
  res.status(201).json({ item });
});

app.patch("/api/schedule/:id", requireAdmin, async (req, res) => {
  const items = await readScheduleItems();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "找不到该排期。" });
  const b = req.body ?? {};
  if (b.status !== undefined && !SCHEDULE_STATUSES.includes(String(b.status))) {
    return res.status(400).json({ error: "状态不合法。" });
  }
  for (const k of ["title", "type", "owner", "client", "status", "start", "end", "note"]) {
    if (b[k] !== undefined) item[k] = String(b[k]).trim();
  }
  if (!item.end) item.end = item.start;
  if (item.end < item.start) item.end = item.start;
  await writeScheduleItems(items);
  res.json({ item });
});

app.delete("/api/schedule/:id", requireAdmin, async (req, res) => {
  const items = await readScheduleItems();
  const next = items.filter((i) => i.id !== req.params.id);
  if (next.length === items.length) return res.status(404).json({ error: "找不到该排期。" });
  await writeScheduleItems(next);
  res.json({ ok: true });
});

app.get("/api/cycles", (_req, res) => {
  res.json(readCycles());
});

app.get("/api/orders", requireAdmin, async (_req, res) => {
  const list = await readOrders();
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ orders: list });
});

const CHANNELS = ["campus", "business"];

app.post("/api/orders", upload.array("files", 6), async (req, res) => {
  const body = req.body ?? {};
  const channel = String(body.channel ?? "").trim();
  const title = String(body.title ?? "").trim();
  const requester = String(body.requester ?? "").trim();
  if (!CHANNELS.includes(channel)) {
    return res.status(400).json({ error: "未知的提交渠道。" });
  }
  if (!title || !requester) {
    return res.status(400).json({
      error: channel === "business" ? "请填写客户名称和需求标题。" : "请填写需求标题和您的姓名/部门。",
    });
  }
  const type = String(body.type ?? "").trim();
  const deadline = String(body.deadline ?? "").trim();
  const list = await readOrders();
  const order = {
    id: newOrderId(list),
    channel,
    createdAt: new Date().toISOString(),
    status: "待接单",
    type,
    title,
    requester,
    contact: String(body.contact ?? "").trim(),
    deadline,
    description: String(body.description ?? "").trim(),
    urgent: isUrgent(type, deadline),
    files: (req.files ?? []).map((f) => ({
      name: Buffer.from(f.originalname, "latin1").toString("utf8"),
      size: f.size,
      url: "/uploads/" + f.filename,
    })),
    note: "",
  };
  for (const key of ["company", "budget", "location", "invoice"]) {
    const v = String(body[key] ?? "").trim();
    if (v) order[key] = v;
  }
  list.push(order);
  await writeOrders(list);
  res.status(201).json({ order });
});

const STATUSES = ["待接单", "制作中", "已交付", "已拒绝"];

app.patch("/api/orders/:id", requireAdmin, async (req, res) => {
  const list = await readOrders();
  const order = list.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "找不到该订单。" });
  const { status, note, rejectReason } = req.body ?? {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "状态不合法。" });
    order.status = status;
    await syncOrderToSchedule(order);
  }
  if (note !== undefined) order.note = String(note);
  if (rejectReason !== undefined) order.rejectReason = String(rejectReason).slice(0, 300);
  await writeOrders(list);
  res.json({ order });
});

app.delete("/api/orders/:id", requireAdmin, async (req, res) => {
  const list = await readOrders();
  const next = list.filter((o) => o.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: "找不到该订单。" });
  await writeOrders(next);
  const items = await readScheduleItems();
  const kept = items.filter((i) => i.orderId !== req.params.id);
  if (kept.length !== items.length) await writeScheduleItems(kept);
  res.json({ ok: true });
});

/* ---------- 静态资源 ---------- */

app.use("/uploads", express.static(UPLOAD_DIR, { index: false }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------- 错误处理 ---------- */

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "单个文件不能超过 25MB。" : "上传失败：" + err.code;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: "服务器出错：" + err.message });
});

await importLegacyXlsxOnce();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`
  宣传部工作台已启动
  本机访问:  http://localhost:${PORT}`);
  console.log(`  局域网访问: http://<本机IP>:${PORT}   (其他部门的同学用这个)
`);
  console.log(`  排期表数据: data/schedule.json  (在网页「排期管理」里增删改)`);
  console.log(`  约稿订单:   data/orders.json`);
  console.log(`  顾客素材:   uploads/`);
  console.log(`\n  内部看板口令: ${ADMIN_KEY}`);
  console.log(`  (保存在 data/admin-key.txt；想固定它就用环境变量 ADMIN_PASSWORD 启动)\n`);
});
