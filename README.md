# 🎮 英语小达人 (Kids English Learning Game)

帮助 **3-10 岁**孩子提升英语的网页互动学习游戏。纯 Web 技术实现，零图片资源（用 Emoji 替代），发音使用浏览器内置语音合成（Web Speech API）。

## ✨ 功能特性

- **4 种游戏模式**
  - 🔤 **单词认知** — 看图选英文单词（配发音）
  - 🔊 **听力反应** — 纯听力答题，听到选对图
  - ✏️ **字母拼写** — 三阶段：字母识别 → 大小写配对 → 填空拼写
  - 💬 **简单句对** — 日常英语对话理解
- **4 个年龄段分级**（3-4 / 5-6 / 7-8 / 9-10），词库难度和选项数量随年龄变化
- **12 个主题分类**，共 **203 个单词 + 42 个对话句子 + 26 个字母**
- **昵称成绩系统** — 无需注册，昵称即身份，成绩存入服务器排行榜
- **奖励机制** — 星星、金币连击、彩带动画、语音鼓励反馈
- **响应式设计** — 手机/平板/桌面自适应

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | 原生 HTML/CSS/JavaScript（无框架、零构建） |
| 后端 | Node.js + Express |
| 发音 | 浏览器 Web Speech API（speechSynthesis） |
| 图片 | Emoji（跨平台，无需素材） |
| 存储 | JSON 文件（`data/scores.json`，无需数据库） |

## 🚀 本地运行

```bash
# 需要 Node.js >= 18

npm install
npm start          # 或 npm run dev（自动重启）
```

打开浏览器访问 **http://localhost:3000**

## ☁️ 部署到服务器

### 方式一：直接运行（简单）
```bash
npm install --production
PORT=3000 node server.js
```

### 方式二：Nginx 反向代理（推荐）
1. 将项目上传到服务器
2. 安装 Node.js 和 Nginx
3. 复制 `deploy/nginx.conf` 到 `/etc/nginx/conf.d/`，修改 `server_name`
4. 用 systemd 管理进程（示例）：

```ini
# /etc/systemd/system/kid-english.service
[Unit]
Description=Kids English Learning Game
After=network.target

[Service]
WorkingDirectory=/var/www/kid_english_game
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

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
├── server.js              # Express 服务器（静态文件 + 成绩 API + 词库 API）
├── package.json
├── data/
│   ├── vocabulary.json    # 词库（203 词 + 42 句 + 26 字母）
│   └── scores.json        # 成绩存储（自动创建）
├── deploy/nginx.conf      # Nginx 部署配置
├── public/
│   ├── index.html         # SPA 入口
│   ├── css/
│   │   ├── style.css      # 全局样式（BEM-lite，CSS 变量）
│   │   └── animations.css # 动画
│   └── js/
│       ├── app.js         # 哈希路由 + 全局状态
│       ├── api.js         # fetch 封装
│       ├── tts.js         # 语音合成封装
│       ├── utils.js       # 工具函数（洗牌/星星/彩带/音效）
│       ├── pages/         # 5 个页面（首页/选年龄/菜单/结果/排行榜）
│       └── games/         # 共享引擎 + 4 个游戏
└── test-e2e.js            # 端到端测试（开发用）
```

## 🧪 测试

项目附带两个开发测试脚本（需要 `puppeteer-core`，已列为 devDependency）：

```bash
npm install                    # 首次安装含 devDependencies
node test-e2e.js               # 端到端：自动玩完 4 个游戏
node test-layout.js            # 布局/跨年龄验证
```

## 🔌 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/vocabulary?age=7` | 按年龄取词库 |
| `GET` | `/api/scores?limit=20&age=7&game=spelling` | 排行榜 |
| `GET` | `/api/scores/:nickname` | 单个玩家成绩 |
| `POST` | `/api/scores` | 提交成绩（昵称/分数/年龄/模式） |

## 📝 添加新单词

编辑 `data/vocabulary.json` 的 `words` 数组，按现有格式添加即可（无需改代码）：

```json
{ "id": "an21", "english": "panda", "chinese": "熊猫", "emoji": "🐼",
  "category": "animals", "difficulty": 1, "ageMin": 3,
  "phonetic": "/ˈpændə/" }
```

- `difficulty`: 1-4（1 最简单）
- `ageMin`: 该词对哪个年龄开始可见（3/5/7/9）
- `phonetic`: 标准 IPA 音标（美式发音），会显示在单词下方
