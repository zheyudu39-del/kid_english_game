# 音效来源说明 (Audio Credits)

全部音效/音乐文件来自 [游戏音效工厂 gamersounds.com](https://gamersounds.com/library/)，
通过其公开的音效库接口下载。该站条款：**资源仅供个人学习与交流使用，不得用于商业用途。**
本项目为个人学习项目；如需商用，请自行联系资源作者取得授权。

## 事件 → 素材映射

| 游戏事件 | 本地文件 | 网站素材名 (分类) |
|---|---|---|
| click 按钮 | click.mp3 | 按钮 (UI音效) |
| shoot 射击 | shoot.mp3 | 射击 (战斗) |
| hit 玩家受伤 | hit.mp3 | 受伤 (交互音效) |
| engage 锁定小怪 | engage.mp3 | 提示 (卡通休闲) |
| correct 答对 | correct.mp3 | 正确 (UI音效) |
| wrong 答错 | wrong.mp3 | 错误 (UI音效) |
| catch 捕获小怪 | catch.mp3 | 开启宝箱 (交互音效) |
| coin 金币 | coin.mp3 | 获得金币 (交互音效) |
| combo 连击 | combo.mp3 | 闪亮 (UI音效) |
| win 通关 | win.wav | 通关音效 (UI音效) |
| lose 失败 | lose.mp3 | 失败 (UI音效) |
| boss Boss登场 | boss.wav | 怪物叫声 (战斗) |
| bossDown Boss击败 | bossdown.mp3 | 爆炸 (战斗) |
| countdown 倒计时 | countdown.mp3 | 咚 (UI音效) |
| tick 低时警告 | tick.mp3 | 提示 (UI音效) |
| join 玩家加入 | join.mp3 | 开门 (交互音效) |
| leave 玩家离开 | leave.mp3 | 关闭 (UI音效) |
| matchStart 比赛开始 | matchstart.mp3 | ready~go! (卡通休闲) |
| knockout 淘汰 | knockout.mp3 | 死亡 (战斗) |
| unlock 解锁关卡 | unlock.mp3 | 升级 (卡通休闲) |
| BGM 菜单 | bgm-menu.mp3 | 休闲轻快 (背景音乐) |
| BGM 关卡 | bgm-level.mp3 | 明亮轻快 (背景音乐) |
| BGM Boss | bgm-boss.mp3 | 战斗 (背景音乐) |

## 播放机制

`public/js/sound.js` 优先播放以上文件；文件缺失或解码失败时自动回退到
内置 WebAudio 合成音效（原始振荡器版本），保证离线/异常情况下游戏不无声。
