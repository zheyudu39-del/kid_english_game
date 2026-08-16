# 🎮 英语小猎人 · Word Hunter

网页版英语单词闯关射击游戏：操控小猎人射出子弹命中单词小怪，弹出 4 选 1 词义题——答对捕获得分，答错怪物反击。从 3 岁启蒙一路打到雅思 8 分。

## ✨ 核心玩法

- **666 关 · 6 大世界**（每世界 110 普通关 + 1 个 BOSS 关）

  | 世界 | 关卡 | 主题 | 难度 |
  |------|------|------|------|
  | 1 魔法森林 | 1-111 | 🌲 3-4 岁启蒙 | d1-3 |
  | 2 深海王国 | 112-222 | 🐠 小学低年级 | d3-4 |
  | 3 火焰火山 | 223-333 | 🌋 小学高年级 | d4-5 |
  | 4 冰封雪山 | 334-444 | ❄️ 初中 | d5-6 |
  | 5 云端天空 | 445-555 | ⚡ 高中 | d6-7 |
  | 6 星辉之巅 | 556-666 | 🌌 雅思/高级 | d7-8 |

- **词库**：8160 个单词（含音标 + 中文释义）+ 308 个例句，难度 1-8 级，每关按难度区间出词
- **战斗**：键盘 WASD/方向键移动、空格/J 射击（移动端虚拟摇杆 + 射击键）；限时、限量弹药、生命值、连击加成、BOSS 三倍血量
- **账号系统**：注册 / 登录（scrypt 密码哈希 + HMAC 签名会话 token），服务端裁决关卡解锁、通关奖励与金币，防重放、防跳关
- **联机对战（竞速）**：2-4 名猎人在同一关卡竞速，谁射中小怪谁答题，先捕获到目标数者获胜；支持 **房间码邀请** 和 **快速匹配**（WebSocket，与 REST 同端口）
- **闯关排行榜**：按通关关卡数全服排名，登录后可查看自己的名次
- **金币经济**：通关得金币；商城 5 把武器（连弩 / 长弓 / 火铳 / 法杖…各有射速 / 弹速 / 散射差异）+ 5 种消耗品（药水 / 弹药箱 / 护盾 / 沙漏 / 眩晕弹）
- **游客模式**：不注册也能玩，进度存 localStorage；登录后以服务端存档为准
- **发音**：Web Speech API 朗读单词（答题时自动读）
- **响应式**：手机 / 平板 / 桌面自适应，触屏摇杆

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 原生 HTML/CSS/JavaScript，Canvas 2D 渲染（矢量绘制角色，无图片素材；背景为 GIF） |
| 架构 | IIFE 模块挂载 `window`，`defer` 按序加载，零构建、零框架 |
| 后端 | Node.js + Express（REST）+ ws（WebSocket 实时对战，`realtime.js`） |
| 存储 | JSON 文件（`data/players.json` / `data/scores.json`），原子写 + 写队列，无需数据库 |
| 认证 | scrypt 加盐密码哈希；无状态 HMAC-SHA256 会话 token（30 天有效），REST 与 WebSocket 共用 |

## 🌐 联机对战架构

**为什么是 Node.js 而不是 C++**：本游戏的联机负载是 2-4 人/房的小房间、
<200 字节 JSON 消息、20Hz 位置广播——单 Node 进程可承载数千并发连接，
瓶颈在网络 RTT 与人的反应时间，而非语言吞吐。同栈还能直接复用会话 token
鉴权、关卡配置与词库，部署保持单进程单端口。房间相互独立，将来需要扩容
时按房间分片即可，无需推翻架构。

**权威划分**（避免把整个物理模拟搬上服务端）：

- 服务端权威（`realtime.js`）：房间生命周期、小怪出生表（全体客户端同源）、
  作答锁（一只小怪同一时刻仅一人作答，其他人看到 🔒）、**答案判定**
  （客户端只上报所选文本，服务端对照词库裁决）、个人捕获计数、刷新波次、
  胜负与超时
- 客户端本地演算（纯视觉）：自己的移动 / 子弹 / 小怪游走；远端玩家位置
  20Hz 广播 + 插值；联机使用固定 1440×720 竞技场保证坐标系一致

**连接与房间**：`ws(s)://host/ws?token=<会话token>` 握手鉴权；同一账号顶号；
每 IP 8 连接、每连接 80 msg/s、房间上限 500、闲置 5 分钟回收；作答超时 15
秒自动释放；断线时对手看到 `peer_leave`，剩余玩家可继续竞速。

**消息协议**（JSON/帧）：

| 方向 | 类型 | 说明 |
|------|------|------|
| C→S | `create{level}` / `quick{level}` / `join{code}` / `leave` | 房间与匹配 |
| C→S | `start` | 房主开局 |
| C→S | `pos{x,y,f}` | 位置广播（客户端 50ms 节流） |
| C→S | `hit{monsterId}` | 命中上报（服务端裁决定谁作答） |
| C→S | `answer{monsterId, choice}` | 上报所选答案文本 |
| S→C | `welcome` / `room` / `peer_join` / `peer_leave` / `countdown` | 房间事件 |
| S→C | `start{cfg,spawns[],target,timeLimit}` | 开局（共享出生表） |
| S→C | `peer_pos` / `engage` / `capture` / `wrong` / `spawn` | 对局事件 |
| S→C | `end{winner,standings[]}` / `error{msg}` | 结算与错误 |

对战结果按单人规则各自提交进度（沿用解锁校验 / 首通发币的防作弊路径），
胜者的排行榜闯关数随之增长。

## 🚀 本地运行

```bash
# 需要 Node.js >= 18
npm install
npm start          # 或 npm run dev（文件变动自动重启）
```

打开浏览器访问 **http://localhost:3000**

## ☁️ 部署

### 直接运行（简单）

```bash
npm install --production
PORT=3000 HOST=127.0.0.1 node server.js
```

### Nginx 反向代理（推荐）

1. 上传项目到服务器，安装 Node.js 和 Nginx
2. 复制 `deploy/nginx.conf` 到 `/etc/nginx/conf.d/`，修改 `server_name`，**配置 TLS 证书**（登录密码经请求体提交，务必走 HTTPS）
3. 用 systemd 管理进程：

```ini
# /etc/systemd/system/kid-english.service
[Unit]
Description=Word Hunter - Kids English Game
After=network.target

[Service]
WorkingDirectory=/var/www/kid_english_game
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
# 经 nginx 反代时设为 1，让限流按真实客户端 IP 计数
Environment=TRUST_PROXY=1

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now kid-english
systemctl reload nginx
```

## 📁 项目结构

```
kid_english_game/
├── server.js              # Express：静态文件 + 全部 REST API（词库/关卡/玩家/商城/认证/排行榜）
├── realtime.js            # WebSocket 联机对战服务端（房间/匹配/对局裁决，挂载在 /ws）
├── data/
│   ├── vocabulary.json    # 词库（8160 词 + 308 句，~1.7MB）
│   ├── players.json       # 账号与进度（gitignored）
│   ├── scores.json        # 成绩存储（gitignored）
│   └── session-secret     # 会话签名密钥（gitignored，首次运行自动生成）
├── deploy/nginx.conf      # Nginx 部署配置（含 /ws WebSocket 代理）
├── scripts/               # 词库维护脚本（加音标、审计等）
├── public/
│   ├── index.html         # 单页入口（标题屏/HUD/登录注册/商城/联机大厅/排行榜/结算）
│   ├── css/game.css       # 全部样式（CSS 变量）
│   ├── img/bg.gif         # 游戏背景
│   └── js/
│       ├── main.js        # 入口：创建 Game 实例，绑定所有 UI 按钮
│       ├── game.js        # 游戏主循环 / 状态机 / 碰撞 / 关卡流程 / 联机对战集成
│       ├── net.js         # WebSocket 客户端（鉴权/重连/消息分发/位置节流）
│       ├── mp.js          # 联机大厅（建房/输码加入/快速匹配/房间 UI）
│       ├── leaderboard.js # 闯关排行榜 UI
│       ├── register.js    # 注册 / 登录 / 会话恢复
│       ├── shop.js        # 商城 UI（目录镜像服务端，离线兜底）
│       ├── api.js         # fetch 封装（超时 + 会话 token 注入）
│       ├── levels.js      # 666 关数据层（/api/levels 缓存 + 离线回退）
│       ├── question.js    # 答题弹窗（4 选 1 词义）
│       ├── world.js / player.js / monster.js / projectile.js
│       ├── coin.js / particle.js        # 金币与粒子特效
│       ├── input.js       # 键盘 + 移动端摇杆 + 输入锁
│       ├── tts.js         # Web Speech 朗读
│       └── utils.js       # 随机 / 碰撞 / toast / 音效 / 震屏
└── test-*.js, debug-*.js  # 开发用测试（含 test-realtime.js / test-mp-ui.js）
```

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/vocabulary?age=7` | 词库（带 age 则按年龄段过滤） |
| `GET` | `/api/levels` | 666 关元数据（~5KB） |
| `GET` | `/api/levels/:id` | 单关完整配置（HP / 怪名 / 奖励） |
| `GET` | `/api/shop` | 商城目录（武器 + 道具，含价格与数值） |
| `GET` | `/api/leaderboard/levels?limit=50&nickname=x` | 闯关排行榜（按通关数排序，带 nickname 附本人排名） |
| `POST` | `/api/register` | 注册（昵称 / 密码 / 年龄）→ 返回会话 token |
| `POST` | `/api/login` | 登录 → 返回会话 token |
| `GET` | `/api/players/:nickname` | 玩家档案 🔒 |
| `POST` | `/api/players/:nickname/progress` | 提交通关结果（金币/解锁由服务端计算）🔒 |
| `POST` | `/api/players/:nickname/buy` | 购买武器 / 道具 🔒 |
| `POST` | `/api/players/:nickname/equip` | 切换装备武器 🔒 |
| `POST` | `/api/players/:nickname/use-item` | 消耗道具 🔒 |
| `GET` | `/api/scores?limit=20&age=7` | 排行榜 |
| `POST` | `/api/scores` | 提交成绩 |

🔒 = 需要请求头 `X-Player-Token: <token>`（登录/注册时返回，30 天有效）。

## 🔒 安全设计速览

- 密码 **scrypt**（内存困难 KDF）加盐哈希；旧格式（SHA-256 时代）登录时自动迁移
- 会话为**无状态 HMAC 签名 token**，服务端无会话表，重启不掉线
- 所有写操作限流（读 600/分、写 60/分、认证 10/分，按 IP）；登录失败统一报错 + 等时比较防枚举
- 通关奖励 / 关卡解锁 / 金币消费全部**服务端裁决**（防跳关、防重复刷币）
- CSP / X-Frame-Options / nosniff 等安全响应头；请求体 16KB 上限；昵称白名单正则
- 玩家数据与密钥文件均已 gitignore

## 🧪 测试

开发用脚本（需要 `puppeteer-core` + 本机 Chrome，已列为 devDependency）：

```bash
npm install                # 首次安装含 devDependencies
node test-register.js      # 注册 / 登录流程
node test-wordhunter.js    # 单人游戏主流程
node test-auth-api.js      # 认证 / 商城 / 排行榜 API（需服务器在 PORT 上运行）
node test-realtime.js      # 联机协议全链路（需服务器在 PORT 上运行）
node test-mp-ui.js         # 联机双浏览器 E2E（需服务器在 PORT 上运行）
node test-666-levels.js    # 全关卡配置校验
node test-e2e.js           # 端到端
```

## 📝 添加新单词

编辑 `data/vocabulary.json` 的 `words` 数组即可（无需改代码）：

```json
{ "id": "an21", "english": "panda", "chinese": "熊猫", "emoji": "🐼",
  "category": "animals", "difficulty": 1, "ageMin": 3,
  "phonetic": "/ˈpændə/" }
```

- `difficulty`: 1-8（决定出现在哪些关卡）
- `ageMin`: 该词对哪个年龄段开始可见（3/5/7/9/12/15/18）
- `phonetic`: 标准 IPA 音标（美式发音）
