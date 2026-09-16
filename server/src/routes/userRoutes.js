import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth } from "../middleware/auth.js";

const router = Router();

// 注册/登录见 authRoutes（/api/auth/register、/api/auth/login）

// 用户列表：GET /api/users
router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, nickname: true, avatar: true, bio: true, role: true, createdAt: true },
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
    return res.status(400).json({ error: "用户名需为 3-20 个字符" });
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

// 用户详情：GET /api/users/:id（头像、简介、创建时间；评测列表用 /api/reviews?authorId= 分页获取）
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
      createdAt: true,
    },
  });
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }
  res.json(user);
});

export default router;