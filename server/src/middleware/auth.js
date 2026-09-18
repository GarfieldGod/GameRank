import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // 缺失时直接拒绝启动，避免回退到仓库里的弱值被用来伪造令牌
  throw new Error("服务器环境变量 JWT_SECRET 缺失：请设置随机强密钥后启动");
}

// 校验请求头 Authorization: Bearer <token>
// 角色以数据库实时值为准：令牌仅作登录凭证，不信任其中的 role 快照，
// 这样提拔/降职后无需重新登录即可立即生效。
export async function jwtAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "未登录，缺少令牌" });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "令牌无效或已过期" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, tokenVersion: true },
  });
  if (!user) {
    return res.status(401).json({ error: "用户不存在，登录已失效" });
  }
  // 令牌版本与数据库不一致：该密码已修改等敏感变更发生在别处，本登录已作废，强制下线
  if (user.tokenVersion !== payload.tokenVersion) {
    return res.status(401).json({ error: "登录已失效，请重新登录", code: "TOKEN_STALE" });
  }

  req.userId = user.id;
  req.username = payload.username;
  req.role = user.role;
  next();
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

// 可选登录：携带有效令牌则解析登录态，否则放行（req.userId / req.role 可能为空）
export async function optionJwtAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, tokenVersion: true },
      });
      // 令牌失效（版本不符：已在别处改密码等）同样视为未登录
      if (user && user.tokenVersion === payload.tokenVersion) {
        req.userId = user.id;
        req.role = user.role;
      }
    } catch {
      // 令牌无效视为未登录
      req.userId = undefined;
      req.role = undefined;
    }
  }
  next();
}