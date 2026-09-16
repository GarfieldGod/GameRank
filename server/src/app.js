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

app.use(cors());
app.use(express.json());

// 静态托管上传的图片
app.use("/uploads", express.static("uploads"));

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

// 全局错误处理：避免单个路由异常导致整个进程崩溃
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error:", err?.message ?? err);
  res.status(err?.status || 500).json({ error: err?.message || "Internal Server Error" });
});

export default app;