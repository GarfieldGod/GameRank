import rateLimit from "express-rate-limit";

const jsonMsg = (error) => ({ error });

// 以下限流均按客户端 IP 计数（生产反代后需 app.set("trust proxy", x) 才能拿到真实 IP）

// 登录：15 分钟内单个 IP 最多 20 次，遏制暴力破解
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: jsonMsg("登录尝试过于频繁，请 15 分钟后再试"),
});

// 注册：1 小时内单个 IP 最多 10 次，遏制批量注册
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: jsonMsg("注册过于频繁，请稍后再试"),
});

// 上传：1 小时内单个 IP 最多 60 次，遏制批量灌图
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: jsonMsg("上传过于频繁，请稍后再试"),
});