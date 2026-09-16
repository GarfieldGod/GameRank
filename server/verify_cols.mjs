import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const g = await p.game.findFirst();
console.log("game.deletedAt field:", Object.prototype.hasOwnProperty.call(g, "deletedAt"));
const r = await p.gameReview.findFirst();
console.log("review.deletedAt field:", Object.prototype.hasOwnProperty.call(r, "deletedAt"));
// counts
const [games, reviews] = await Promise.all([
  p.game.findMany({ where: { deletedAt: { not: null } } }),
  p.gameReview.findMany({ where: { deletedAt: { not: null } } }),
]);
console.log("soft-deleted games:", games.length, "reviews:", reviews.length);
await p.$disconnect();