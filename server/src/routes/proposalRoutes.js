import { Router } from "express";
import prisma from "../prismaClient.js";
import { jwtAuth, adminOnly } from "../middleware/auth.js";

const router = Router();

// 解析申请快照 data（JSON 字符串）与对应游戏信息
function shape(p) {
  let data = {};
  try {
    data = JSON.parse(p.data) || {};
  } catch {
    data = {};
  }
  let game = null;
  if (p.game) {
    game = {
      id: p.game.id,
      nameZh: p.game.nameZh,
      nameEn: p.game.nameEn,
      coverImageUrl: p.game.coverImageUrl,
      status: p.game.status,
      tags: Array.isArray(p.game.tags)
        ? p.game.tags
        : p.game.tags
          ? JSON.parse(p.game.tags)
          : [],
    };
  }
  return {
    id: p.id,
    kind: p.kind,
    gameId: p.gameId,
    data,
    reason: p.reason,
    status: p.status,
    rejectReason: p.rejectReason,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt,
    game,
    proposer: p.proposer
      ? { id: p.proposer.id, username: p.proposer.username, nickname: p.proposer.nickname, avatar: p.proposer.avatar }
      : null,
  };
}

// 管理端看到的待审申请列表：GET /api/proposals?status=PENDING（默认全部）
router.get("/", jwtAuth, adminOnly, async (req, res) => {
  const status = req.query.status || undefined;
  const where = { status: status ? { equals: status } : { in: ["PENDING"] } };
  const list = await prisma.gameProposal.findMany({
    where,
    include: {
      proposer: { select: { id: true, username: true, nickname: true, avatar: true } },
      game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, logoImageUrl: true, heroImageUrl: true, status: true, tags: true } },
    },
    // 待办按提交先后处理（先提交的先审）
    orderBy: { createdAt: "asc" },
  });
  res.json(list.map(shape));
});

// 我的申请列表：GET /api/proposals/mine（当前登录用户全部申请，含新增/编辑）
router.get("/mine", jwtAuth, async (req, res) => {
  const list = await prisma.gameProposal.findMany({
    where: { proposerId: req.userId },
    include: {
      game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, status: true, tags: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(list.map(shape));
});

// 单个申请：GET /api/proposals/:id（仅申请人本人或站长/管理员）
router.get("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const p = await prisma.gameProposal.findUnique({
    where: { id },
    include: {
      proposer: { select: { id: true, username: true, nickname: true, avatar: true } },
      game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, status: true, tags: true } },
    },
  });
  if (!p) return res.status(404).json({ error: "proposal not found" });
  const isAdmin = req.role === "ADMIN" || req.role === "OWNER";
  if (p.proposerId !== req.userId && !isAdmin) {
    return res.status(403).json({ error: "无权查看该申请" });
  }
  res.json(shape(p));
});

// 编辑待审核申请：PUT /api/proposals/:id（仅申请人本人，且申请处于 PENDING）
// body 里提供的字段覆盖到申请快照中；ADD 类型会同步更新其待审游戏行
router.put("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proposal = await prisma.gameProposal.findUnique({ where: { id } });
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  if (proposal.proposerId !== req.userId) {
    return res.status(403).json({ error: "无权编辑该申请" });
  }
  if (proposal.status !== "PENDING") {
    return res.status(409).json({ error: "该申请已处理，无法编辑" });
  }

  let current = {};
  try {
    current = JSON.parse(proposal.data) || {};
  } catch {
    current = {};
  }

  const nameZh =
    typeof req.body.nameZh === "string" && req.body.nameZh.trim()
      ? req.body.nameZh.trim()
      : (current.nameZh || null);
  const nameEn = (
    typeof req.body.nameEn === "string" && req.body.nameEn.trim()
      ? req.body.nameEn.trim()
      : current.nameEn || ""
  );
  // 英文名为必填项，中文名可空
  if (!nameEn) {
    return res.status(400).json({ error: "英文名不能为空" });
  }

  // 名称软去重（排除目标游戏自身），中英文名任一项命中即冲突
  const excludeId = proposal.gameId ?? -1;
  const enKey = nameEn.toLowerCase();
  const zhKey = (nameZh || "").toLowerCase();
  let dup = null;
  if (enKey || zhKey) {
    const candidates = await prisma.game.findMany({
      where: { deletedAt: null, NOT: { id: excludeId } },
      select: { id: true, nameZh: true, nameEn: true },
    });
    dup =
      candidates.find(
        (g) =>
          (enKey && (g.nameEn || "").toLowerCase() === enKey) ||
          (zhKey && (g.nameZh || "").toLowerCase() === zhKey)
      ) || null;
  }
  if (dup) return res.status(409).json({ error: "该游戏已存在" });

  const next = { ...current, nameZh, nameEn };
  if (req.body.coverImageUrl !== undefined) next.coverImageUrl = req.body.coverImageUrl || null;
  if (req.body.logoImageUrl !== undefined) next.logoImageUrl = req.body.logoImageUrl || null;
  if (req.body.heroImageUrl !== undefined) next.heroImageUrl = req.body.heroImageUrl || null;
  if (req.body.developer !== undefined) next.developer = req.body.developer || null;
  if (req.body.publisher !== undefined) next.publisher = req.body.publisher || null;
  if (req.body.description !== undefined) next.description = req.body.description || "";
  if (req.body.tags !== undefined) next.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  if (req.body.score !== undefined) {
    next.score = req.body.score == null || req.body.score === "" ? null : Number(req.body.score);
  }
  const reason = req.body.reason !== undefined ? String(req.body.reason).trim() || null : proposal.reason;

  const updated = await prisma.$transaction(async (tx) => {
    if (proposal.kind === "ADD" && proposal.gameId) {
      await tx.game.update({
        where: { id: proposal.gameId },
        data: {
          nameZh: next.nameZh,
          nameEn: next.nameEn,
          coverImageUrl: next.coverImageUrl,
          logoImageUrl: next.logoImageUrl,
          heroImageUrl: next.heroImageUrl,
          developer: next.developer,
          publisher: next.publisher,
          description: next.description,
          tags: Array.isArray(next.tags) && next.tags.length ? JSON.stringify(next.tags) : null,
          score: next.score ?? null,
        },
      });
    }
    return tx.gameProposal.update({
      where: { id },
      data: { data: JSON.stringify(next), reason },
      include: {
        proposer: { select: { id: true, username: true, nickname: true, avatar: true } },
        game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, status: true, tags: true } },
      },
    });
  });
  res.json(shape(updated));
});

// 删除/取消申请：DELETE /api/proposals/:id（仅申请人本人或站长/管理员）
// - PENDING（审核中）删除 = 取消申请：ADD 类同时删除其待审游戏行（尚无公开数据）；
// - 已处理（APPROVED/REJECTED）删除 = 删除该条记录本身。
router.delete("/:id", jwtAuth, async (req, res) => {
  const id = Number(req.params.id);
  const proposal = await prisma.gameProposal.findUnique({ where: { id } });
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  const isAdmin = req.role === "ADMIN" || req.role === "OWNER";
  if (proposal.proposerId !== req.userId && !isAdmin) {
    return res.status(403).json({ error: "无权删除该申请" });
  }
  await prisma.$transaction(async (tx) => {
    if (proposal.status === "PENDING" && proposal.kind === "ADD" && proposal.gameId) {
      // 取消新增申请：待审游戏尚无公开数据，一并删除，避免残留审核中的游戏占位
      await tx.game.deleteMany({ where: { id: proposal.gameId, status: "PENDING" } });
    }
    await tx.gameProposal.delete({ where: { id } });
  });
  res.status(204).end();
});

// 审批通过：POST /api/proposals/:id/approve（站长或管理员）
router.post("/:id/approve", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const proposal = await prisma.gameProposal.findUnique({ where: { id } });
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  if (proposal.status !== "PENDING") return res.status(409).json({ error: "该申请已处理" });

  let data = {};
  try {
    data = JSON.parse(proposal.data) || {};
  } catch {
    data = {};
  }

  const result = await prisma.$transaction(async (tx) => {
    if (proposal.kind === "ADD") {
      // 新增：将待审游戏转为公开
      await tx.game.updateMany({
        where: { id: proposal.gameId, status: "PENDING" },
        data: { status: "APPROVED" },
      });
    } else if (proposal.kind === "EDIT" && proposal.gameId) {
      // 编辑：将申请的数据应用到目标游戏（不改动由评测生成的 score）
      await tx.game.update({
        where: { id: proposal.gameId },
        data: {
          nameZh: data.nameZh,
          nameEn: data.nameEn ?? undefined,
          coverImageUrl: data.coverImageUrl !== undefined ? data.coverImageUrl : undefined,
          logoImageUrl: data.logoImageUrl !== undefined ? data.logoImageUrl : undefined,
          heroImageUrl: data.heroImageUrl !== undefined ? data.heroImageUrl : undefined,
          developer: data.developer !== undefined ? data.developer : undefined,
          publisher: data.publisher !== undefined ? data.publisher : undefined,
          description: data.description !== undefined ? data.description : undefined,
          tags: Array.isArray(data.tags)
            ? (data.tags.length ? JSON.stringify(data.tags) : null)
            : undefined,
        },
      });
    }
    return tx.gameProposal.update({
      where: { id },
      data: { status: "APPROVED", rejectReason: null, reviewedAt: new Date() },
      include: {
        proposer: { select: { id: true, username: true, nickname: true, avatar: true } },
        game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, status: true, tags: true } },
      },
    });
  });

  res.json(shape(result));
});

// 审批拒绝：POST /api/proposals/:id/reject（站长或管理员；body: { reason? }）
router.post("/:id/reject", jwtAuth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const proposal = await prisma.gameProposal.findUnique({ where: { id } });
  if (!proposal) return res.status(404).json({ error: "proposal not found" });
  if (proposal.status !== "PENDING") return res.status(409).json({ error: "该申请已处理" });

  const reason = (req.body?.reason || "").trim() || null;
  if (proposal.kind === "ADD" && proposal.gameId) {
    // 拒绝新增：删除待审游戏（尚无公开数据），保留申请记录以便申请人在“事务”里看到被拒绝
    await prisma.$transaction(async (tx) => {
      await tx.game.deleteMany({ where: { id: proposal.gameId, status: "PENDING" } });
      await tx.gameProposal.update({
        where: { id },
        data: { status: "REJECTED", rejectReason: reason, reviewedAt: new Date() },
      });
    });
  } else {
    // 拒绝编辑：既有游戏保持原样
    await prisma.gameProposal.update({
      where: { id },
      data: { status: "REJECTED", rejectReason: reason, reviewedAt: new Date() },
    });
  }

  const updated = await prisma.gameProposal.findUnique({
    where: { id },
    include: {
      proposer: { select: { id: true, username: true, nickname: true, avatar: true } },
      game: { select: { id: true, nameZh: true, nameEn: true, coverImageUrl: true, status: true, tags: true } },
    },
  });
  res.json(shape(updated));
});

export default router;