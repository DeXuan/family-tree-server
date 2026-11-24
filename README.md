# 家族族谱管理系统

> 单家族自托管 · 零构建前端 · 内嵌数据库开箱即用 · 598 项自动化测试

面向单一家族自建自用的族谱管理系统。以结构化数据记录成员、亲属关系与家族记忆，支持多世代世系树展示、检索筛选、权限分级与完整的数据导入导出。

当前版本已覆盖**阶段 1（MVP）+ 阶段 2 主体能力**，含五世同堂演示数据，可直接投入使用。

---

## 1. 已实现功能

| 模块 | 状态 | 说明 |
|---|---|---|
| 成员信息管理 | ✅ | 姓/名/字/号、字辈、世代、支系、生卒日期（带精度）、地点、职业、学历、生平 |
| 亲属关系维护 | ✅ | 亲子关系（生/养/继/抚/认 + 确信度）、婚姻（婚/伴侣/妾 + 存续状态）；环路检测、年龄逻辑校验、疑似重复提示 |
| 世系树展示 | ✅ | 夫妻合并为一户、子女唯一展开、逐级折叠、支系筛选、成员定位、移动端适配 |
| 检索筛选 | ✅ | 全名片段（“王德”可命中“王德昌”）、曾用名、字号、字辈；按世代/支系/在世状态组合过滤；分页 |
| 审计日志 | ✅ | 登录、增删改、导入导出全留痕，记录改前/改后值与操作者 |
| 数据导入导出 | ✅ | Excel（.xlsx）、GEDCOM 5.5.1（.ged）、全量 JSON；导入走“解析预览 → 冲突检测 → 人工确认” |
| 用户与角色 | ✅ | 管理员 / 谱系编辑 / 族人；管理员可建号、改角色、停用/删除账户、绑定成员节点 |
| 字段级隐私分级 | ✅ | L0 公开 / L1 族内 / L2 私密；接口层脱敏（非前端隐藏）；已故满百年自动放宽 |
| 个人中心 | ✅ | 本人联系方式维护、逐字段隐私设置、查看绑定关系 |
| 邀请制注册 | ✅ | 管理员生成限时/限次邀请，注册页校验后自动建号并绑定成员 |
| 生平事件 | ✅ | 时间线 CRUD，支持 13 类事件、日期精度、逐事件可见级别（L0/L1/L2） |
| 关系路径 | ✅ | 任意两人共同祖先与代数差（详情页“与某人的关系”） |
| 账户安全 | ✅ | 改密后旧令牌立即失效、连续 5 次失败锁定 15 分钟、密码 ≥8 位 |
| 备份与恢复 | ✅ | 管理员一键快照（含账户与关系）、下载/删除；CLI 事务恢复 + dry-run + 单写者锁保护 |
| 敏感字段加密 | ✅ | 联系方式 AES-256-GCM 静态加密；历史明文启动时自动迁移 |
| 输入校验 | ✅ | 姓名/简介长度、性别/精度/事件类型枚举、日期范围统一校验 |
| 媒体库 | ✅ | 照片/音频/视频/PDF 上传（15MB、类型白名单）、人物相册、L0/L1/L2 可见级别、鉴权流式读取 |
| 归档清理 | ✅ | 管理员永久清理归档成员及其关系/事件/媒体文件（先解绑账户） |
| 备份调度 | ✅ | 可配置自动备份间隔与保留份数；手动 prune、下载、删除 |
| 变更提案 | ✅ | 族人提交修改建议，管理员通过/驳回；通过后写入并记审计 |
| 重复检测与合并 | ✅ | 姓名+出生年查重；合并时自动转移亲子/婚姻/事件/媒体/账户绑定 |
| 祖先与沙漏视图 | ✅ | 上溯祖先链（父母/祖父母/曾祖/高祖）+ 中心与后裔，形成沙漏图 |
| 双布局世系树 | ✅ | 缩进列表（默认）与自上而下结构图（org-chart）一键切换；结构图绘制父子连线，支持逐节点展开/收起、缩放 50–150%、滚动查看；切换布局保留收起集合与选中节点 |
| 深浅色主题 | ✅ | 跟随系统或手动切换（顶栏按钮），选择本地记忆；表格/卡片/连线/弹窗全量适配 |
| 曾用名 | ✅ | 录入、编辑、详情展示，并参与姓名检索 |
| 审计变更详情 | ✅ | 审计日志可展开 before/after 原文，便于追溯争议修改 |
| 来源与引文 | ✅ | 来源库（题名/作者/出版/藏地）；人物与事件挂引文（卷页、可信度、考证说明） |
| 事件出处 | ✅ | 时间线事件显示引文数量，可一键补来源 |
| SVG 导出 | ✅ | 服务端生成宗谱 SVG（姓名/配偶/生卒/世代），世系树与沙漏页可下载 |
| 中文称谓推导 | ✅ | 直系/旁系/姻亲/堂表/伯叔姑舅姨/侄甥；给出称谓、反向称谓、五服内外与依据 |
| 五服范围 | ✅ | 以任意成员为中心，上五下五（含配偶）的亲属集合 |
| 家族洞察 | ✅ | 人丁结构、字辈图谱与断裂检测、代际寿数、地域分布、家族年表、一键复制摘要 |
| 字辈派语校验 | ✅ | 族内配置派语（如「守德建明一」），洞察页给出取名符合度；姻亲自动排除，不误判 |
| 方言称谓 | ✅ | 吴/粤/闽南/客家/西南/胶辽六区词表；称谓弹窗并列显示标准与方言，支持对照表预览 |
| 收藏地实体 | ✅ | 档案馆/藏书楼可复用的 Repository，与来源多对一关联；删除前提示引用数 |
| 沙漏 SVG 导出 | ✅ | 上溯祖先 + 下延后裔的单图合成，SVG 可直接下载/打印 |
| 祖先盘图表 | ✅ | 扇形同心环，左父系右母系，逐代外扩；SVG 下载 |
| 服务端 PDF | ✅ | 无头 Chromium 直接输出 PDF（宗谱/个人谱/洞察报告），票据一次性 |
| 地图瓦片（可选） | ✅ | 默认纯离线自绘；配置 `MAP_TILE_URL` 后叠加真实底图，CSP 自动放行 |
| 自定义关联角色 | ✅ | 内置 11 种 + 家族自定义（≤30 个），人物页可管理 |
| 方言词条自定义 | ✅ | 六区词表之上可逐条覆盖（如「父亲」→「阿爹」），称谓推导即时生效 |
| PWA / 离线 | ✅ | manifest + Service Worker，断网可打开登录页；API 一律不缓存 |
| 多家族（多租户） | ✅ | AsyncLocalStorage 请求级隔离，家族切换器，跨家族数据不串 |
| 旧谱 OCR 适配 | ✅ | 可插拔 OCR 后端 + 繁简/竖排/噪声清理管线 |
| 世系凡例 | ✅ | 男/女/已故/配偶/折叠符号说明，避免符号误读 |
| 口述/表格建谱 | ✅ | 一段话或粘贴表格 → 解析草稿 → 人工校对 → 确认导入；不确定关系给提示 |
| 地点库与迁徙 | ✅ | 地点规范名+别名归一、成员自动归类、省份分布、未收录地名、迁徙路径（事件驱动）；地点可设上级层级、可合并 |
| 人物关联 | ✅ | 义亲/义子/见证人/雇主/雇员/邻里/好友/师承/门生/继承人，双向可见（GEDCOM 7 ASSO 思路） |
| 资料完整度 | ✅ | 八项加权核查、待补项分布、最需补录榜、按缺项/阈值筛选、勾选批量维护 |
| 批量编辑 | ✅ | 选中多人批量改支系/世代/字辈（仅限这三项，避免误改敏感字段） |
| 乐观锁 | ✅ | 编辑时携带 `expectedUpdatedAt`，他人在此期间改动则返回 409 并提示刷新 |
| 故事与回忆录 | ✅ | 长文/口述整理，轻量 Markdown（先转义再渲染，防 XSS），可关联多位人物与署名，L0/L1/L2 可见级别，人物页反查；正文可内嵌照片并按时过滤 |
| 双因素认证（2FA） | ✅ | TOTP（RFC 6238，纯 crypto 实现）双步登录，二维码 URI、10 个一次性恢复码，启用/关闭需密码确认 |
| 地点地图 | ✅ | 内嵌 SVG 本地绘制（经纬度投影+迁徙连线），**零外部地图服务**，隐私友好 |
| 打印/PDF | ✅ | 专用宗谱打印页（封面/凡例/世系表），浏览器打印即另存 PDF，含 `@media print` 样式 |
| 故事版本历史 | ✅ | 每次编辑自动快照，版本列表/详情、一键回滚（回滚前状态也保存为版本） |
| 关系与事件乐观锁 | ✅ | 事件编辑、婚姻状态变更携带 `expectedUpdatedAt`，冲突返回 409 |
| 大谱保护 | ✅ | 世系树 2000 节点预算 + 截断提示 + 支系筛选；前端分支折叠 |
| 图片尺寸元数据 | ✅ | 上传时解析 PNG/JPEG/GIF/WebP 尺寸，列表按尺寸优化布局 |
| 统一异步错误处理 | ✅ | `wrapAll()` 原地包装所有 router 的 async handler，异常统一转 500 JSON（不再挂起请求） |
| 结构化日志 | ✅ | 单行 JSON 日志（级别/reqId/耗时），服务端零 `console.*`；错误含 message/code/stack |
| 请求体统一校验 | ✅ | `validateBody` 生成 400 与明确字段名，覆盖鉴权、关联、故事等写接口 |
| 慢查询可观测 | ✅ | `SLOW_QUERY_MS`（默认 500ms）超阈值结构化告警；失败查询记录 SQL 摘要 |
| 生平事件时间线 / 媒体库 / 故事 | ⏳ 阶段 2/3 | schema 注释中预留 |
| 隐私查看申请流 | ⏳ 阶段 3 | — |

> 演示家族为**五世同堂**：1926 → 1949 → 1972 → 1997 → 2021，五代 20 人全部在世，世系树默认完整展开五代。
> 已有数据库可用 `npm run demo:five` 将演示成员批量调整为在世（仅匹配演示姓名，不影响其他数据）。
>
> 本版本没有开放注册接口。账户只能由管理员在「管理后台 → 用户与角色」中创建，或通过邀请链接注册。

---

## 2. 技术栈

- **后端**：Node.js ≥ 18、Express 4、JWT、bcrypt、helmet、express-rate-limit
- **数据库**：默认 **PGlite**（内嵌 WASM PostgreSQL，零安装，数据落在 `./data/pgdata`）；生产可切换标准 **PostgreSQL**
- **前端**：原生 ES Modules + 单页 hash 路由，无构建步骤，移动端适配
- **导入导出**：exceljs、自研 GEDCOM 5.5.1 读写
- **测试**：自研 HTTP 冒烟测试 + Playwright（复用本机 Chrome）

单元测试 271 项、后端 API 断言 207 项、并发一致性 5 项、浏览器 UI 断言 115 项，共 598 项断言，全部通过。

---

## 3. 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备配置（默认使用 PGlite，无需安装数据库）
cp .env.example .env      # Windows CMD: copy .env.example .env

# 3. 启动（首次启动自动建表并播种演示数据）
npm start
```

打开 http://localhost:3000

演示账户：

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 管理员 |
| `editor` | `editor123` | 谱系编辑 |

> 首次登录后请立即点击右上角「改密」修改管理员密码。生产部署前务必修改 `.env` 中的 `JWT_SECRET`。

### 切换 PostgreSQL

```bash
# .env
DATABASE_URL=postgres://user:pass@localhost:5432/family_tree
```

首次启动会自动执行 `server/db/schema.sql` 建表；空库时自动播种（`SEED_ON_EMPTY=false` 可关闭）。两个驱动使用完全相同的 SQL，无需改代码。

---

## 4. 目录结构

```
family-tree-server/
├── server/
│   ├── index.js              # 入口：中间件 + 路由 + 静态资源（<100 行）
│   ├── config/index.js       # 集中配置
│   ├── db/
│   │   ├── db.js             # PGlite / PostgreSQL 双驱动 + 事务 + 初始化
│   │   └── schema.sql        # 表结构（family/person/parent_child/marriage/users/audit_log…）
│   ├── middleware/
│   │   ├── auth.js           # JWT 校验 + adminOnly / editorUp
│   │   ├── wrapRouterAsync.js # 零侵入包装 async 路由错误处理
│   │   ├── validateBody.js   # 统一请求体校验
│   │   ├── params.js         # UUID 参数校验
│   │   ├── validation.js     # 成员/事件字段校验
│   │   └── password.js       # bcrypt 封装
│   ├── routes/
│   │   ├── auth.js           # 登录 / me / 改密 / 退出
│   │   ├── persons.js        # 成员 CRUD + 检索
│   │   ├── relations.js      # 亲子 / 婚姻 + 环路与年龄校验
│   │   ├── tree.js           # 世系树 + 关系路径
│   │   ├── stats.js          # 概览统计
│   │   ├── admin.js          # 用户、角色、绑定、审计日志
│   │   ├── me.js             # 个人中心：本人资料与隐私
│   │   ├── invitations.js    # 邀请校验（公开）
│   │   ├── events.js         # 生平事件 CRUD + 可见级别
│   │   ├── media.js          # 媒体上传/相册/鉴权读取/删除
│   │   ├── changeRequests.js # 变更提案提交/审批
│   │   ├── maintenance.js    # 重复检测 + 成员合并
│   │   ├── sources.js        # 来源库 CRUD
│   │   ├── citations.js      # 人物/事件引文
│   │   ├── narrativeImport.js # 口述建谱预检/提交
│   │   ├── places.js         # 地点库与迁徙（含层级/合并）
│   │   ├── associations.js   # 人物关联（义亲/师承等）
│   │   ├── quality.js        # 完整度核查 / 待补 / 批量编辑
│   │   ├── stories.js        # 故事与回忆录
│   │   ├── exportImport.js   # 导入导出流程
│   │   └── audit.js          # 审计写入
│   └── modules/
│       ├── excel.js          # Excel 读写
│       └── gedcom.js         # GEDCOM 5.5.1 读写
├── public/
│   ├── index.html
│   ├── styles.css            # 设计系统（宣纸/墨/朱砂）
│   └── js/
│       ├── app.js            # 路由 + 应用外壳
│       ├── api.js            # 统一 HTTP 客户端（令牌/401 处理/下载）
│       ├── ui.js             # 转义、日期、Toast、弹窗、徽章
│       ├── components/       # 世系树、成员选择器
│       ├── lib/format.js     # 纯格式化函数（可在 Node 单测）
│       └── views/            # login/register/dashboard/tree/hourglass/insights/places/quality/stories/print/people/person/personForm/me/admin
├── tests/                    # node:test：隐私/加密/GEDCOM/备份/称谓/洞察/格式化 等 89 项
├── scripts/
│   ├── demo-data.mjs         # 演示世家数据（纯数据，五世同堂）
│   ├── make-five-generations.mjs  # 把已有演示库调整为五代在世
│   ├── seed.js
│   ├── restore.js            # 恢复 CLI（停机执行，支持 --dry-run）
│   ├── concurrency-test.mjs  # 并发一致性（乐观锁/唯一约束/无 500）               # 演示数据（20 人 / 5 代 / 6 组婚姻）
│   ├── smoke-test.mjs        # 后端 API 冒烟测试
│   └── ui-test.mjs           # 浏览器 UI 回归（需本机 Chrome）
├── screenshots/              # UI 测试产出的页面截图
├── .github/workflows/ci.yml  # CI：单元测试 + 启动服务跑 API 回归
├── ecosystem.config.cjs      # PM2 配置（单实例，PGlite 只允许单写者）
├── deploy.sh / deploy.bat
└── nginx.conf.example
```

---

## 4.5 开源项目借鉴

调研对象与借鉴点（GitHub 仓库 + 项目文档）：

| 项目 | 借鉴内容 | 本项目落地 |
|---|---|---|
| [webtrees](https://github.com/fisharebest/webtrees)（[功能页](https://webtrees.net/features/)） | 协作编辑与 pending changes、按站点/族谱/用户/记录/事实分级隐私、角色权限、成员合并、祖先/后代/沙漏等图表 | 变更提案审核流；L0/L1/L2 字段隐私；admin/editor/member/guest 角色；成员查重与合并；世系树 + 沙漏视图 |
| [Gramps Web](https://github.com/gramps-project/gramps-web)（[文档](https://www.gramps-project.org/wiki/index.php/Gramps_Web)、[数据模型](https://www.gramps-project.org/wiki/index.php/Gramps_Data_Model)） | 人物/家庭/事件/地点/来源/引文/媒体/备注的对象模型；**地点层级（enclosed_by）**；**合并时逐项选择主记录**；姓名/地址可挂引文 | 分表与关系实体化；四种角色；邀请注册；来源库+引文；**地点层级（parent_id）与地点合并（别名并入）**；人员合并已转移引文/媒体/关联 |
| [GEDCOM 7.0](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html) | `ASSO`/`ROLE` 表达非家庭关联（义亲、见证、师承）；多 `NAME` 表示偏好顺序；日期分 DateValue/Exact/Period | **人物关联表（11 种角色，双向可见）**；曾用名数组参与检索；日期精度三元组（exact/year/about/range） |
| [Ancestris](https://www.ancestris.org/) | "30 种工具"里的批量编辑与 Places Editor 思路、数据质量检查 | **批量改支系/世代/字辈**、**资料完整度八项加权核查 + 待补清单 + 批量维护** |
| [Topola](https://github.com/PeWu/topola)（[演示](https://pewu.github.io/topola/)） | Hourglass / Ancestors / Descendants / Kinship 等图表，支持 SVG 下载与打印 | 祖先链 API、“沙漏世系”页、**服务端 SVG 世系图导出**；打印排版列为后续 |
| [family-chart](https://github.com/donatso/family-chart)（[文档](https://donatso.github.io/family-chart/)） | 交互式人物卡片、编辑表单、校验与撤销/重做 | 卡片式世系树、统一输入校验、变更提案；撤销/重做列为后续 |

| [一脉 · 家谱与家族洞察](https://yimai-genealogy.app.workbuddy.host/)（单文件在线族谱） | 以任意成员为重心的世系重排、中文称谓推导（含五服）、口述/表格批量建谱、六类家族洞察（含字辈断裂检测）、凡例与谱名仪式感、整谱摘要复制 | 称谓推导与五服 API+弹窗、家族洞察页（人丁/字辈/寿数/地域/年表）、凡例、复制摘要、**以某人为中心**的沙漏视图、**口述/表格建谱（预览+确认+查重）**；其单文件离线架构不采纳，代之以服务端多用户与权限 |

> 说明：调研期间 GitHub 直连受限，功能信息取自上述项目官方文档与演示页；仓库地址用于标注出处。
> 「一脉」为单文件离线应用，其**优点**已吸收；其**不足**（无账户/权限、无审计、无来源考证、无检索分页、扁平 father/mother、无媒体、无隐私分级）在本项目中均已有对应方案，不复刻。

## 5. 数据模型要点

- `person` 与 `users` 分离：先人、未成年人不占用账户；`users.person_id` 预留给阶段 2「本人绑定」。
- 亲子与婚姻是**关系实体**，不是成员表上的外键；支持养/继/过继、多婚、历史多配偶，并记录确信度。
- 兄弟姐妹、叔侄、祖孙等旁系**不入库**，由树视图运行时推导，从根上避免两边记录不一致。
- 日期统一为 `date + precision + date_end` 三元组，支持“仅知年份 / 大约 / 区间”。
- 删除成员为**归档**（`status='archived'`），不物理删除家史；删除权限仅管理员。
- 所有写操作写入 `audit_log`，保留 `before / after` 快照。

---

## 6. 权限矩阵（当前实现）

| 能力 | 管理员 | 谱系编辑 | 族人 |
|---|:---:|:---:|:---:|
| 查看成员与世系树 | ✓ | ✓ | ✓ |
| 新增 / 修改成员与关系 | ✓ | ✓ | ✗ |
| 删除（归档）成员 | ✓ | ✗ | ✗ |
| 用户、角色、停用账户 | ✓ | ✗ | ✗ |
| 查看审计日志 | ✓ | ✗ | ✗ |
| 导入 / 导出全量数据 | ✓ | ✗ | ✗ |
| 查看本人 L2（联系方式） | ✓ | ✓（仅本人） | ✓（仅本人） |
| 查看他人 L2 | ✓ | ✗ | ✗ |

编辑权限目前按角色全族生效，`user_family_role.scope_branch`（按支系限定编辑范围）在阶段 2 启用。

---

## 7. API 一览

```
POST   /api/auth/login                  登录（限速 20 次 / 10 分钟）
GET    /api/auth/me                     当前用户
POST   /api/auth/change-password        修改密码
POST   /api/auth/login/2fa              2FA 第二步（验证码/恢复码）
GET    /api/auth/2fa/status             我的 2FA 状态
POST   /api/auth/2fa/setup              生成 TOTP 密钥
POST   /api/auth/2fa/enable             验证并开启 2FA
POST   /api/auth/2fa/disable            关闭 2FA（需密码）
POST   /api/auth/2fa/recovery           重置恢复码（需密码）

GET    /api/persons                     列表/检索（keyword/gen/branch/deceased/page/pageSize）
GET    /api/persons/:id                 成员详情
POST   /api/persons                     新增成员（editor+）
PUT    /api/persons/:id                 修改成员（editor+）
DELETE /api/persons/:id                 归档成员（admin）

GET    /api/relations/:personId/relations直接亲属（父母/配偶/子女）
POST   /api/relations/:personId/parents 添加父母（含环路/年龄/重复校验）
DELETE /api/relations/:personId/parents/:parentId
POST   /api/relations/:personId/spouses 添加婚姻
DELETE /api/relations/:personId/spouses/:unionId

GET    /api/tree                        世系树（root/depth/branch/gen）
GET    /api/tree/path?a=&b=             最近共同祖先与距离
GET    /api/tree/ancestors/:personId    祖先链（沙漏视图数据）
GET    /api/tree/export.svg             导出世系 SVG（root/depth/title）
GET    /api/tree/hourglass.svg          沙漏 SVG（focus/up/down/title）
GET    /api/tree/ancestors.svg           祖先盘 SVG（focus/depth/title）
GET    /api/export/pdf/capability        PDF 能力探测
POST   /api/export/pdf/ticket            签发一次性 PDF 票据
GET    /api/export/pdf/render?ticket=    渲染并下载 PDF
GET    /api/families                     可访问家族列表
POST   /api/families                     新建家族（admin）
PUT    /api/families/current             改当前家族（本家族 admin）
DELETE /api/families/:id                 删除家族（需输入名称确认）
GET    /api/associations/roles           关联角色清单（内置+自定义）
POST   /api/associations/roles           新增自定义角色
DELETE /api/associations/roles/:key      删除自定义角色
GET    /api/admin/dialect-overrides      方言自定义词条
PUT    /api/admin/dialect-overrides      新增/覆盖词条
DELETE /api/admin/dialect-overrides      删除词条
GET    /api/import/ocr/capability        OCR 能力探测
POST   /api/import/ocr                   上传旧谱图片识别
POST   /api/import/ocr/clean             仅清理 OCR 文本
GET    /api/tree/kinship/dialects       方言称谓对照表（dialect）
GET    /api/tree/kinship?a=&b=          中文称谓推导（含反向称谓、五服判断）
GET    /api/tree/five-fu?center=        五服范围内的亲属
GET    /api/tree/insights               六类家族洞察
POST   /api/import/narrative/preview    口述/表格解析预览（不落库）
POST   /api/import/narrative/commit     确认导入草稿
GET    /api/repositories                收藏地列表（含引用计数）
POST   /api/repositories                新建收藏地（editor+）
PUT    /api/repositories/:id            修改收藏地（editor+）
DELETE /api/repositories/:id?force=1    删除收藏地（admin，被引用需 force）
GET    /api/places                      地点库 + 成员归类 + 待收录
GET    /api/places/stats                省份分布
GET    /api/places/migrations           迁徙路径
GET    /api/places/map                  地图数据（坐标+迁徙连线）
POST   /api/places / PUT / DELETE      地点维护（admin）
POST   /api/places/merge                合并地点（admin）

GET    /api/associations/person/:id     某成员的双向关联
POST   /api/associations                新建关联（editor+）
DELETE /api/associations/:id            删除关联（editor+）

GET    /api/quality/completeness        完整度总览
GET    /api/quality/incomplete          待补清单（按缺项/阈值）
GET    /api/quality/search              名录质量筛选
POST   /api/quality/bulk-update         批量改支系/世代/字辈（editor+）

GET    /api/stories                     故事列表（含摘要、关联人物）
GET    /api/stories/:id                 故事详情（含渲染后 HTML）
GET    /api/stories/person/:personId    某人参与的故事
POST   /api/stories                     新建故事（editor+）
PUT    /api/stories/:id                 修改故事（editor+）
DELETE /api/stories/:id                 删除故事（admin）
GET    /api/stories/:id/versions        版本列表
GET    /api/stories/:id/versions/:n     版本详情
POST   /api/stories/:id/versions/:n/restore回滚（admin）
PUT    /api/events/:id                  修改事件（支持乐观锁）
PUT    /api/relations/spouses/:id       修改婚姻状态（支持乐观锁）
GET    /api/stats                       概览统计

POST   /api/auth/register               凭邀请注册（自动绑定成员并登录）
GET    /api/invitations/:token          公开校验邀请链接

GET    /api/events/:personId            成员生平事件（按可见级别过滤）
POST   /api/events/:personId            新增事件（editor+）
PUT    /api/events/:eventId             修改事件
DELETE /api/events/:eventId             删除事件

POST   /api/media/person/:personId      上传媒体（editor+，multipart: file/visibility/caption）
GET    /api/media                       全部图片列表（故事插图用）
GET    /api/media/person/:personId      成员媒体列表（按可见级别过滤）
GET    /api/media/:id/file              鉴权读取原文件
DELETE /api/media/:id                   删除媒体及原文件

POST   /api/change-requests             提交修改建议（族人）
GET    /api/change-requests/mine        我的修改建议
GET    /api/change-requests             待审核列表（admin）
POST   /api/change-requests/:id/approve 通过并应用（admin）
POST   /api/change-requests/:id/reject  驳回（admin）

GET    /api/sources                     来源库列表（含引用次数）
POST   /api/sources                     新建来源（editor+）
PUT    /api/sources/:id                 修改来源（editor+）
DELETE /api/sources/:id                 删除来源并级联引文（admin）
GET    /api/citations?targetType=&targetId=某对象的引文
POST   /api/citations                   添加引文（editor+）
DELETE /api/citations/:id               删除引文（editor+）

GET    /api/admin/duplicates            疑似重复成员（admin）
POST   /api/admin/merge                 合并成员（admin）

GET    /api/me                          当前账户 + 绑定成员 + 生效隐私级别
PUT    /api/me/profile                  本人联系方式（L2）
PUT    /api/me/privacy                  本人字段隐私设置

GET    /api/admin/users                 用户列表（admin）
POST   /api/admin/users                 新建账户（admin）
PUT    /api/admin/users/:id/role        修改角色（admin）
PUT    /api/admin/users/:id/status      启用/停用（admin）
PUT    /api/admin/users/:id/person      绑定/解绑成员节点（admin）
DELETE /api/admin/users/:id             删除账户（admin，保护自己与最后一名管理员）
GET    /api/admin/invitations           邀请列表（admin）
POST   /api/admin/invitations           生成邀请（admin）
POST   /api/admin/invitations/:id/revoke撤销邀请（admin）
DELETE /api/admin/invitations/:id       删除邀请记录（admin）
POST   /api/admin/backup                生成备份快照（admin）
GET    /api/admin/backups               备份列表（admin）
GET    /api/admin/backups/:file         下载备份（admin）
DELETE /api/admin/backups/:file         删除备份（admin）
POST   /api/admin/backups/prune         只保留最近 N 份（admin）
POST   /api/admin/purge-archived        永久清理归档成员及媒体（admin）
GET    /api/admin/audit                 审计日志（admin）

GET    /api/export/json|excel|gedcom    导出
POST   /api/import/preview              上传解析 + 冲突检测（不落库）
POST   /api/import/commit               确认导入（previewId，15 分钟有效）
```

---

## 8. 测试

```bash
# 后端 API 冒烟测试（需服务已启动）
node scripts/smoke-test.mjs

# 浏览器 UI 回归（需本机安装 Chrome，会产出 screenshots/）
node scripts/ui-test.mjs
```

覆盖点包括：五世同堂数据（5 代在世）、称谓推导（高祖父/玄孙/曾叔祖父/同胞妹妹）、五服范围、家族洞察（人丁/字辈/地域/年表）、登录与错误密码/锁定、邀请注册与失效、改密令牌失效、统计、列表筛选、全名搜索、世系树完整 1–5 世、环路拦截、父母年龄差拦截、审计日志、三种格式导出、GEDCOM 预览与导入往返、事件可见级别、关系路径、备份生成/下载/删除、隔离目录恢复与行数核对、媒体上传与 L1/L2 鉴权、输入校验、非法 UUID 返回 400 且服务存活、隐私脱敏、未授权访问 401、各页面渲染、响应式布局、浏览器控制台零错误。

一键全量：`npm run test:all`（单元 → API → 并发 → UI）。

CI（`.github/workflows/ci.yml`）在每次 push/PR 跑单元测试并启动服务执行 API 回归；UI 回归需本机 Chrome，建议发版前本地执行 `npm run test:ui`。

**并发一致性**（`npm run test:concurrency`）验证：10 个并发编辑同一成员时恰好 1 个成功、9 个 409；并发添加同一亲子关系/婚姻不产生重复；并发编辑故事无 500 且版本快照数与成功次数一致。

---

## 9. 安全与隐私现状

**已实现**

- 仅邀请制注册：邀请可限时、限次、绑定到具体成员；无公开注册入口
- 改密后 `token_version` 自增，旧 JWT 立即失效；连续 5 次失败锁定 15 分钟
- 字段级隐私分级：L0 公开（姓名/字辈/世代/支系/生卒年份）、L1 族内（日期/地点/职业/生平）、L2 私密（联系方式）
- L2 联系方式 AES-256-GCM 静态加密；密钥优先 `DATA_ENCRYPTION_KEY`，缺省由 `JWT_SECRET` 派生
- 备份文件包含密码哈希与密文，权限 0600；恢复需停机并二次确认；媒体元数据入备份，原文件需单独备份 `uploads/`
- 媒体文件不暴露静态目录：必须经 `/api/media/:id/file` 鉴权，按 L0/L1/L2 控制；排除 SVG 等可执行内容
- 开发环境（非 `production`）回环地址跳过登录/注册限速，便于自动化回归；PM2 启动时 `NODE_ENV=production`，限速严格生效
- 脱敏在接口层执行：未授权字段直接置空并标记 `restricted`，不依赖前端隐藏
- 已故满 100 年自动放宽 L1 → L0；本人可逐字段调整为「仅本人与管理员」
- 世系树接口只返回出生/去世年份，不泄露精确日期
- 全站 helmet 安全头 + CSP（禁止内联脚本/样式）
- 登录失败统一文案（防用户名枚举）+ 速率限制
- 密码 bcrypt 哈希；JWT 7 天有效期
- 接口逐请求鉴权；删除仅管理员；导入导出仅编辑以上
- 全量审计日志（含 before/after）
- 导入不静默覆盖：预览、冲突检测、人工确认
- UUID 主键，成员 id 不可枚举

**尚未实现（阶段 2 剩余，上线给族人前建议补齐）**

- 未成年人默认最高隐私与监护人规则
- 2FA、隐私查看申请与审批流
- 敏感字段（联系方式、证件号）应用层加密
- 自动备份与恢复演练

**部署建议**

- 家庭 NAS / 自有服务器优先，数据主权在家族内部
- 公网暴露必须启用 HTTPS（Nginx 反向代理 + 证书）
- 定期备份：PGlite 需先停服务再复制 `data/pgdata`；PostgreSQL 用 `pg_dump`

---

## 9.5 备份与恢复

```bash
# 生成 / 下载 / 删除：管理后台 → 数据导入导出 → 备份快照
# 或 API：POST /api/admin/backup、GET /api/admin/backups/:file

# 恢复（必须先停止服务；PGlite 单写者）
node scripts/restore.js backups/family-tree-YYYYMMDD-HHmmss-xxxx.json --dry-run
node scripts/restore.js backups/family-tree-YYYYMMDD-HHmmss-xxxx.json --yes
```

恢复会在一个事务内清空并重建 family/person/关系/事件/账户表，校验引用完整性并核对行数；失败自动回滚。
备份包含密码哈希、加密后的联系方式以及媒体元数据，请按敏感文件保管；跨机恢复需保持 `DATA_ENCRYPTION_KEY`（或 `JWT_SECRET`）一致。
媒体原文件存放在 `uploads/`（可用 `UPLOAD_DIR` 配置），不在 JSON 备份内，需单独打包备份；恢复时两者应配套还原。

自动备份：在 `.env` 设置 `BACKUP_INTERVAL_HOURS=24`、`BACKUP_KEEP=14` 即启用进程内定时备份与保留策略；也可用外部 cron 调 `POST /api/admin/backup`。

## 10. 部署

```bash
./deploy.sh          # Git Bash / Linux
deploy.bat           # Windows CMD
```

脚本会检查 `.env`、安装生产依赖、优先用 PM2 启动（单实例）。Nginx 反代模板见 `nginx.conf.example`（已配置 12MB 上传上限，供 Excel/GEDCOM 导入）。

> PGlite 是单写者嵌入式数据库，**不要**用 PM2 cluster 多实例，也不要多个进程指向同一数据目录。需要多实例时切换 PostgreSQL。

---

## 11. 已知限制与路线图

**限制**

- 媒体压缩在前端完成（长边 1920、质量 0.85，压不小则回退原图），未生成服务端缩略图；大相册仍一次性加载元数据
- 地图瓦片默认关闭（隐私友好）；配置 `MAP_TILE_URL` 后可叠加真实底图，但需自备瓦片源
- 服务端 PDF 依赖本机 Chromium（`npx playwright install chromium` 或 `CHROMIUM_PATH`）；未装时自动退回浏览器打印
- 方言内置六区词表（吴/粤/闽南/客家/西南/胶辽），支持逐条自定义覆盖（上限 60 条）
- 多家族已支持（请求级租户隔离），但共享同一 PGlite 数据库；更大规模建议切 PostgreSQL
- 族谱树一次性加载（数千人内可用；更大规模需虚拟化/懒加载）
- 邀请绑定成员后仍依赖管理员核对身份（无短信/实名验证）
- PGlite 不支持 pg_trgm，姓名检索在大数据量下为顺序扫描（PostgreSQL 部署可自行加 GIN 索引）
- 人物关联内置 11 种角色并支持自定义；乐观锁粒度到成员，不含关系与事件
- 口述建谱覆盖父母/子女/配偶/祖辈/兄弟姐妹；祖辈与旁系会自动补占位中间代，仍需人工补填姓名
- PGlite 为单写者：程序已加锁，同一数据目录只允许一个进程打开（多开会导致数据损坏）

**路线图**

- **阶段 2（已完成）**：隐私分级、个人中心、邀请注册、生平事件、关系路径、备份恢复、静态加密、媒体库、变更提案、查重合并、沙漏视图、来源/引文、SVG 导出、称谓推导/五服、家族洞察、凡例、口述/表格建谱、地点库与迁徙、人物关联、资料完整度、批量编辑、乐观锁、故事与回忆录、2FA、本地地图、打印/PDF、故事版本历史、字辈派语校验、故事表格、婚姻状态编辑、合并逐字段取舍、收藏地实体、前端图片压缩、方言称谓、沙漏 SVG 合成
- **工程健壮性（已完成）**：异步路由统一错误捕获、结构化日志、统一请求体校验、慢查询告警、前端纯函数单测、并发一致性测试
- **阶段 3（已完成）**：祖先盘布局、服务端 PDF 合成、地图瓦片可选接入、自定义关联角色、方言词条自定义
- **阶段 4（已完成）**：PWA/离线、多家族多租户、旧谱 OCR 适配与口述转写增强（祖辈/旁系自动补中间代）


---

## 12. 贡献与致谢

本项目为个人/家族自用的族谱管理工具，欢迎提交 Issue 与 Pull Request。

设计与功能参考了以下开源项目与产品（详见第 8 节对照表）：

- [webtrees](https://github.com/fisharebest/webtrees) — 协作编辑、分级隐私、成员合并
- [Topola](https://github.com/PeWu/topola) — 世系/沙漏图表与 SVG 导出
- [Gramps](https://github.com/gramps-project/gramps) — 关系与事件数据模型
- [Ancestris](https://www.ancestris.org/) — 批量维护与数据质量核查
- [一脉 · 家谱](https://yimai-genealogy.app.workbuddy.host/) — 中文称谓推导、家族洞察

## 13. 许可证

MIT License — 可自由用于个人与商业用途，详见 `LICENSE`。