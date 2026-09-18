import { Router } from "express";
import { createHash } from "node:crypto";
import prisma from "../prismaClient.js";

const router = Router();

// 哈希盐：优先取环境变量，缺失时用内置常量，保证部署/重启后哈希一致，
// 否则既有记录用旧盐、新记录用新盐会导致同一 IP 无法再命中唯一去重。
const SALT = process.env.VISIT_SALT || "gamerank-visit-salt";

const pad = (n) => String(n).padStart(2, "0");
// 服务器本地自然日：统一按 YYYY-MM-DD 字符串存储，规避时区换算歧义
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hashIp = (ip) => createHash("sha256").update(`${SALT}|${ip}`).digest("hex").slice(0, 64);

// 前台页面加载时上报一次（无鉴权）：按 (IP哈希, 自然日) upsert 一条
router.post("/", async (req, res) => {
  try {
    // trust proxy 开启后 req.ip 已按 X-Forwarded-For 取真实客户端 IP；兼容 IPv4 映射写法
    const ip = String(req.ip || "").replace(/^::ffff:/, "").trim() || "unknown";
    const ipHash = hashIp(ip);
    const day = localDay();
    await prisma.visitLog.upsert({
      where: { ipHash_day: { ipHash, day } },
      update: { ipHash }, // 无字段可改，写回同值作为空更新
      create: { ipHash, day },
    });
    res.status(204).end();
  } catch (err) {
    // 访客统计不应影响页面可用性：失败也返回 204
    console.error("[visit] record failed:", err?.message ?? err);
    res.status(204).end();
  }
});

export default router;