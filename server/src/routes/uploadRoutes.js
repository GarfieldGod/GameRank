import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { jwtAuth } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/rateLimit.js";

const router = Router();

// 上传目录：server/uploads
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 限定图片类型，随机文件名避免冲突
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("仅支持 png/jpg/gif/webp 图片");
      err.status = 400;
      cb(err);
    }
  },
});

// 上传图片：POST /api/upload（需登录）
// 限流置于 multer 解析之前，避免未过限流的请求先落盘再被拒
router.post("/", uploadLimiter, jwtAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "缺少文件" });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

export default router;