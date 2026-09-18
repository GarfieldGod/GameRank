import { Router } from "express";
import bcrypt from "bcryptjs";
import prisma from "../prismaClient.js";
import { jwtAuth, adminOnly } from "../middleware/auth.js";

const router = Router();

// 注册/登录见 authRoutes（/api/auth/register、/api/auth/login）

// 用户列表：GET /api/users（仅站长/管理员）
// 含全部用户的简介/角色/在线状态等资料，仅管理页需要；若公开会成为批量抓取用户隐私的接口。
router.get("/", jwtAuth, adminOnly, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar: true,
      bio: true,
      role: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  res.json(users);
});

// 编辑本人资料：PUT /api/users/me（需登录，仅本人）
// body: { avatar?, bio?, nickname?, theme? }  头像为已上传图片 URL
router.put("/me", jwtAuth, async (req, res) => {
  const { avatar, bio, nickname, theme } = req.body ?? {};

  // 头像需为本站上传路径或合法 http(s) 链接
  if (avatar !== undefined && avatar !== "") {
    const isUrl = avatar.startsWith("/uploads/") || /^https?:\/\//.test(avatar);
    if (!isUrl) {
      return res.status(400).json({ error: "头像需为图片 URL" });
    }
  }
  if (bio !== undefined && bio.length > 200) {
    return res.status(400).json({ error: "个人简介不能超过 200 字" });
  }
  if (nickname !== undefined && (nickname.trim().length < 3 || nickname.trim().length > 20)) {
    return res.status(400).json({ error: "昵称需为 3-20 个字符" });
  }
  if (nickname !== undefined) {
    const nick = nickname.trim();
    if (nick) {
      const dupe = await prisma.user.findFirst({ where: { nickname: nick, id: { not: req.userId } } });
      if (dupe) {
        return res.status(409).json({ error: "用户名已被占用" });
      }
    }
  }

  const data = {};
  if (avatar !== undefined) data.avatar = avatar || null;
  if (bio !== undefined) data.bio = bio;
  if (nickname !== undefined) data.nickname = nickname.trim() || null;
  if (theme !== undefined) data.theme = theme === "dark" ? "dark" : "light";

  const user = await prisma.user.update({
    where: { id: req.userId },
    data,
    select: { id: true, username: true, nickname: true, avatar: true, bio: true, role: true, theme: true, createdAt: true },
  });
  res.json(user);
});

// 用户详情（按用户名）：GET /api/users/by-username/:username
// URL 采用唯一的账号 username，避免在链接中暴露自增 id（创建序号）；仅本站跳转使用。
// 注意：须注册在 /:id 之前，否则 :id 会拦截该路径。
router.get("/by-username/:username", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { username: req.params.username },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar: true,
      bio: true,
      role: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }
  res.json(user);
});

// 用户详情：GET /api/users/:id（头像、简介、角色、创建时间；评测列表用 /api/reviews?authorId= 分页获取）
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar: true,
      bio: true,
      role: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }
  res.json(user);
});

// 修改本人密码：PUT /api/users/me/password（需登录，仅本人）
// body: { currentPassword, newPassword }  需校验原密码
router.put("/me/password", jwtAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "原密码和新密码不能为空" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "新密码长度至少 6 位" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(401).json({ error: "原密码错误" });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  // 改密码使令牌版本 +1：同一账号在其它设备的旧令牌随之失效，强制下线
  await prisma.user.update({
    where: { id: req.userId },
    data: { password: hash, tokenVersion: { increment: 1 } },
  });
  res.status(204).end();
});

// 注销账号：POST /api/users/me/deactivate（需登录，仅本人）
// 身份置 REVOKED（管理员被直接覆盖为注销，相当于先降权）；tokenVersion +1 使该账号在其它设备立刻失效（强制下线）
// 保留全部数据；站长（OWNER）账号不可注销，保证系统仍有人管理
router.post("/me/deactivate", jwtAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  if (user.role === "OWNER") {
    return res.status(403).json({ error: "站长账号无法注销" });
  }
  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: { role: "REVOKED", tokenVersion: { increment: 1 } },
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar: true,
      bio: true,
      role: true,
      theme: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  res.json(updated);
});

export default router;