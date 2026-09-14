import { PrismaClient } from "@prisma/client";

// 全局单一 Prisma 客户端实例，避免开发热重载时连接溢出
const prisma = new PrismaClient();

export default prisma;