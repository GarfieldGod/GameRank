import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth, optionJwtAuth } from "../middleware/auth.js";
import { attachReviewStats, REACTION_KINDS } from "../utils/reviewStats.js";

const router = Router();

// tags / ratingParams 列存的是 JSON 字符串，统一解析为数组返回；非法 JSON 回退为空数组
function parseReview(review) {
  try {
    review.tags = review.tags ? JSON.parse(review.tags) : [];
  } catch {
    review.tags = [];
  }
  try {
    review.ratingParams = review.ratingParams ? JSON.parse(review.ratingParams) : [];
  } catch {
    review.ratingParams = [];
  }
  return review;
}

function parseListTags(list) {
  return list.map(parseReview);
}

// 由分项评分（score）× 权重（weight）自动计算综合分（保留 1 位小数，0-10）
function computeRating(params) {
  if (!Array.isArray(params) || !params.length) return 0;
  let num = 0;
  let den = 0;
  for (const p of params) {
    const s = Number(p.score) || 0;
    const w = Number(p.weight) || 0;
    num += s * w;
    den += w;
  }
  return den > 0 ? Math.round((num / den) * 10) / 10 : 0;
}

// 校验分项评分数组，非法则抛出错误信息
function validateRatingParams(params) {
  if (!Array.isArray(params)) return null;
  for (const p of params) {
    const aspect = typeof p.aspect === "string" ? p.aspect.trim() : "";
    const content = typeof p.content === "string" ? p.content.trim() : "";
    const score = Number(p.score);
    const weight = Number(p.weight);
    if (!aspect || !content || !Number.isInteger(score) || score < 0 || score > 10) {
      return "分项评分需包含方向、内容和 0-10 的整数分";
    }
    if (!Number.isFinite(weight) || weight < 1) {
      return "分项权重需为不小于 1 的数字";
    }
  }
  return null;
}

// 按中文名或英文名精确匹配游戏（用于校验存在性 + 关联游戏以语言化名称/取封面）
async function resolveGame(gameName) {
  if (!gameName) return null;
  return prisma.game.findFirst({
    where: { deletedAt: null, OR: [{ nameZh: gameName }, { nameEn: gameName }] },
  });
}
async function gameExists(gameName) {
  return Boolean(await resolveGame(gameName));
}

// 重新计算某游戏的全站平均分（已发布评测的 rating 均值，保留 1 位小数），无评测时为 null
async function updateGameScore(gameId, gameName) {
  const game = gameId
    ? await prisma.game.findUnique({ where: { id: gameId } })
    : await resolveGame(gameName);
  if (!game) return;

  const agg = await prisma.gameReview.aggregate({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      counted: true, // 只有「计入评分」的评测才参与平均分
      // 归属优先按稳定键 gameId；历史评测无 gameId 时才用名字兜底，
      // 避免改名后评测匹配不上导致评分被清空
      OR: [
        { gameId: game.id },
        { gameId: null, OR: [{ gameName: game.nameZh }, { gameName: game.nameEn }] },
      ],
    },
    _avg: { rating: true },
  });
  const avg = agg._avg.rating;
  const score = avg == null ? null : Math.round(avg * 10) / 10;
  await prisma.game.update({ where: { id: game.id }, data: { score } });
}

const gameSelect = {
  select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, logoImageUrl: true, heroImageUrl: true },
};

// 评测列表：GET /api/reviews
// 支持：page, pageSize 分页；keyword 关键词；tag 标签筛选；authorId 作者筛选；status 状态
// 默认只返回已发布(PUBLISHED)；status=DRAFT 需登录且仅本人
router.get(
  "/",
  (req, res, next) => {
    if (req.query.status === "DRAFT") return jwtAuth(req, res, next);
    optionJwtAuth(req, res, next);
  },
  async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 10));
    const keyword = (req.query.keyword || "").trim();
    const tag = (req.query.tag || "").trim();
    const sort = (req.query.sort || "").toString();
    const authorId = req.query.authorId ? Number(req.query.authorId) : undefined;
    const status = req.query.status === "DRAFT" ? "DRAFT" : "PUBLISHED";

    const where = { status, deletedAt: null };
    if (authorId) {
      // 非本人无权查看他人草稿
      if (status === "DRAFT" && authorId !== req.userId) {
        return res.status(403).json({ error: "无权查看他人草稿" });
      }
      where.authorId = authorId;
    } else if (status === "DRAFT") {
      where.authorId = req.userId;
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { gameName: { contains: keyword } },
      ];
    }
    if (tag) {
      where.tags = { contains: `"${tag}"` };
    }

    const orderBy = sort === "rating" ? [{ rating: "desc" }, { updatedAt: "desc" }] : { updatedAt: "desc" };

    const [total, list] = await Promise.all([
      prisma.gameReview.count({ where }),
      prisma.gameReview.findMany({
        where,
        include: {
          author: { select: { id: true, username: true, nickname: true, avatar: true } },
          game: gameSelect,
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const listStats = await attachReviewStats(parseListTags(list), req.userId);
    res.json({ list: listStats, total, page, pageSize });
  }
);

// 创建评测：POST /api/reviews（需登录，作者取当前用户）
// body: { gameName, brief?, content?, rating?, ratingParams?, status?, force? }
router.post("/", jwtAuth, async (req, res) => {
  const { gameName, coverImageUrl, title, brief, content, rating, tags, ratingParams, status, force } = req.body ?? {};
  const isDraft = status === "DRAFT";

  if (!gameName || (!isDraft && !content)) {
    return res
      .status(400)
      .json({ error: "gameName 为必填，发布时还需 content（正文）" });
  }
  if (brief !== undefined && String(brief).trim() && [...String(brief).trim()].length > 50) {
    return res.status(400).json({ error: "简述不能超过 50 个字" });
  }
  if (!isDraft && !(await gameExists(String(gameName)))) {
    return res.status(400).json({ error: "该游戏不存在，请从游戏库中选择" });
  }
  // 草稿未写完，分项可不完整，仅发布时严格校验
  if (!isDraft) {
    const paramErr = validateRatingParams(ratingParams);
    if (paramErr) {
      return res.status(400).json({ error: paramErr });
    }
  }

  // 关联游戏：封面使用所关联游戏的封面
  const game = await resolveGame(String(gameName));
  const gid = game?.id ?? null;

  // 同一用户对同一游戏仅能有一篇评测：发布时若已存在，需 force 确认后覆盖原评测
  if (!isDraft) {
    const existing = await prisma.gameReview.findFirst({
      where: {
        authorId: req.userId,
        OR: gid ? [{ gameId: gid }] : [{ gameName: String(gameName).trim() }],
      },
    });
    if (existing) {
      if (force !== true) {
        return res
          .status(409)
          .json({ error: "你已对这款游戏写过评测", code: "REVIEW_EXISTS", existingId: existing.id });
      }
      const updated = await prisma.gameReview.update({
        where: { id: existing.id },
        data: {
          gameName: String(gameName),
          gameId: game?.id ?? existing.gameId,
          coverImageUrl: game?.coverImageUrl ?? coverImageUrl ?? existing.coverImageUrl,
          title: title ? String(title).trim() : "",
          brief: brief ? String(brief).trim() : "",
          content: content ?? "",
          rating:
            rating != null
              ? Number(rating)
              : Array.isArray(ratingParams) && ratingParams.length
                ? computeRating(ratingParams)
                : 0,
          ratingParams: ratingParams !== undefined ? JSON.stringify(ratingParams) : null,
          status: "PUBLISHED",
          tags: tags ? JSON.stringify(tags) : null,
        },
      });
      await updateGameScore(updated.gameId, updated.gameName);
      return res.status(201).json(parseReview(updated));
    }
  }

  const review = await prisma.gameReview.create({
    data: {
      gameName,
      coverImageUrl: game?.coverImageUrl ?? coverImageUrl ?? null,
      title: title ? String(title).trim() : "",
      brief: brief ? String(brief).trim() : "",
      content: content ?? "",
      rating:
        rating != null
          ? Number(rating)
          : Array.isArray(ratingParams) && ratingParams.length
            ? computeRating(ratingParams)
            : 0,
      ratingParams: ratingParams !== undefined ? JSON.stringify(ratingParams) : null,
      status: isDraft ? "DRAFT" : "PUBLISHED",
      tags: tags ? JSON.stringify(tags) : null,
      authorId: req.userId,
      gameId: game?.id ?? null,
    },
  });
  await updateGameScore(review.gameId, review.gameName);
  res.status(201).json(parseReview(review));
});

// 评测详情：GET /api/reviews/:id（草稿仅作者本人或管理员可看；可选登录以附加我的态度）
router.get("/:id", optionJwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const review = await prisma.gameReview.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, username: true, nickname: true, avatar: true } },
      game: gameSelect,
    },
  });
  if (!review || review.deletedAt) {
    return res.status(404).json({ error: "review not found" });
  }
  if (review.status === "DRAFT") {
    // 需要登录且为作者本人或管理员
    const isOwner = req.userId && (req.userId === review.authorId || req.role === "ADMIN" || req.role === "OWNER");
    if (!isOwner) {
      return res.status(404).json({ error: "review not found" });
    }
  }
  const [withStats] = await attachReviewStats([parseReview(review)], req.userId);
  res.json(withStats);
});

// 点赞/不认可：POST /api/reviews/:id/reaction（需登录，作者不能对自己投票）
// body: { kind: "like" | "dislike" }；再次点击同一类型=取消投票
router.post("/:id/reaction", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const kind = (req.body?.kind || "").toString();
  if (!REACTION_KINDS.has(kind)) {
    return res.status(400).json({ error: "kind 需为 like 或 dislike" });
  }
  const review = await prisma.gameReview.findUnique({ where: { id } });
  if (!review || review.deletedAt || review.status !== "PUBLISHED") {
    return res.status(404).json({ error: "review not found" });
  }
  if (review.authorId === req.userId) {
    return res.status(403).json({ error: "不能评价自己的评测" });
  }

  const existing = await prisma.gameReviewReaction.findUnique({
    where: { reviewId_userId: { reviewId: id, userId: req.userId } },
  });
  if (existing && existing.kind === kind) {
    await prisma.gameReviewReaction.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.gameReviewReaction.update({ where: { id: existing.id }, data: { kind } });
  } else {
    await prisma.gameReviewReaction.create({ data: { reviewId: id, userId: req.userId, kind } });
  }

  const [withStats] = await attachReviewStats([review], req.userId);
  res.json({
    likeCount: withStats.likeCount,
    dislikeCount: withStats.dislikeCount,
    myReaction: withStats.myReaction,
  });
});

// 更新评测：PUT /api/reviews/:id（需登录，仅作者本人）
router.put("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { gameName, coverImageUrl, title, brief, content, rating, tags, ratingParams, status } = req.body ?? {};

  const existing = await prisma.gameReview.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: "review not found" });
  }
  if (existing.authorId !== req.userId) {
    return res.status(403).json({ error: "无权修改他人的评测" });
  }
  if (brief !== undefined && String(brief).trim() && [...String(brief).trim()].length > 50) {
    return res.status(400).json({ error: "简述不能超过 50 个字" });
  }
  const oldGameId = existing.gameId;
  const oldGameName = existing.gameName;

  const isDraft = status === "DRAFT";
  const paramErr = isDraft ? null : validateRatingParams(ratingParams);
  if (paramErr) {
    return res.status(400).json({ error: paramErr });
  }

  const nextGameName = typeof gameName === "string" ? gameName.trim() : existing.gameName;
  // 发布时：游戏必须存在于游戏库
  if (!isDraft && status === "PUBLISHED" && !(await gameExists(nextGameName))) {
    return res.status(400).json({ error: "该游戏不存在，请从游戏库中选择" });
  }

  const data = {};
  if (gameName !== undefined) data.gameName = gameName.trim();
  // 关联游戏：重新解析并同步封面为该游戏封面
  const game = await resolveGame(nextGameName);
  if (game) {
    data.gameId = game.id;
    data.coverImageUrl = game.coverImageUrl ?? null;
  } else {
    data.gameId = null;
    if (coverImageUrl !== undefined) data.coverImageUrl = coverImageUrl;
  }
  if (title !== undefined) data.title = title;
  if (brief !== undefined) data.brief = brief ? String(brief).trim() : "";
  if (content !== undefined) data.content = content;
  if (ratingParams !== undefined) {
    data.ratingParams = JSON.stringify(ratingParams);
    if (Array.isArray(ratingParams) && ratingParams.length) {
      data.rating = computeRating(ratingParams);
    } else if (rating !== undefined) {
      // 无分项评分时采用前端手动传入的综合分
      data.rating = Number(rating);
    }
  } else if (rating !== undefined) {
    data.rating = Number(rating);
  }
  if (status !== undefined) {
    data.status = status === "DRAFT" ? "DRAFT" : "PUBLISHED";
  }
  if (tags !== undefined) data.tags = JSON.stringify(tags);

  // updatedAt 由 @updatedAt 自动更新
  const review = await prisma.gameReview.update({ where: { id }, data });

  await updateGameScore(review.gameId, review.gameName);
  // 若改了所属游戏，原游戏分数也需重算
  if (oldGameId && oldGameId !== review.gameId) {
    await updateGameScore(oldGameId, oldGameName);
  }

  res.json(parseReview(review));
});

// 删除评测：DELETE /api/reviews/:id（需登录；作者本人或站长/管理员）
// 作者本人或站长=硬删除；管理员删除普通用户评测=软删除（标记不可见，站长或作者可再硬删除/恢复）
// 普通管理员【不可】删除站长或其他管理员的评测
router.delete("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.gameReview.findUnique({
    where: { id },
    include: { author: { select: { role: true } } },
  });
  if (!existing) {
    return res.status(404).json({ error: "review not found" });
  }
  const isAdmin = req.role === "ADMIN" || req.role === "OWNER";
  const isOwnerReq = req.role === "OWNER";
  if (existing.authorId !== req.userId && !isAdmin) {
    return res.status(403).json({ error: "无权删除该评测" });
  }
  // 普通管理员（非站长）删除他人评测：站长/其他管理员的评测一律无权删除
  if (!isOwnerReq && existing.authorId !== req.userId) {
    const targetRole = existing.author.role;
    if (targetRole === "OWNER" || targetRole === "ADMIN") {
      return res.status(403).json({ error: "您没有权限删除该文章，该文章拥有者权限等于或高于您。\n如有其他问题，请联系站长。" });
    }
  }
  const canHard = existing.authorId === req.userId || isOwnerReq;
  if (canHard || existing.deletedAt) {
    // 硬删除：先清掉该评测收到的点赞/不认可，避免外键约束失败导致 500
    await prisma.$transaction([
      prisma.gameReviewReaction.deleteMany({ where: { reviewId: id } }),
      prisma.gameReview.delete({ where: { id } }),
    ]);
  } else {
    // 管理员软删除：标记不可见并记录删除原因，同时向作者“事务”插入一条删除通知（含快照），便于作者重新编辑
    const reason = String(req.body?.reason || "").trim() || null;
    await prisma.$transaction(async (tx) => {
      await tx.gameReview.update({ where: { id }, data: { deletedAt: new Date(), deleteReason: reason, deletedById: req.userId } });
      await tx.gameProposal.create({
        data: {
          kind: "DEL",
          proposerId: existing.authorId,
          gameId: existing.gameId,
          data: JSON.stringify({
            gameName: existing.gameName,
            coverImageUrl: existing.coverImageUrl,
            title: existing.title,
            brief: existing.brief,
            content: existing.content,
            rating: existing.rating,
            ratingParams: existing.ratingParams,
            tags: existing.tags ? JSON.parse(existing.tags) : [],
          }),
          reason,
          status: "DELETED",
        },
      });
    });
  }
  await updateGameScore(existing.gameId, existing.gameName);
  res.status(204).end();
});

export default router;