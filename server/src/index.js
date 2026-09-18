import "dotenv/config";
import app from "./app.js";
import prisma from "./prismaClient.js";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`[server] Database connected`);
  } catch (err) {
    console.error("[server] Database connection failed:", err.message);
  }
  console.log(`[server] Listening on http://localhost:${PORT}`);
});

// 优雅退出
async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 兜底：单个请求抛出的未捕获异常（如 Prisma 参数校验失败）只记录、不退出进程，
// 避免一次坏请求把整个后端打崩。业务路由应尽量自行 try/catch，这里保证进程存活。
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});