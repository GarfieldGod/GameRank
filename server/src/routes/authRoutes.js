import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { jwtAuth } from "../middleware/auth.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-long-random-secret";

// 账号校验规则
const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;

// 注册：POST /api/auth/register
router.post("/register", async (req, res) => {
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
    return res.status(400).json({ error: "用户名需为 3-20 个字符" });
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

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, nickname: nickname || null, password: hash, avatar, bio },
  });
  // 不返回 password
  const { password: _pw, ...safe } = user;
  res.status(201).json(safe);
});

// 登录：POST /api/auth/login，成功签发 JWT
router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "账号和密码不能为空" });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "账号或密码错误" });
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const { password: _pw, ...safe } = user;
  res.json({ token, user: safe });
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
      createdAt: true,
    },
  });
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  res.json(user);
});

export default router;