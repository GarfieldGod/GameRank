import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth, ownerOnly } from "../middleware/auth.js";

const router = Router();

function parseTags(t) {
  if (t == null) return [];
  if (Array.isArray(t)) return t;
  try {
    const a = JSON.parse(t);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// 站长管理页：软删除（不可见）列表：GET /api/admin/deleted（仅站长）
// 返回被管理员标记为不可见的游戏与评测，站长可在此恢复或真正删除
router.get("/deleted", jwtAuth, ownerOnly, async (_req, res) => {
  const [games, reviews] = await Promise.all([
    prisma.game.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    prisma.gameReview.findMany({
      where: { deletedAt: { not: null } },
      include: { author: { select: { id: true, username: true, avatar: true } } },
      orderBy: { deletedAt: "desc" },
    }),
  ]);
  res.json({
    games: games.map((g) => ({ ...g, tags: parseTags(g.tags) })),
    reviews: reviews.map((r) => ({ ...r, tags: parseTags(r.tags) })),
  });
});

// 恢复可见：POST /api/admin/restore/:kind/:id（仅站长；kind=game|review）
router.post("/restore/:kind/:id", jwtAuth, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  const kind = req.params.kind;
  if (!(kind === "game" || kind === "review")) {
    return res.status(400).json({ error: "非法类型" });
  }
  const where = { id };
  const exists = kind === "game"
    ? await prisma.game.findUnique({ where })
    : await prisma.gameReview.findUnique({ where });
  if (!exists) return res.status(404).json({ error: "记录不存在" });

  if (kind === "game") {
    await prisma.game.update({ where, data: { deletedAt: null } });
  } else {
    await prisma.gameReview.update({ where, data: { deletedAt: null } });
  }
  res.status(204).end();
});

// 真正删除（硬删除）：POST /api/admin/purge/:kind/:id（仅站长；kind=game|review）
router.post("/purge/:kind/:id", jwtAuth, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  const kind = req.params.kind;
  if (!(kind === "game" || kind === "review")) {
    return res.status(400).json({ error: "非法类型" });
  }
  if (kind === "game") {
    const game = await prisma.game.findUnique({ where: { id } });
    if (!game) return res.status(404).json({ error: "记录不存在" });
    // 先解绑引用该游戏的评测，评测文章本身保留
    await prisma.gameReview.updateMany({ where: { gameId: id }, data: { gameId: null } });
    await prisma.gameProposal.deleteMany({ where: { gameId: id } });
    await prisma.game.delete({ where: { id } });
  } else {
    const review = await prisma.gameReview.findUnique({ where: { id } });
    if (!review) return res.status(404).json({ error: "记录不存在" });
    await prisma.gameReview.delete({ where: { id } });
  }
  res.status(204).end();
});

// 导出游戏数据：全部字段，JSON 下载
router.get("/games/export", jwtAuth, ownerOnly, async (_req, res) => {
  const games = await prisma.game.findMany({ orderBy: { id: "asc" } });
  const data = games.map((g) => ({ ...g, tags: parseTags(g.tags) }));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="games.json"');
  res.send(JSON.stringify(data, null, 2));
});

// 导入游戏数据：按 nameZh 更新或创建
router.post("/games/import", jwtAuth, ownerOnly, async (req, res) => {
  const list = Array.isArray(req.body?.data) ? req.body.data : [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of list) {
    const nameZh = String(item?.nameZh || "").trim() || null;
    const nameEn =
      typeof item.nameEn === "string" && item.nameEn.trim()
        ? item.nameEn.trim()
        : (nameZh || "");
    if (!nameEn) {
      skipped += 1;
      continue;
    }
    let tags = null;
    if (Array.isArray(item.tags)) tags = JSON.stringify(item.tags);
    else if (typeof item.tags === "string") tags = item.tags;

    const score = item.score === undefined || item.score === null ? null : Number(item.score);

    const data = {
      nameEn,
      coverImageUrl: typeof item.coverImageUrl === "string" ? item.coverImageUrl : null,
      score: Number.isNaN(score) ? null : score,
      developer: typeof item.developer === "string" ? item.developer : null,
      publisher: typeof item.publisher === "string" ? item.publisher : null,
      description: typeof item.description === "string" ? item.description : "",
      tags,
    };

    // 中英文名任一项命中即视为同一游戏，更新之；否则新建
    const existing = await prisma.game.findFirst({
      where: { deletedAt: null, OR: [{ nameEn }, ...(nameZh ? [{ nameZh }] : [])] },
    });
    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data: { nameZh, ...data } });
      updated += 1;
    } else {
      await prisma.game.create({ data: { nameZh, ...data } });
      created += 1;
    }
  }
  res.json({ created, updated, skipped, total: list.length });
});

// 导出游戏评测：全部字段，JSON 下载
router.get("/reviews/export", jwtAuth, ownerOnly, async (_req, res) => {
  const reviews = await prisma.gameReview.findMany({ orderBy: { id: "asc" } });
  const data = reviews.map((r) => ({
    id: r.id,
    gameName: r.gameName,
    coverImageUrl: r.coverImageUrl,
    title: r.title,
    content: r.content,
    rating: r.rating,
    ratingParams: r.ratingParams ? JSON.parse(r.ratingParams) : [],
    status: r.status,
    tags: parseTags(r.tags),
    authorId: r.authorId,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
  }));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="reviews.json"');
  res.send(JSON.stringify(data, null, 2));
});

// 导入游戏评测：按 id 更新或创建
router.post("/reviews/import", jwtAuth, ownerOnly, async (req, res) => {
  const list = Array.isArray(req.body?.data) ? req.body.data : [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const item of list) {
    const gameName = String(item?.gameName || "").trim();
    const title = String(item?.title || "").trim();
    if (!gameName || !title) {
      failed += 1;
      continue;
    }
    try {
      let tags = null;
      if (Array.isArray(item.tags)) tags = JSON.stringify(item.tags);
      else if (typeof item.tags === "string") tags = item.tags;

      const rating = Number(item.rating);
      const data = {
        gameName,
        coverImageUrl: typeof item.coverImageUrl === "string" ? item.coverImageUrl : null,
        title,
        content: typeof item.content === "string" ? item.content : "",
        rating: Number.isNaN(rating) ? 0 : rating,
        ratingParams:
          Array.isArray(item.ratingParams) ? JSON.stringify(item.ratingParams)
          : typeof item.ratingParams === "string" ? item.ratingParams
          : null,
        status: item.status === "DRAFT" ? "DRAFT" : "PUBLISHED",
        tags,
        authorId: item.authorId == null ? undefined : Number(item.authorId),
      };

      const id = Number(item.id);
      if (id) {
        const existing = await prisma.gameReview.findUnique({ where: { id } });
        if (existing) {
          await prisma.gameReview.update({ where: { id }, data });
          updated += 1;
        } else {
          await prisma.gameReview.create({ data: { ...data, id } });
          created += 1;
        }
      } else {
        await prisma.gameReview.create({ data });
        created += 1;
      }
    } catch {
      failed += 1;
    }
  }
  res.json({ created, updated, failed, total: list.length });
});

export default router;