# Game Score · 游戏评分与评测站

游戏评分与评测社区：Vue3 + Vite 前端，Express 后端，Prisma + SQLite 数据库。

## 目录结构

```
.
├── package.json                 # 根聚合脚本（install / dev / db:*）
├── README.md
├── client/                      # Vue3 + Vite 前端（暂未实现 UI）
│   ├── package.json
│   ├── vite.config.js           # 已配置 /api 代理 → 3000 端口
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── App.vue              # 占位根组件
│       └── assets/style.css
└── server/                      # Express 后端
    ├── package.json
    ├── .env                     # DATABASE_URL / PORT / JWT_SECRET
    ├── .gitignore
    ├── prisma/
    │   └── schema.prisma        # User / GameReview / Game 三张表
    └── src/
        ├── index.js             # 启动入口，连接 DB + 监听端口
        ├── app.js               # Express 实例，注册路由
        ├── prismaClient.js      # Prisma 客户端单例
        └── routes/
            ├── userRoutes.js    # /api/users
            └── reviewRoutes.js  # /api/reviews
```

## 数据库模型

- `User`：id, username(账号,唯一), password(加密哈希), avatar, bio, createdAt
- `GameReview`：id, gameName, coverImageUrl, title, content(markdown), rating, tags(JSON 数组), authorId(FK→User), publishedAt, updatedAt

## 主要接口

| 方法 | 路径 | 说明 | 鉴权 |
| ---- | ---- | ---- | ---- |
| POST | /api/auth/register | 注册 | - |
| POST | /api/auth/login | 登录，返回 JWT | - |
| GET | /api/auth/me | 当前用户 | JWT |
| GET | /api/users | 用户列表 | - |
| GET | /api/users/:id | 用户资料（头像/简介/创建时间） | - |
| PUT | /api/users/me | 编辑本人资料（avatar/bio） | JWT |
| GET | /api/games | 游戏列表（可选 keyword） | - |
| GET | /api/games/:id | 游戏详情（含该游戏评测分页） | - |
| POST | /api/games | 创建游戏 | ADMIN |
| DELETE | /api/games/:id | 删除游戏 | ADMIN |
| GET | /api/reviews | 评测列表（page/pageSize/keyword/tag/authorId） | - |
| GET | /api/reviews/:id | 评测详情 | - |
| POST | /api/reviews | 创建评测 | JWT |
| PUT | /api/reviews/:id | 更新评测（仅作者） | JWT |
| DELETE | /api/reviews/:id | 删除评测（作者或管理员） | JWT |
| POST | /api/uploads | 上传图片，返回 {url} | JWT |

列表接口参数：
- `page`、`pageSize`：分页，默认 1 / 10；`keyword`：标题或游戏名模糊搜索；`tag`：按标签精确筛选；`authorId`：按作者筛选。
- 响应结构：`{ list, total, page, pageSize }`，`list[].tags` 为字符串数组。

## 本地启动步骤

前置：Node.js ≥ 18。

```powershell
# 1. 安装前后端依赖（在项目根目录执行）
npm run install:all

# 2. 初始化 SQLite 数据库（在 server 目录执行 db:push 前需先生成客户端）
#    db:push 会自动创建 dev.db 并按 schema 建表
cd server
npx prisma generate
npx prisma db push
cd ..

# 3. 启动后端（另开一个终端）
npm run dev:server
#    预期输出: [server] Database connected
#              [server] Listening on http://localhost:3000

# 4. 启动前端
npm run dev:client
#    打开 http://localhost:5173
```

### 快速验证 API

```powershell
# 健康检查
curl http://localhost:3000/api/health

# 注册一个用户
curl -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"password\":\"123456\"}'

# 登录，获取 JWT（注意记录返回的 token）
curl -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"password\":\"123456\"}'

# 携带 JWT 创建一篇评测（authorId 自动取当前登录用户）
curl -X POST http://localhost:3000/api/reviews `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <上一步返回的 token>" `
  -d '{\"gameName\":\"塞尔达传说\",\"title\":\"旷野之息评测\",\"content\":\"# 正文\n很不错。\",\"rating\":9,\"tags\":[\"冒险\",\"开放世界\"]}'

# 查看评测列表
curl http://localhost:3000/api/reviews
```

## 说明

- `password` 使用 bcrypt 加密存储，接口不返回该字段。
- `tags` 在数据库中以 JSON 字符串存储，接口出入参均为数组。
- `publishAt` 默认取创建时间，`updatedAt` 由 Prisma 自动更新。
- 当前未做登录鉴权（JWT），骨架仅包含数据层与基础 CRUD 路由。