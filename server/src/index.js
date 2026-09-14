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