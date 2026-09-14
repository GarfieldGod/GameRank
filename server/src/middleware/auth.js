import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-long-random-secret";

// 校验请求头 Authorization: Bearer <token>
export function jwtAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "未登录，缺少令牌" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // 挂载到请求，后续业务路由使用 req.userId / req.username / req.role
    req.userId = payload.userId;
    req.username = payload.username;
    req.role = payload.role || "USER";
    next();
  } catch {
    return res.status(401).json({ error: "令牌无效或已过期" });
  }
}

// 管理员专属中间件：必须已登录且身份为 ADMIN 或 OWNER
export function adminOnly(req, res, next) {
  if (req.role !== "ADMIN" && req.role !== "OWNER") {
    return res.status(403).json({ error: "需要管理员权限" });
  }
  next();
}

// 站长专属中间件：仅 OWNER 站长可访问
export function ownerOnly(req, res, next) {
  if (req.role !== "OWNER") {
    return res.status(403).json({ error: "需要站长权限" });
  }
  next();
}