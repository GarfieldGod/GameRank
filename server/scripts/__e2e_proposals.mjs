import "dotenv/config";
import jwt from "jsonwebtoken";
import prisma from "../src/prismaClient.js";

const BASE = "http://localhost:3000/api";
const SECRET = process.env.JWT_SECRET;

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const tokenFor = (u) => jwt.sign({ userId: u.id, username: u.username, role: u.role }, SECRET, { expiresIn: "1h" });

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗ FAIL:", label); }
}

const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
const user = await prisma.user.findFirst({ where: { role: "USER" } });
if (!owner || !user) { console.log("缺少测试账号"); process.exit(1); }
const OWNER = tokenFor(owner);
const USER = tokenFor(user);
console.log(`owner=${owner.username}(role=${owner.role}) user=${user.username}`);

const stamp = Date.now();
const nameAdd = `__测试新增${stamp}`;
const nameAddEdited = `__测试新增已编辑${stamp}`;
const targetGame = await prisma.game.findFirst({ where: { status: "APPROVED" } });
if (!targetGame) { console.log("无已通过游戏可作编辑目标"); process.exit(1); }
const targetId = targetGame.id;
const targetName = targetGame.nameZh;

// ---- 1. 新增游戏（普通用户）----
console.log("[新增流程]");
let r = await api("POST", "/games", USER, { nameZh: nameAdd, nameEn: "zzz", description: "e2e", tags: ["测试"] });
check("用户新增游戏 -> 201 且 POST success", r.status === 201 && r.data.proposalKind === "ADD");
const addGameId = r.data?.id;

r = await api("GET", "/games", undefined);
const anonHasAdd = (r.data || []).some((g) => g.id === addGameId);
check("匿名列表不含待审游戏", r.status === 200 && !anonHasAdd);

r = await api("GET", "/games", USER);
const mineHasAdd = (r.data || []).some((g) => g.id === addGameId);
check("本人列表含待审游戏", mineHasAdd);

r = await api("GET", `/games/${addGameId}`);
check("匿名进待审详情 -> 404", r.status === 404);
r = await api("GET", `/games/${addGameId}`, USER);
check("本人进待审详情 -> 200", r.status === 200 && r.data.game.status === "PENDING");

r = await api("GET", "/proposals/mine", USER);
const myAdd = (r.data || []).find((p) => p.kind === "ADD" && p.gameId === addGameId);
check("我的事务显示该新增申请(审核中)", Boolean(myAdd) && myAdd.status === "PENDING");

r = await api("GET", "/proposals", USER);
check("普通用户访问待审列表 -> 403", r.status === 403);

// ---- 2. 普通用户申请编辑既有游戏 ----
console.log("[编辑流程]");
r = await api("POST", `/games/${targetId}/edit-proposal`, USER, { nameZh: targetName, description: "e2e-edit", reason: "改正简介" });
const editPropId = r.data?.id;
check("用户申请编辑 -> 201", r.status === 201 && r.data.kind === "EDIT");
r = await api("POST", `/games/${targetId}/edit-proposal`, USER, { nameZh: targetName });
check("重复编辑申请 -> 409", r.status === 409);

r = await api("GET", `/games/${targetId}`, USER);
check("详情返回 myPendingEdit=true", r.data?.myPendingEdit === true);

// ---- 3. 用户无权审批 ----
r = await api("POST", `/proposals/${myAdd.id}/approve`, USER);
check("用户审批新增 -> 403", r.status === 403);
r = await api("POST", `/proposals/${editPropId}/approve`, USER);
check("用户审批编辑 -> 403", r.status === 403);

// ---- 4. 站长审批 ----
console.log("[站长审批]");
r = await api("GET", "/proposals", OWNER);
check("站长可见待审列表", r.status === 200 && Array.isArray(r.data) && r.data.length >= 2);
const pendingAdd = (r.data || []).find((p) => p.kind === "ADD" && p.gameId === addGameId);
const pendingEdit = (r.data || []).find((p) => p.id === editPropId);

r = await api("POST", `/proposals/${pendingAdd.id}/approve`, OWNER);
check("站长通过新增 -> 200", r.status === 200 && r.data.status === "APPROVED");
r = await api("GET", "/games", undefined);
check("审批后匿名列表可见该游戏", (r.data || []).some((g) => g.id === addGameId));
r = await api("GET", `/games/${addGameId}`);
check("审批后详情公开可访问", r.status === 200);

r = await api("POST", `/proposals/${pendingEdit.id}/approve`, OWNER);
check("站长通过编辑 -> 200", r.status === 200 && r.data.status === "APPROVED");
const updatedGame = await prisma.game.findUnique({ where: { id: targetId } });
check("编辑申请生效(简介已改)", updatedGame.description === "e2e-edit");

// ---- 5. 拒绝新增 ----
console.log("[拒绝流程]");
r = await api("POST", "/games", USER, { nameZh: `${nameAdd}被拒`, nameEn: "zzz2" });
const add2Id = r.data?.id;
r = await api("GET", "/proposals", OWNER);
const pendingAdd2 = (r.data || []).find((p) => p.kind === "ADD" && p.gameId === add2Id);
r = await api("POST", `/proposals/${pendingAdd2.id}/reject`, OWNER, { reason: "重复资料" });
check("站长拒绝新增 -> 200", r.status === 200 && r.data.status === "REJECTED");
const gone = await prisma.game.findUnique({ where: { id: add2Id } });
check("被拒新增游戏已删除", !gone);
r = await api("GET", "/proposals/mine", USER);
const myRejected = (r.data || []).find((p) => p.id === pendingAdd2.id);
check("我的事务显示被拒绝+原因", Boolean(myRejected) && myRejected.status === "REJECTED" && myRejected.rejectReason === "重复资料");

// ---- 6. 拒绝编辑（游戏保持原样）----
r = await api("POST", `/games/${targetId}/edit-proposal`, USER, { nameZh: targetName, description: "不应生效", reason: "xx" });
const edit2Id = r.data?.id;
r = await api("GET", "/proposals", OWNER);
const pendingEdit2 = (r.data || []).find((p) => p.id === edit2Id);
r = await api("POST", `/proposals/${pendingEdit2.id}/reject`, OWNER, { reason: "改动过多" });
check("站长拒绝编辑 -> 200", r.status === 200 && r.data.status === "REJECTED");
const afterReject = await prisma.game.findUnique({ where: { id: targetId } });
check("被拒编辑不生效", afterReject.description === "e2e-edit");

// ---- 清理 ----
await prisma.game.delete({ where: { id: addGameId } }); // 已审批的测试游戏删除
await prisma.game.update({ where: { id: targetId }, data: { description: targetGame.description } }); // 还原目标游戏
await prisma.gameProposal.deleteMany({ where: { data: { contains: stamp + "" } } });
console.log("已清理测试数据");

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);