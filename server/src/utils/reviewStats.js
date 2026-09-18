import { Prisma } from "@prisma/client";
import prisma from "../prismaClient.js";

// 计算每篇评测在【该作者全部已发布评测】中的排名：
// 以综合分 rating 降序，同分按发布时间先后，再按 id 稳定排序（排名从 1 开始）
// 注意：分区必须覆盖该作者的全部已发布评测，而不是仅本批 id——
// 否则单篇/分页情况下分区内只有当前这一两行，排行榜恒为 #1 / 共1款。
// 返回 { [reviewId]: { rank, total } }，total 为该作者已发布的评测总数
async function computeAuthorRanks(ids) {
  if (!ids.length) return {};
  // 先取出本批评测对应的作者，再按这些作者的【全部】已发布评测计算排名，
  // 最后只把本批需要的 id 映射出来。
  const authors = await prisma.gameReview.findMany({
    where: { id: { in: ids }, status: "PUBLISHED", deletedAt: null },
    select: { id: true, authorId: true },
  });
  const idsSet = new Set(ids);
  const authorIds = [...new Set(authors.map((a) => a.authorId))];
  if (!authorIds.length) return {};
  const rows = await prisma.$queryRaw`
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY "authorId"
        ORDER BY rating DESC, "publishedAt" ASC, id ASC
      ) AS r,
      COUNT(*) OVER (PARTITION BY "authorId") AS total
    FROM "GameReview"
    WHERE status = 'PUBLISHED' AND "deletedAt" IS NULL
      AND "authorId" IN (${Prisma.join(authorIds)})
  `;
  const map = {};
  for (const row of rows) {
    if (idsSet.has(row.id)) map[row.id] = { rank: Number(row.r), total: Number(row.total) };
  }
  return map;
}

// 为一批评测附加：
//   likeCount / dislikeCount：点赞与不认可数量
//   myReaction：当前用户对该评测的态度（"like" / "dislike" / null）
//   authorRank：该作者自评中的排名
export async function attachReviewStats(reviews, userId = null) {
  if (!reviews.length) return reviews;
  const ids = reviews.map((r) => r.id);

  const [groups, myRows, ranks] = await Promise.all([
    prisma.gameReviewReaction.groupBy({
      by: ["reviewId", "kind"],
      where: { reviewId: { in: ids } },
      _count: { _all: true },
    }),
    userId
      ? prisma.gameReviewReaction.findMany({ where: { reviewId: { in: ids }, userId } })
      : Promise.resolve([]),
    computeAuthorRanks(ids),
  ]);

  const stat = {};
  for (const g of groups) {
    stat[g.reviewId] = stat[g.reviewId] || { likeCount: 0, dislikeCount: 0 };
    if (g.kind === "like") stat[g.reviewId].likeCount = g._count._all;
    else stat[g.reviewId].dislikeCount = g._count._all;
  }
  const myMap = {};
  for (const m of myRows) myMap[m.reviewId] = m.kind;

  return reviews.map((r) => ({
    ...r,
    likeCount: stat[r.id]?.likeCount ?? 0,
    dislikeCount: stat[r.id]?.dislikeCount ?? 0,
    myReaction: myMap[r.id] ?? null,
    authorRank: ranks[r.id]?.rank ?? null,
    authorReviewTotal: ranks[r.id]?.total ?? null,
  }));
}

export const REACTION_KINDS = new Set(["like", "dislike"]);