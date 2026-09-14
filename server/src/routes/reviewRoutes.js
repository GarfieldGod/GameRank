import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth } from "../middleware/auth.js";

const router = Router();

// tags 列存的是 JSON 字符串，统一解析为数组返回
function parseTags(review) {
  review.tags = review.tags ? JSON.parse(review.tags) : [];
  return review;
}

function parseListTags(list) {
  return list.map((r) => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] }));
}

// 评测列表：GET /api/reviews
// 支持：page, pageSize 分页；keyword 关键词（标题/游戏名）；tag 标签筛选；authorId 作者筛选
router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
  const keyword = (req.query.keyword || "").trim();
  const tag = (req.query.tag || "").trim();
  const authorId = req.query.authorId ? Number(req.query.authorId) : undefined;

  const where = {};

  if (authorId) {
    where.authorId = authorId;
  }
  if (keyword) {
    where.OR = [
      { title: { contains: keyword } },
      { gameName: { contains: keyword } },
    ];
  }
  if (tag) {
    // tags 存 JSON 数组字符串，精确匹配某个标签元素
    where.tags = { contains: `"${tag}"` };
  }

  const [total, list] = await Promise.all([
    prisma.gameReview.count({ where }),
    prisma.gameReview.findMany({
      where,
      include: { author: { select: { id: true, username: true, avatar: true } } },
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ list: parseListTags(list), total, page, pageSize });
});

// 创建评测：POST /api/reviews（需登录，作者取当前用户）
// body: { gameName, coverImageUrl?, title, content, rating, tags? }
router.post("/", jwtAuth, async (req, res) => {
  const { gameName, coverImageUrl, title, content, rating, tags } = req.body ?? {};

  if (!gameName || !title || !content || rating == null) {
    return res
      .status(400)
      .json({ error: "gameName, title, content, rating are required" });
  }

  const review = await prisma.gameReview.create({
    data: {
      gameName,
      coverImageUrl,
      title,
      content,
      rating: Number(rating),
      tags: tags ? JSON.stringify(tags) : null,
      authorId: req.userId,
    },
  });
  res.status(201).json(review);
});

// 评测详情：GET /api/reviews/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const review = await prisma.gameReview.findUnique({
    where: { id },
    include: { author: { select: { id: true, username: true, avatar: true } } },
  });
  if (!review) {
    return res.status(404).json({ error: "review not found" });
  }
  const shaped = parseTags(review);
  res.json(shaped);
});

// 更新评测：PUT /api/reviews/:id（需登录，仅作者本人）
router.put("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { gameName, coverImageUrl, title, content, rating, tags } = req.body ?? {};

  const existing = await prisma.gameReview.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "review not found" });
  }
  if (existing.authorId !== req.userId) {
    return res.status(403).json({ error: "无权修改他人的评测" });
  }

  const data = {};
  if (gameName !== undefined) data.gameName = gameName;
  if (coverImageUrl !== undefined) data.coverImageUrl = coverImageUrl;
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  if (rating !== undefined) data.rating = Number(rating);
  if (tags !== undefined) data.tags = JSON.stringify(tags);

  // updatedAt 由 @updatedAt 自动更新
  const review = await prisma.gameReview.update({ where: { id }, data });

  res.json(parseTags(review));
});

// 删除评测：DELETE /api/reviews/:id（需登录；作者本人或管理员）
router.delete("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.gameReview.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "review not found" });
  }
  if (existing.authorId !== req.userId && req.role !== "ADMIN") {
    return res.status(403).json({ error: "无权删除该评测" });
  }
  await prisma.gameReview.delete({ where: { id } });
  res.status(204).end();
});

export default router;