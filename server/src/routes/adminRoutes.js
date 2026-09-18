import { Router } from "express";
import prisma from "../prismaClient.js";
import { adminOnly, jwtAuth, ownerOnly } from "../middleware/auth.js";

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

// 访客统计（站长/管理员）：历史累计唯一访客数 + 近 7 天每日唯一访客数。
// 存储仅为 IP 哈希，统计口径 = 全部计入（游客/普通用户/管理员均可成为访客）。
// 历史累计唯一访客 = 不同 ipHash 的个数（同一 IP 跨天只算一次）；
// 某日唯一访客 = 该 day 下的行数（(IP哈希, 日) 已唯一）。
router.get("/visits", jwtAuth, adminOnly, async (_req, res) => {
  const pad = (n) => String(n).padStart(2, "0");
  const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 近 7 天（含今日）的日期串
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    days.push(localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  const [distinctHashes, dailyRows] = await Promise.all([
    prisma.visitLog.groupBy({ by: ["ipHash"], _count: { _all: true } }),
    prisma.visitLog.groupBy({
      by: ["day"],
      where: { day: { in: days } },
      _count: { _all: true },
    }),
  ]);
  const byDay = new Map(dailyRows.map((r) => [r.day, r._count._all]));
  res.json({
    total: distinctHashes.length, // 历史累计唯一访客
    days: days.map((day) => ({ day, count: byDay.get(day) || 0 })),
  });
});

// 管理页：软删除（不可见）列表：GET /api/admin/deleted（站长与管理员可查看）
// 站长可在此恢复或真正删除；管理员仅能查看（恢复/删除接口仍仅站长）
router.get("/deleted", jwtAuth, adminOnly, async (_req, res) => {
  const [games, reviews] = await Promise.all([
    prisma.game.findMany({
      where: { deletedAt: { not: null } },
      include: { deletedBy: { select: { id: true, username: true, nickname: true, avatar: true, role: true } } },
      orderBy: { deletedAt: "desc" },
    }),
    prisma.gameReview.findMany({
      where: { deletedAt: { not: null } },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        deletedBy: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
        game: { select: { id: true, nameZh: true, nameEn: true, logoImageUrl: true, coverImageUrl: true, heroImageUrl: true } },
      },
      orderBy: { deletedAt: "desc" },
    }),
  ]);
  res.json({
    games: games.map((g) => ({ ...g, tags: parseTags(g.tags) })),
    reviews: reviews.map((r) => ({ ...r, tags: parseTags(r.tags) })),
  });
});

// 单条软删除游戏（详情页预览用，站长与管理员可查看）：GET /api/admin/deleted/games/:id
router.get("/deleted/games/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
  const game = await prisma.game.findUnique({
    where: { id },
    include: { deletedBy: { select: { id: true, username: true, nickname: true, avatar: true, role: true } } },
  });
  if (!game || !game.deletedAt) return res.status(404).json({ error: "记录不存在或未删除" });
  res.json({ ...game, tags: parseTags(game.tags) });
});

// 单条软删除评测（详情页预览用，站长与管理员可查看）：GET /api/admin/deleted/reviews/:id
router.get("/deleted/reviews/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
  const review = await prisma.gameReview.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
      deletedBy: { select: { id: true, username: true, nickname: true, avatar: true, role: true } },
      game: { select: { id: true, nameZh: true, nameEn: true, logoImageUrl: true, coverImageUrl: true, heroImageUrl: true } },
    },
  });
  if (!review || !review.deletedAt) return res.status(404).json({ error: "记录不存在或未删除" });
  let ratingParams = [];
  try {
    ratingParams = review.ratingParams ? JSON.parse(review.ratingParams) : [];
  } catch {
    ratingParams = [];
  }
  res.json({
    ...review,
    ratingParams,
    tags: parseTags(review.tags),
  });
});

// 恢复可见：POST /api/admin/restore/:kind/:id（站长与管理员；kind=game|review）
router.post("/restore/:kind/:id", jwtAuth, adminOnly, async (req, res) => {
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
    await prisma.$transaction([
      prisma.gameProposal.deleteMany({ where: { gameId: id } }),
      // 评测脱离外键引用（gameId 置空），但把旧关联暂存到 staleGameId，
      // 供<script>同名游戏重新加入时映射回新 id</script>（评测文章本身保留）
      prisma.gameReview.updateMany({
        where: { gameId: id },
        data: { gameId: null, staleGameId: id },
      }),
      prisma.game.delete({ where: { id } }),
      // 墓碑：保留原 id + 英文名，新增同名游戏时据此恢复评测关联
      prisma.gameTombstone.create({ data: { id, nameEn: game.nameEn } }),
    ]);
  } else {
    const review = await prisma.gameReview.findUnique({ where: { id } });
    if (!review) return res.status(404).json({ error: "记录不存在" });
    // 先清掉该评测收到的点赞/不认可，避免外键约束失败
    await prisma.$transaction([
      prisma.gameReviewReaction.deleteMany({ where: { reviewId: id } }),
      prisma.gameReview.delete({ where: { id } }),
    ]);
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
  const data = reviews.map((r) => {
    let ratingParams = [];
    try {
      ratingParams = r.ratingParams ? JSON.parse(r.ratingParams) : [];
    } catch {
      ratingParams = [];
    }
    return {
      id: r.id,
      gameName: r.gameName,
      coverImageUrl: r.coverImageUrl,
      title: r.title,
      content: r.content,
      rating: r.rating,
      ratingParams,
      status: r.status,
      tags: parseTags(r.tags),
      authorId: r.authorId,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
    };
  });
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

// 设为管理员 / 取消管理员：PUT /api/admin/users/:id/role（仅站长）
// body: { role: "ADMIN" | "USER" }；OWNER 站长权限不可被修改
router.put("/users/:id/role", jwtAuth, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  const role = req.body?.role;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "非法用户 ID" });
  }
  if (role !== "ADMIN" && role !== "USER") {
    return res.status(400).json({ error: "非法角色" });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return res.status(404).json({ error: "用户不存在" });
  }
  if (target.role === "OWNER") {
    return res.status(403).json({ error: "不能修改站长权限" });
  }
  const user = await prisma.user.update({
    where: { id },
    data: { role },
    select: { id: true, username: true, nickname: true, avatar: true, bio: true, role: true, createdAt: true },
  });
  res.json(user);
});

// 彻底删除已注销用户及其全部数据：DELETE /api/admin/users/:id（仅站长）
// 仅允许删除已注销（REVOKED）用户；删除其评测、点赞/不认可、游戏申请，
// 并解绑其申请新增的待审游戏，最后删除用户。站长不可被删除。
router.delete("/users/:id", jwtAuth, ownerOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "非法用户 ID" });
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return res.status(404).json({ error: "用户不存在" });
  }
  if (user.role === "OWNER") {
    return res.status(403).json({ error: "不能删除站长" });
  }
  if (user.role !== "REVOKED") {
    return res.status(403).json({ error: "仅能彻底删除已注销的用户" });
  }
  await prisma.$transaction(async (tx) => {
    const reviewIds = (
      await tx.gameReview.findMany({ where: { authorId: id }, select: { id: true } })
    ).map((r) => r.id);
    // 删除该用户评测收到的点赞/不认可
    await tx.gameReviewReaction.deleteMany({ where: { reviewId: { in: reviewIds } } });
    // 删除该用户对他人评测的点赞/不认可
    await tx.gameReviewReaction.deleteMany({ where: { userId: id } });
    // 删除该用户的评测（含草稿）
    await tx.gameReview.deleteMany({ where: { authorId: id } });
    // 删除该用户的游戏申请
    await tx.gameProposal.deleteMany({ where: { proposerId: id } });
    // 解绑其申请新增的待审游戏（保留游戏本身）
    await tx.game.updateMany({ where: { submitterId: id }, data: { submitterId: null } });
    await tx.user.delete({ where: { id } });
  });
  res.status(204).end();
});

export default router;