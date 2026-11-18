import fs from "node:fs";

const BASE = "http://localhost:5173";
const KEY = fs.readFileSync("data/admin-key.txt", "utf8").trim();
const auth = { "x-admin-key": KEY };
let pass = 0, fail = 0;
const created = [];

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}
const dayStr = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function submit(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, content] of files) fd.append("files", new Blob([content]), name);
  const r = await fetch(BASE + "/api/orders", { method: "POST", body: fd });
  const j = await r.json();
  if (j.order) created.push(j.order.id);
  return { status: r.status, json: j };
}

console.log("\n[1] 公开数据接口");
const sch = await fetch(BASE + "/api/schedule").then(r => r.json());
check("排期返回 items", Array.isArray(sch.items) && sch.items.length > 0, "items=" + sch.items?.length);
check("排期项含起止日期", sch.items.every(i => "start" in i && "end" in i));
const cyc = await fetch(BASE + "/api/cycles").then(r => r.json());
check("周期配置可读", Array.isArray(cyc.items) && cyc.items.length > 0, JSON.stringify(cyc).slice(0, 120));
check("周期含推文 1 周", cyc.items.some(i => i.type === "推文" && i.days === 7));
check("周期含设计 1–2 周", cyc.items.some(i => i.type === "设计" && i.days === 10));
check("摄影为次日返图", cyc.items.some(i => i.type === "摄影" && i.days === 1 && i.text === "次日返图"));
check("剪辑为 1 周内", cyc.items.some(i => i.type === "视频" && i.days === 7));
check("包含 AI 绘图", cyc.items.some(i => i.type === "AI绘图"));
check("AI 绘图暂标商谈（未编造工期）", cyc.items.find(i => i.type === "AI绘图")?.days === null);
check("已定工期的类型均有效", cyc.items.filter(i => i.days !== null).every(i => typeof i.days === "number" && i.days > 0));

console.log("\n[2] 页面可访问");
for (const p of ["/", "/order.html", "/apply-campus.html", "/apply-business.html", "/admin.html", "/apply.js", "/styles.css"]) {
  const r = await fetch(BASE + p);
  check(p + " → 200", r.status === 200, "status=" + r.status);
}

console.log("\n[3] 看板鉴权");
check("无口令 → 401", (await fetch(BASE + "/api/orders")).status === 401);
check("错口令 → 401", (await fetch(BASE + "/api/orders", { headers: { "x-admin-key": "WRONG" } })).status === 401);
check("正确口令 → 200", (await fetch(BASE + "/api/orders", { headers: auth })).status === 200);

console.log("\n[4] 渠道校验");
const noChan = await submit({ title: "x", requester: "y" });
check("缺 channel → 400", noChan.status === 400, "status=" + noChan.status);
const badChan = await submit({ channel: "ghost", title: "x", requester: "y" });
check("非法 channel → 400", badChan.status === 400, "status=" + badChan.status);

console.log("\n[5] 校内单");
const campus = await submit(
  { channel: "campus", type: "推文", title: "开学季推文", requester: "学生会", contact: "微信 abc", deadline: dayStr(30), description: "需要一篇迎新推文" },
  [["参考说明 文档.txt", "测试素材内容"]]
);
check("创建 201", campus.status === 201, "status=" + campus.status);
check("渠道记为 campus", campus.json.order?.channel === "campus", campus.json.order?.channel);
check("中文文件名未乱码", campus.json.order?.files?.[0]?.name === "参考说明 文档.txt", JSON.stringify(campus.json.order?.files?.map(f => f.name)));
check("周期充裕时不标加急", campus.json.order?.urgent === false, String(campus.json.order?.urgent));

console.log("\n[6] 商业单");
const biz = await submit({
  channel: "business", type: "摄影", title: "婚礼跟拍", requester: "李先生", company: "某婚庆公司",
  contact: "138xxxx", location: "市区", budget: "2000-3000 元", invoice: "需要发票",
  deadline: dayStr(45), description: "全天跟拍",
});
check("创建 201", biz.status === 201, "status=" + biz.status);
check("渠道记为 business", biz.json.order?.channel === "business");
check("客户名称保存", biz.json.order?.company === "某婚庆公司", biz.json.order?.company);
check("预算保存", biz.json.order?.budget === "2000-3000 元", biz.json.order?.budget);
check("地点保存", biz.json.order?.location === "市区");
check("票据需求保存", biz.json.order?.invoice === "需要发票");
check("校内单不串入预算字段", campus.json.order?.budget === undefined);

console.log("\n[7] 自动加急判定");
const tight = await submit({ channel: "campus", type: "设计", title: "急用海报", requester: "某部门", deadline: dayStr(2), description: "明天要" });
check("设计 + 2 天 → 加急", tight.json.order?.urgent === true, String(tight.json.order?.urgent));
const loose = await submit({ channel: "campus", type: "设计", title: "不急海报", requester: "某部门", deadline: dayStr(60), description: "慢慢做" });
check("设计 + 60 天 → 不加急", loose.json.order?.urgent === false, String(loose.json.order?.urgent));
const nextDay = await submit({ channel: "business", type: "摄影", title: "跟拍", requester: "客户", company: "某公司", deadline: dayStr(1), description: "明天要" });
check("摄影次日交付：明天要 → 不加急", nextDay.json.order?.urgent === false, String(nextDay.json.order?.urgent));
const sameDay = await submit({ channel: "business", type: "摄影", title: "当天跟拍", requester: "客户", company: "某公司", deadline: dayStr(0), description: "今天就要" });
check("摄影当日交付：今天要 → 加急", sameDay.json.order?.urgent === true, String(sameDay.json.order?.urgent));
const noDeadline = await submit({ channel: "campus", type: "推文", title: "无期限推文", requester: "某部门", description: "没定日期" });
check("没填日期 → 不加急", noDeadline.json.order?.urgent === false, String(noDeadline.json.order?.urgent));

console.log("\n[8] 状态流转");
const p1 = await fetch(BASE + "/api/orders/" + campus.json.order.id, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ status: "制作中" }) }).then(r => r.json());
check("待接单 → 制作中", p1.order?.status === "制作中");
const bad = await fetch(BASE + "/api/orders/" + campus.json.order.id, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ status: "瞎写" }) });
check("非法状态 → 400", bad.status === 400);

console.log("\n[9] 拒接");
const rej = await fetch(BASE + "/api/orders/" + biz.json.order.id, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ status: "已拒绝", rejectReason: "排期已满，建议下月" }),
}).then(r => r.json());
check("可置为已拒绝", rej.order?.status === "已拒绝", rej.order?.status);
check("拒接原因已记录", rej.order?.rejectReason === "排期已满，建议下月", rej.order?.rejectReason);

console.log("\n[10] 接单自动进排期");
let sched = await fetch(BASE + "/api/schedule").then(r => r.json());
const linked = sched.items.find(i => i.orderId === campus.json.order.id);
check("接单后自动生成排期项", !!linked, "未找到 orderId=" + campus.json.order.id);
check("排期项带起止日期", !!(linked && linked.start && linked.end), JSON.stringify(linked));
check("排期项状态跟随订单", linked?.status === "制作中", linked?.status);
check("已拒绝的委托不进排期", !sched.items.some(i => i.orderId === biz.json.order.id));
check("待接单的委托不进排期", !sched.items.some(i => i.orderId === tight.json.order.id));

const back = await fetch(BASE + "/api/orders/" + campus.json.order.id, {
  method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ status: "待接单" }),
}).then(r => r.json());
check("退回待接单成功", back.order?.status === "待接单");
sched = await fetch(BASE + "/api/schedule").then(r => r.json());
check("退回后排期项自动移除", !sched.items.some(i => i.orderId === campus.json.order.id));

console.log("\n[10b] 排期增删改");
const made = await fetch(BASE + "/api/schedule", {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ title: "测试跨天任务", type: "设计", start: dayStr(1), end: dayStr(5), status: "制作中", owner: "测试", client: "测试" }),
}).then(r => r.json());
check("创建排期 201", !!made.item?.id, JSON.stringify(made).slice(0, 100));
check("结束日期已保存", made.item?.end === dayStr(5), made.item?.end);
check("结束早于开始会纠正", (await fetch(BASE + "/api/schedule/" + made.item.id, {
  method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ start: dayStr(9), end: dayStr(3) }),
}).then(r => r.json())).item?.end === dayStr(9));
const badSched = await fetch(BASE + "/api/schedule/" + made.item.id, {
  method: "PATCH", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ status: "瞎写" }),
});
check("非法排期状态 → 400", badSched.status === 400);
check("无口令不能建排期", (await fetch(BASE + "/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x", start: dayStr(1) }) })).status === 401);
const delSched = await fetch(BASE + "/api/schedule/" + made.item.id, { method: "DELETE", headers: auth });
check("删除排期", delSched.status === 200);
sched = await fetch(BASE + "/api/schedule").then(r => r.json());
check("已从排期移除", !sched.items.some(i => i.id === made.item.id));

console.log("\n[11] 清理");
const list = await fetch(BASE + "/api/orders", { headers: auth }).then(r => r.json());
check("订单均已入库", created.every(id => list.orders.some(o => o.id === id)), "created=" + created.length);
for (const id of created) {
  await fetch(BASE + "/api/orders/" + id, { method: "DELETE", headers: auth });
}
const after = await fetch(BASE + "/api/orders", { headers: auth }).then(r => r.json());
check("清理干净", !after.orders.some(o => created.includes(o.id)));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败\n");
process.exit(fail ? 1 : 0);
