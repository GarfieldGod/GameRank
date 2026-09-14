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
    const nameZh = String(item?.nameZh || "").trim();
    if (!nameZh) {
      skipped += 1;
      continue;
    }
    let tags = null;
    if (Array.isArray(item.tags)) tags = JSON.stringify(item.tags);
    else if (typeof item.tags === "string") tags = item.tags;

    const nameEn = typeof item.nameEn === "string" && item.nameEn.trim() ? item.nameEn.trim() : nameZh;
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

    const existing = await prisma.game.findUnique({ where: { nameZh } });
    if (existing) {
      await prisma.game.update({ where: { id: existing.id }, data });
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