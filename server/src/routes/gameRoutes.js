import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth, adminOnly, optionJwtAuth } from "../middleware/auth.js";
import { sgdbSearch, fetchAssets, downloadCover, downloadThumb } from "../services/sgdb.js";
import { attachReviewStats } from "../utils/reviewStats.js";

// 评测列表附加其关联游戏（封面/名称），供前端评测卡片展示并可跳转详情
const reviewGameSelect = {
  select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, logoImageUrl: true, heroImageUrl: true },
};

const router = Router();

// 解析 JSON 数组字符串；非法/空值回退为空数组，避免历史脏数据或导入的非 JSON 字符串触发 500
function parseTags(game) {
  try {
    game.tags = game.tags ? JSON.parse(game.tags) : [];
  } catch {
    game.tags = [];
  }
  return game;
}

// 为一组游戏实时计算均分（仅统计已发布、未软删除、计入评分的评测），
// 覆盖返回对象中的 score，避免依赖可能过期或为空的存档列。
async function attachScores(games) {
  if (!games.length) return games;
  // 名字兜底映射：老数据评测（gameId 为 null）按其 gameName 归到名称匹配的游戏
  const nameOf = new Map();
  for (const g of games) {
    if (g.nameEn) nameOf.set(g.nameEn, g.id);
    if (g.nameZh) nameOf.set(g.nameZh, g.id);
  }
  const ids = games.map((g) => g.id);
  const rows = await prisma.gameReview.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      counted: true,
      // 归属优先按稳定键 gameId；仅历史无 gameId 的评测才按名字兜底
      OR: [
        { gameId: { in: ids } },
        { gameId: null, gameName: { in: [...nameOf.keys()] } },
      ],
    },
    select: { gameId: true, gameName: true, rating: true },
  });
  const perId = new Map(ids.map((id) => [id, []]));
  for (const r of rows) {
    const target = r.gameId != null ? r.gameId : nameOf.get(r.gameName);
    if (target != null && perId.has(target)) perId.get(target).push(r.rating);
  }
  return games.map((g) => {
    const ratings = perId.get(g.id);
    if (!ratings || !ratings.length) return { ...g, score: null };
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    return { ...g, score: Math.round(avg * 10) / 10 };
  });
}

// 申请新增游戏提交后的快照：data 字段为 JSON 字符串
function isAdminRole(req) {
  return req.role === "ADMIN" || req.role === "OWNER";
}

function normalizeName(n) {
  return (n || "").toString().trim().toLowerCase();
}

// 名称软去重：英文名 / 中文名任一项命中即视为重复（忽略大小写与首尾空白、过滤软删除）。
// excludeIds：更新/编辑时排除自身。仅返回首个冲突游戏或 null。
async function findNameConflict(nameEn, nameZh, excludeIds = []) {
  const en = normalizeName(nameEn);
  const zh = normalizeName(nameZh);
  if (!en && !zh) return null;
  const candidates = await prisma.game.findMany({
    where: {
      deletedAt: null,
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
    },
    select: { id: true, nameZh: true, nameEn: true, status: true, submitterId: true },
  });
  return (
    candidates.find(
      (g) =>
        (en && normalizeName(g.nameEn) === en) || (zh && normalizeName(g.nameZh) === zh)
    ) || null
  );
}

// 游戏列表：GET /api/games
// 可选 keyword= 按中文名或英文名搜索；tag= 按标签筛选
// page/pageSize 分页流式加载（默认每页 50）；携带有效登录态时，额外返回本人“审核中”的新增游戏
router.get("/", optionJwtAuth, async (req, res) => {
  const keyword = (req.query.keyword || "").trim();
  const tag = (req.query.tag || "").trim();
  const myId = req.userId;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));

  // 公开：全部已通过游戏；若已登录，追加本人待审核的新增游戏；均过滤软删除（不可见）
  const group = [
    { status: "APPROVED", deletedAt: null },
    ...(myId ? [{ status: "PENDING", submitterId: myId, deletedAt: null }] : []),
  ];
  const where = { OR: group };
  if (keyword) {
    where.OR = group.map((g) => ({
      ...g,
      OR: [
        { nameZh: { contains: keyword } },
        { nameEn: { contains: keyword } },
      ],
    }));
  }
  // tags 以 JSON 数组字符串存储（如 ["ARPG","动作"]），用带引号包含匹配实现精确标签过滤
  if (tag) {
    const tagged = group.map((g) => ({ ...g, tags: { contains: JSON.stringify(tag) } }));
    where.OR = tagged;
  }

  // 排序依据必须是实时均分。数据库存档的 score 列可能因评测增减/更新而过时，
  // 而 attachScores 会用最新已发布评测重算并覆盖 score；故先取全量匹配游戏，
  // 按实时均分在 JS 层稳定排序后再分页切片，确保全局顺序与页面显示的分一致。
  const allGames = await prisma.game.findMany({ where });
  const scored = await attachScores(allGames.map(parseTags));
  scored.sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sb !== sa) return sb - sa; // 实时均分降序，无评分排最后
    return new Date(b.createdAt) - new Date(a.createdAt); // 同分新游戏优先
  });
  // 全局分数排名：仅给有分数的游戏编号，同分并列（如 1,1,3）；无分数返回 null
  let sRank = 0;
  let lastScore = null;
  let lastRank = 0;
  for (const g of scored) {
    if (g.score == null) {
      g.scoreRank = null;
      continue;
    }
    sRank += 1;
    if (lastScore === null || g.score !== lastScore) lastRank = sRank;
    g.scoreRank = lastRank;
    lastScore = g.score;
  }
  const total = scored.length;
  const start = (page - 1) * pageSize;
  const games = scored.slice(start, start + pageSize);
  res.json({ list: games, total, page, pageSize, hasMore: start + games.length < total });
});

// 全部标签及数量：GET /api/games/tags（需在 /:id 之前定义）
router.get("/tags", async (_req, res) => {
  const games = await prisma.game.findMany({ where: { status: "APPROVED", deletedAt: null }, select: { tags: true } });
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

// 从 SteamGridDB 按名称搜索游戏（返回候选，需用户再选择）：GET /api/games/sgdb/search?q=
// 返回 { games: [{ id, name }] }——id 为 SteamGridDB 游戏 id，后续用它拉取三类素材
router.get("/sgdb/search", jwtAuth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "缺少搜索词" });
  try {
    const results = (await sgdbSearch(q)) || [];
    res.json({ games: results.slice(0, 8).map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    res.status(502).json({ error: "SteamGridDB 查询失败：" + (err?.message || "unknown") });
  }
});

// 拉取某游戏的三类素材：GET /api/games/sgdb/assets?gridId=
// 返回 { grids, logos, heroes }——每类至多 20 张 { url, thumb }
router.get("/sgdb/assets", jwtAuth, async (req, res) => {
  const gridId = Number(req.query.gridId);
  if (!gridId) return res.status(400).json({ error: "缺少 gridId" });
  try {
    res.json(await fetchAssets(gridId));
  } catch (err) {
    res.status(502).json({ error: "SteamGridDB 素材加载失败：" + (err?.message || "unknown") });
  }
});

// 将选中的 SteamGridDB 图片落地到本地：POST /api/games/sgdb/download
// body: { url }——下载到 uploads/sgdb 并返回本地路径 { url }
// 仅放行 SteamGridDB CDN 来源，防止登录用户借本接口发起 SSRF 探测内网/云元数据。
const SGDB_CDN_RE = /^https:\/\/(cdn2|cdn)\.steamgriddb\.com\//i;
router.post("/sgdb/download", jwtAuth, async (req, res) => {
  const { url } = req.body ?? {};
  if (!url || !SGDB_CDN_RE.test(url)) {
    return res.status(400).json({ error: "仅支持来自 SteamGridDB CDN 的图片地址" });
  }
  try {
    const local = await downloadCover(url);
    res.json({ url: local });
  } catch (err) {
    res.status(502).json({ error: "图片下载失败：" + (err?.message || "unknown") });
  }
});

// 缩略图本地代理【公开】：<img src> 无法携带 JWT，故不带鉴权。
// 仅允许 SteamGridDB CDN，下载到本地 thumbs 缓存后重定向，规避浏览器外链被挡。
// GET /api/games/sgdb/proxy?url=
router.get("/sgdb/proxy", async (req, res) => {
  const url = String(req.query.url || "");
  if (!/^https:\/\/(cdn2|cdn)\.steamgriddb\.com\//i.test(url)) {
    return res.status(403).end();
  }
  try {
    const local = await downloadThumb(url);
    return res.redirect(local || url);
  } catch {
    return res.redirect(url);
  }
});

// 游戏详情（含其评测，分页）：GET /api/games/:id?page=&pageSize=
// 待审游戏仅申请人本人与管理员可见，其他人返回 404
// 评测通过游戏中文名/英文名与评测表 gameName 匹配聚合
router.get("/:id", optionJwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  // 非法 id（NaN/负数/0）直接拒绝，避免带着无效参数进 findUnique 抛错
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize) || 5));

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.deletedAt) {
    return res.status(404).json({ error: "game not found" });
  }
  // 待审批游戏：只有申请人本人或管理员可访问
  const canSeePending = game.submitterId === req.userId || isAdminRole(req);
  if (game.status === "PENDING" && !canSeePending) {
    return res.status(404).json({ error: "game not found" });
  }

  // 一个游戏的评测可能以中文名或英文名作为 gameName 发布，名称任一项命中即关联
  const nameKeys = [game.nameEn, game.nameZh].filter(Boolean);
  const nameOr = nameKeys.map((n) => ({ gameName: n }));
  // 归属优先按稳定键 gameId；历史无 gameId 的评测才按名字兜底，改名后评测归属不丢
  const idAssoc = { gameId: game.id };
  const legacyNameAssoc = { gameId: null, OR: nameOr };
  const whereGame = { OR: [idAssoc, legacyNameAssoc] };

  // 当前登录用户是否已对该游戏写过评测：若有则返回并在评测列表中排除，避免重复展示
  let myReview = null;
  let listWhere = whereGame;
  if (req.userId) {
    myReview = await prisma.gameReview.findFirst({
      where: {
        authorId: req.userId,
        status: "PUBLISHED",
        deletedAt: null,
        OR: [idAssoc, legacyNameAssoc],
      },
      include: { author: { select: { id: true, username: true, nickname: true, avatar: true } }, game: reviewGameSelect },
    });
    if (myReview) {
      listWhere = { ...whereGame, NOT: { id: myReview.id } };
    }
  }

  const [total, list, countedReviews] = await Promise.all([
    prisma.gameReview.count({ where: whereGame }),
    prisma.gameReview.findMany({
      where: listWhere,
      include: { author: { select: { id: true, username: true, nickname: true, avatar: true } }, game: reviewGameSelect },
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    // 计入评分的评测数量：已发布、未软删除、且未标记为“不计入”的评测
    prisma.gameReview.count({
      where: { ...whereGame, status: "PUBLISHED", deletedAt: null, counted: true },
    }),
  ]);

  const shapedReviews = list.map((r) => ({
    ...r,
    tags: r.tags ? JSON.parse(r.tags) : [],
    ratingParams: r.ratingParams ? JSON.parse(r.ratingParams) : [],
  }));

  // 当前登录用户是否已有该游戏的“待审核编辑申请”
  let myPendingEdit = false;
  if (req.userId) {
    const pending = await prisma.gameProposal.findFirst({
      where: { gameId: id, proposerId: req.userId, kind: "EDIT", status: "PENDING" },
      select: { id: true },
    });
    myPendingEdit = Boolean(pending);
  }

  const shapedMyReview = myReview
    ? { ...myReview, tags: myReview.tags ? JSON.parse(myReview.tags) : [], ratingParams: myReview.ratingParams ? JSON.parse(myReview.ratingParams) : [] }
    : null;

  // 为「我的评测」与其余评测附加点赞/不认可数量、当前用户态度、作者内排名
  const formattedReviews = await attachReviewStats(shapedReviews, req.userId);
  const formattedMyReview = shapedMyReview
    ? (await attachReviewStats([shapedMyReview], req.userId))[0]
    : null;

  const shapedSingle = (await attachScores([game]))[0];

  res.json({
    game: parseTags(shapedSingle),
    reviews: formattedReviews,
    myReview: formattedMyReview,
    total,
    countedReviews,
    page,
    pageSize,
    myPendingEdit,
  });
});

// 创建游戏（申请新增）：POST /api/games（所有登录用户）
// 先生成一条“新增游戏申请”(kind=ADD)，同时创建处于 PENDING 状态的游戏
// body: { nameZh, nameEn?, coverImageUrl?, score?, developer?, publisher?, description?, tags?, reason? }
router.post("/", jwtAuth, async (req, res) => {
  const { nameZh, nameEn, coverImageUrl, logoImageUrl, heroImageUrl, score, developer, publisher, description, tags, reason } = req.body ?? {};

  // 英文名为必填项，中文名可空
  const newNameEn = (nameEn || "").trim();
  const newNameZh = (nameZh || "").trim() || null;
  if (!newNameEn) {
    return res.status(400).json({ error: "英文名不能为空" });
  }
  let numScore = null;
  if (score != null && score !== "") {
    numScore = Number(score);
    if (Number.isNaN(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: "score 需为 0-10 的数字" });
    }
  }

  // 名称软去重：中英文名任一项命中即视为已有游戏（含待审批游戏）
  const conflict = await findNameConflict(newNameEn, newNameZh);
  if (conflict) {
    if (conflict.status === "PENDING" && conflict.submitterId === req.userId) {
      return res.status(409).json({ error: "你已提交过该游戏的申请，等待审批中" });
    }
    return res.status(409).json({ error: "该游戏已存在" });
  }

  const data = {
    nameZh: newNameZh,
    nameEn: newNameEn,
    coverImageUrl: coverImageUrl || null,
    logoImageUrl: logoImageUrl || null,
    heroImageUrl: heroImageUrl || null,
    score: numScore,
    developer: developer || null,
    publisher: publisher || null,
    description: description || "",
    tags: Array.isArray(tags) ? tags : [],
  };

  // 站长/管理员创建直接通过（免审批）；普通用户进入待审流程：创建 PENDING 游戏 + 新增申请记录
  const isAdmin = isAdminRole(req);

  const created = await prisma.$transaction(async (tx) => {
    const status = isAdmin ? "APPROVED" : "PENDING";
    const game = await tx.game.create({
      data: {
        nameZh: data.nameZh,
        nameEn: data.nameEn,
        coverImageUrl: data.coverImageUrl,
        logoImageUrl: data.logoImageUrl,
        heroImageUrl: data.heroImageUrl,
        score: data.score,
        status,
        submitterId: req.userId,
        developer: data.developer,
        publisher: data.publisher,
        description: data.description,
        tags: data.tags.length ? JSON.stringify(data.tags) : null,
      },
    });
    if (!isAdmin) {
      await tx.gameProposal.create({
        data: {
          kind: "ADD",
          gameId: game.id,
          proposerId: req.userId,
          data: JSON.stringify(data),
          reason: reason || null,
          status: "PENDING",
        },
      });
    }
    return game;
  });

  res.status(201).json({ ...parseTags(created), proposalKind: isAdmin ? null : "ADD" });
});

// 申请编辑既有游戏：POST /api/games/:id/edit-proposal（所有登录用户；管理员可直接编辑无需申请）
// body: { nameZh, nameEn?, coverImageUrl?, developer?, publisher?, description?, tags?, reason? }
router.post("/:id/edit-proposal", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { nameZh, nameEn, coverImageUrl, logoImageUrl, heroImageUrl, developer, publisher, description, tags, reason } = req.body ?? {};

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game || game.status !== "APPROVED") {
    return res.status(404).json({ error: "game not found" });
  }
  // 英文名为必填项，中文名可空
  const newNameEn = (nameEn && nameEn.trim()) || null;
  const newNameZh = (nameZh || "").trim() || null;
  if (!newNameEn) {
    return res.status(400).json({ error: "英文名不能为空" });
  }
  // 名称软去重（排除目标游戏自身）
  const conflict = await findNameConflict(newNameEn, newNameZh, [id]);
  if (conflict) {
    return res.status(409).json({ error: "该游戏已存在" });
  }

  const data = {
    nameZh: newNameZh,
    nameEn: newNameEn,
    coverImageUrl: coverImageUrl !== undefined ? coverImageUrl : game.coverImageUrl,
    logoImageUrl: logoImageUrl !== undefined ? logoImageUrl : game.logoImageUrl,
    heroImageUrl: heroImageUrl !== undefined ? heroImageUrl : game.heroImageUrl,
    developer: developer !== undefined ? developer : game.developer,
    publisher: publisher !== undefined ? publisher : game.publisher,
    description: description !== undefined ? description : game.description,
    tags: Array.isArray(tags) ? tags : (game.tags ? JSON.parse(game.tags) : []),
  };

  // 站长/管理员申请编辑直接生效，无需审批
  if (isAdminRole(req)) {
    const updated = await prisma.game.update({
      where: { id },
      data: {
        nameZh: data.nameZh,
        nameEn: data.nameEn,
        coverImageUrl: data.coverImageUrl,
        logoImageUrl: data.logoImageUrl,
        heroImageUrl: data.heroImageUrl,
        developer: data.developer,
        publisher: data.publisher,
        description: data.description,
        tags: data.tags.length ? JSON.stringify(data.tags) : null,
      },
    });
    return res.status(200).json({ kind: "EDIT", status: "APPROVED", updated: parseTags(updated) });
  }

  // 同一用户对同一游戏只能有一条待审核编辑申请
  const dup = await prisma.gameProposal.findFirst({
    where: { gameId: id, proposerId: req.userId, kind: "EDIT", status: "PENDING" },
  });
  if (dup) {
    return res.status(409).json({ error: "你已提交过该游戏的编辑申请，等待审批中" });
  }

  const proposal = await prisma.gameProposal.create({
    data: {
      kind: "EDIT",
      gameId: id,
      proposerId: req.userId,
      data: JSON.stringify(data),
      reason: reason || null,
      status: "PENDING",
    },
  });
  res.status(201).json({ id: proposal.id, kind: "EDIT", status: proposal.status });
});

// 更新游戏：PUT /api/games/:id（仅管理员直接编辑）
router.put("/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { nameZh, nameEn, coverImageUrl, logoImageUrl, heroImageUrl, score, developer, publisher, description, tags } = req.body ?? {};

  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return res.status(404).json({ error: "game not found" });
  }

  // 英文名为必填项，中文名可空
  const newNameEn = typeof nameEn === "string" ? nameEn.trim() : "";
  const newNameZh = (typeof nameZh === "string" ? nameZh.trim() : "") || null;
  if (!newNameEn) {
    return res.status(400).json({ error: "英文名不能为空" });
  }

  let numScore = null;
  if (score != null && score !== "") {
    numScore = Number(score);
    if (Number.isNaN(numScore) || numScore < 0 || numScore > 10) {
      return res.status(400).json({ error: "score 需为 0-10 的数字" });
    }
  }

  // 名称软去重（排除自身）
  const conflict = await findNameConflict(newNameEn, newNameZh, [id]);
  if (conflict) {
    return res.status(409).json({ error: "该游戏已存在" });
  }

  const updated = await prisma.game.update({
    where: { id },
    data: {
      nameZh: newNameZh,
      nameEn: newNameEn,
      coverImageUrl: coverImageUrl !== undefined ? coverImageUrl : game.coverImageUrl,
      logoImageUrl: logoImageUrl !== undefined ? logoImageUrl : game.logoImageUrl,
      heroImageUrl: heroImageUrl !== undefined ? heroImageUrl : game.heroImageUrl,
      score: numScore,
      developer,
      publisher,
      description: description !== undefined ? description : game.description,
      tags: tags !== undefined ? (tags ? JSON.stringify(tags) : null) : game.tags,
    },
  });
  res.json(parseTags(updated));
});

// 删除游戏：DELETE /api/games/:id（需登录且管理员；站长=硬删除，管理员=软删除标记不可见）
// 站长硬删除与其它路径（admin purge）行为保持一致：删除其申请、评测暂存旧关联(staleGameId)、
// 写墓碑供同名游戏重新加入时恢复关联，并清理外键引用避免约束失败。
router.delete("/:id", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const game = await prisma.game.findUnique({ where: { id } });
  if (!game) {
    return res.status(404).json({ error: "game not found" });
  }
  const rejectReason = req.role === "OWNER" ? "游戏被站长删除" : "游戏不可见";
  await prisma.gameProposal.updateMany({
    where: { gameId: id, status: "PENDING" },
    data: { status: "REJECTED", rejectReason, reviewedAt: new Date() },
  });

  if (req.role === "OWNER" || game.deletedAt) {
    // 硬删除：事务内解绑申请与评测引用（评测写回 transient 旧关联供墓碑重映射），再删除游戏
    await prisma.$transaction([
      prisma.gameProposal.deleteMany({ where: { gameId: id } }),
      prisma.gameReview.updateMany({
        where: { gameId: id },
        data: { gameId: null, staleGameId: id },
      }),
      prisma.game.delete({ where: { id } }),
      prisma.gameTombstone.create({ data: { id, nameEn: game.nameEn } }),
    ]);
  } else {
    // 管理员软删除：标记为不可见并记录删除原因，站长可在管理页恢复或真正删除
    if (!game.deletedAt) {
      await prisma.game.update({
        where: { id },
        data: { deletedAt: new Date(), deleteReason: String(req.body?.reason || "").trim() || null, deletedById: req.userId },
      });
    }
  }
  res.status(204).end();
});

export { isAdminRole, parseTags };
export default router;