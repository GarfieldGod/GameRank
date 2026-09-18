import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import proposalRoutes from "./routes/proposalRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 生产前有 Nginx 等反代：信任第一跳代理，让 req.ip / 限流能取到真实客户端 IP。
// 未用反代时请设为 0（队列内部IP全为 ::1），以免伪造 X-Forwarded-For 绕过限流。
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? "1"));

// CORS：默认放行无 Origin 的请求（同源 / 非浏览器）与本地开发源；
// 生产若需跨域，通过环境变量 CORS_ORIGIN 以逗号分隔指定白名单，其余来源一律拒绝。
const DEV_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || DEV_ORIGINS.has(origin) || corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json({ limit: "2mb" }));

// 静态托管上传的图片：用绝对路径，避免启动目录不同导致找不到 uploads（与上传写入目录保持一致）
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 注册业务路由
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/proposals", proposalRoutes);
app.use("/api/admin", adminRoutes);

// 统一 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// 全局错误处理：避免单个路由异常导致整个进程崩溃。
// 记录原始错误到服务端日志；仅 <500 的业务/校验错误（如上传类型不合法）把可控 message 返回给前端，
// 其余内部异常统一返回通用信息，避免泄露表名/堆栈等内部细节。
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error:", err?.message ?? err);
  const status = Number(err?.status) || 500;
  if (status < 500) {
    return res.status(status).json({ error: err?.message || "请求不合法" });
  }
  res.status(500).json({ error: "服务器内部错误" });
});

export default app;