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

## 数据管理 CLI（站长）

用于批量管理游戏 / 评测数据的命令行工具，仅站长在**服务器端**执行。它复用录入与导入逻辑，但**不经过 Web 层、不需要登录令牌**，并把"导入前自动备份"固化为默认行为，比网页导入更稳妥。

脚本：`server/scripts/data-cli.mjs`，支持的命令：

| 命令 | 作用 |
| ---- | ---- |
| `games export` | 导出游戏全部字段到 `data/games.json` |
| `reviews export` | 导出评测全部字段到 `data/reviews.json` |
| `games import --file <路径>` | 导入游戏（按中文名：存在则更新、否则新增） |
| `reviews import --file <路径>` | 导入评测（按 id：存在则更新、否则新增） |
| `import --dry-run` | 只预览新增/更新/跳过数量，不写库、不备份 |
| `backup` | 一键备份游戏与评测到 `backups/<时间戳>/` |

> 所有导入**执行前都会自动备份**现有数据到 `backups/` 目录，便于回滚。

### 常用操作（在 `server/` 目录执行）

```powershell
# 1) 日常备份（游戏 + 评测）
npm run data:backup

# 2) 导出游戏数据
npm run data:export:games             # 生成 data/games.json

# 3) 导入前先预览（dry-run，绝不写库）
npm run data:diff -- --file ./data/games.json

# 4) 确认无误后真正导入（导入前会自动备份）
npm run data:import:games -- --file ./data/games.json

# 5) 导入评测
npm run data:import:reviews -- --file ./path/to/reviews.json
```

### 典型场景：跨环境迁移

```powershell
# 旧服务器：导出游戏
npm --prefix server run data:export:games
# 把 data/games.json 上传到新服务器，然后：
npm --prefix server run data:diff -- --file ./data/games.json   # 先预览
npm --prefix server run data:import:games -- --file ./data/games.json
```

### 回滚

若某次导入结果不如预期，用之前备份的文件反向恢复即可（按 id 更新回正确内容）：

```powershell
npm run data:import:reviews -- --file ./backups/<时间戳>/reviews.json
```

### 说明

- 文件路径相对 `server/` 解析；`--file` 参数为必填。
- 导出/导入遵循游戏按中文名、评测按 id 的"存在更新、否则新增"规则。
- `data/` 与 `backups/` 目录已加入 `.gitignore`，不会被提交。

## 说明

- `password` 使用 bcrypt 加密存储，接口不返回该字段。
- `tags` 在数据库中以 JSON 字符串存储，接口出入参均为数组。
- `publishAt` 默认取创建时间，`updatedAt` 由 Prisma 自动更新。
- 当前未做登录鉴权（JWT），骨架仅包含数据层与基础 CRUD 路由。