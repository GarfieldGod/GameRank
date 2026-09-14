import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth, adminOnly } from "../middleware/auth.js";

const router = Router();

function parseTags(game) {
  game.tags = game.tags ? JSON.parse(game.tags) : [];
  return game;
}

// 游戏列表：GET /api/games（可选 keyword= 按中文名或英文名搜索；tag= 按标签筛选）
router.get("/", async (req, res) => {
  const keyword = (req.query.keyword || "").trim();
  const tag = (req.query.tag || "").trim();

  const where = {};
  if (keyword) {
    where.OR = [
      { nameZh: { contains: keyword } },
      { nameEn: { contains: keyword } },
    ];
  }
  // tags 以 JSON 数组字符串存储（如 ["ARPG","动作"]），用带引号包含匹配实现精确标签过滤
  if (tag) {
    where.tags = { contains: JSON.stringify(tag) };
  }

  const games = await prisma.game.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json(games.map(parseTags));
});

// 全部标签及数量：GET /api/games/tags（需在 /:id 之前定义）
router.get("/tags", async (_req, res) => {
  const games = await prisma.game.findMany({ select: { tags: true } });
  const counts = new Map();
  for (const g of games) {
    if (!g.tags) continue;
    let arr;
    try {
      arr = JSON.parse(g.tags);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      if (typeof t === "string" && t.trim()) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
  }
  const tags = [...counts.entries()]
    .map(([t, count]) => ({ tag: t, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh"));
  res.json(tags);
});

// 游戏详情（含其评测，分页）：GET /api/games/:id?page=&pageSize=
// 评测通过游戏中文名/英文名与评测表 gameName 匹配聚合
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 5));

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return res.status(404).json({ error: "game not found" });
  }

  const whereGame = { OR: [{ gameName: game.nameZh }, { gameName: game.nameEn }] };
  const [total, list] = await Promise.all([
    prisma.gameReview.count({ where: whereGame }),
    prisma.gameReview.findMany({
      where: whereGame,
      include: { author: { select: { id: true, username: true, avatar: true } } },
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const shapedReviews = list.map((r) => ({
    ...r,
    tags: r.tags ? JSON.parse(r.tags) : [],
  }));

  res.json({ game: parseTags(game), reviews: shapedReviews, total, page, pageSize });
});

// 创建游戏：POST /api/games（仅管理员）
// body: { nameZh, nameEn, coverImageUrl?, score?, developer?, publisher?, description?, tags? }
router.post("/", jwtAuth, adminOnly, async (req, res) => {
  const { nameZh, nameEn, coverImageUrl, score, developer, publisher, description, tags } = req.body ?? {};

  if (!nameZh) {
    return res.status(400).json({ error: "中文名不能为空" });
  }
  let numScore = null;
  if (score != null && score !== "") {
    numScore = Number(score);
    if (Number.isNaN(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: "score 需为 0-10 的数字" });
    }
  }

  const exists = await prisma.game.findUnique({ where: { nameZh } });
  if (exists) {
    return res.status(409).json({ error: "该游戏已存在" });
  }

  const game = await prisma.game.create({
    data: {
      nameZh,
      nameEn: nameEn || nameZh,
      coverImageUrl,
      score: numScore,
      developer,
      publisher,
      description: description || "",
      tags: tags ? JSON.stringify(tags) : null,
    },
  });
  res.status(201).json(parseTags(game));
});

// 更新游戏：PUT /api/games/:id（仅管理员）
// body: { nameZh, nameEn?, coverImageUrl?, score?, developer?, publisher?, description?, tags? }
router.put("/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { nameZh, nameEn, coverImageUrl, score, developer, publisher, description, tags } = req.body ?? {};

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return res.status(404).json({ error: "game not found" });
  }

  const newNameZh = typeof nameZh === "string" ? nameZh.trim() : "";
  if (!newNameZh) {
    return res.status(400).json({ error: "中文名不能为空" });
  }

  let numScore = null;
  if (score != null && score !== "") {
    numScore = Number(score);
    if (Number.isNaN(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: "score 需为 0-10 的数字" });
    }
  }

  // 中文名唯一性校验（排除自身）
  if (newNameZh !== game.nameZh) {
    const exists = await prisma.game.findUnique({ where: { nameZh: newNameZh } });
    if (exists) {
      return res.status(409).json({ error: "该游戏已存在" });
    }
  }

  const updated = await prisma.game.update({
    where: { id },
    data: {
      nameZh: newNameZh,
      nameEn: nameEn || game.nameEn,
      coverImageUrl: coverImageUrl !== undefined ? coverImageUrl : game.coverImageUrl,
      score: numScore,
      developer,
      publisher,
      description: description !== undefined ? description : game.description,
      tags: tags !== undefined ? (tags ? JSON.stringify(tags) : null) : game.tags,
    },
  });
  res.json(parseTags(updated));
});

// 删除游戏：DELETE /api/games/:id（仅管理员）
router.delete("/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return res.status(404).json({ error: "game not found" });
  }
  await prisma.game.delete({ where: { id } });
  res.status(204).end();
});

export default router;