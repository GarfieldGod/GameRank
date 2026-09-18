import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { jwtAuth } from "../middleware/auth.js";
import { loginLimiter, registerLimiter } from "../middleware/rateLimit.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("服务器环境变量 JWT_SECRET 缺失：请设置随机强密钥后启动");
}

// 账号校验规则
const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;

// 注册：POST /api/auth/register
router.post("/register", registerLimiter, async (req, res) => {
  const { username, nickname, password, avatar, bio } = req.body ?? {};

  // 表单校验
  if (!username || !password) {
    return res.status(400).json({ error: "账号和密码不能为空" });
  }
  if (!usernameRe.test(username)) {
    return res
      .status(400)
      .json({ error: "账号需为 3-20 位字母、数字或下划线" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "密码长度至少 6 位" });
  }
  if (nickname && (nickname.trim().length < 3 || nickname.trim().length > 20)) {
    return res.status(400).json({ error: "昵称需为 3-20 个字符" });
  }

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    return res.status(409).json({ error: "该账号已被注册" });
  }

  if (nickname && nickname.trim()) {
    const nickDupe = await prisma.user.findFirst({ where: { nickname: nickname.trim() } });
    if (nickDupe) {
      return res.status(409).json({ error: "用户名已被占用" });
    }
  }
  // 头像/简介与资料编辑接口保持一致校验，避免注册时写入不可控值
  if (avatar !== undefined && avatar !== "") {
    const isUrl = avatar.startsWith("/uploads/") || /^https?:\/\//.test(avatar);
    if (!isUrl) {
      return res.status(400).json({ error: "头像需为图片 URL" });
    }
  }
  if (bio !== undefined && bio.length > 200) {
    return res.status(400).json({ error: "个人简介不能超过 200 字" });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, nickname: nickname || null, password: hash, avatar, bio },
  });
  // 不返回 password
  const { password: _pw, ...safe } = user;
  res.status(201).json(safe);
});

// 登录：POST /api/auth/login，成功签发 JWT
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "账号和密码不能为空" });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "账号或密码错误" });
  }
  // 已注销账号禁止登录
  if (user.role === "REVOKED") {
    return res.status(403).json({ error: "该账号已注销" });
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role, tokenVersion: user.tokenVersion },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  // 登录即视为活跃，使在线状态即时生效
  await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });

  const { password: _pw, ...safe } = user;
  res.json({ token, user: safe });
});

// 心跳：上报最近活跃时间，用于在线判定（需鉴权，登录期间定时调用）
router.post("/heartbeat", jwtAuth, async (req, res) => {
  await prisma.user.update({ where: { id: req.userId }, data: { lastActiveAt: new Date() } });
  res.status(204).end();
});

// 获取当前登录用户：GET /api/auth/me（需鉴权）
router.get("/me", jwtAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
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
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  res.json(user);
});

export default router;