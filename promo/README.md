# 时序 DayFlow · 宣传片

## 完整版（推荐）

成片：`DayFlow-promo-full.mp4`
- 97 秒，1920×1080，24fps，H.264 + AAC
- 约 23.2 MB
- 全片使用「玻璃」主题；Agent 场景连续展示排日程、记任务、查空档
- 覆盖：Agent、时间轴、完成按钮、周视图、DDL、任务收件箱、专注、功能页、九套主题、桌面小组件、本地优先、安装方式

## 分镜（完整版）

| 时间 | 内容 |
| --- | --- |
| 0–6s | 标题：一天，不只是一串待办 |
| 6–15s | Agent：一句话排日程、记任务、查空档；镜头落在新日程块 |
| 15–24s | 时间轴：上边缘就是开始时刻；选中后直接点完成 |
| 24–33s | 周视图：一周摊开在一屏；DDL 只留一条红线 |
| 33–43s | 任务收件箱 + 自动排程 + 专注计时 |
| 43–52s | 本地优先、离线可用、手机端 |
| 52–63s | 功能页：按用途归位 |
| 63–76s | 九套主题：玻璃 / HUD / 视差 / 空间 / 极光等；主画面为玻璃 |
| 76–89s | 桌面小组件：下一项、后续、DDL / 任务、翻页 |
| 89–97s | 片尾：网页 / Android 安装方式 |

## 短版

`DayFlow-promo.mp4`（40 秒，1920×1080，24fps，H.264 + AAC，约 5.4 MB）。

## 短版分镜

| 时间 | 内容 |
| --- | --- |
| 0–4.6s | 标题：一天，不只是一串待办。右侧 24 小时轴与日程块 |
| 4.6–10.8s | Agent：说一句话，日程自己落位。镜头从对话推到新日程块 |
| 10.8–17.6s | 时间轴：上边缘就是开始时刻；蓝线标出 14:00 色块 |
| 17.6–23.6s | 周视图：一周摊开在一屏；DDL 只留一条红线 |
| 23.6–29.2s | 任务收件箱与专注计时 |
| 29.2–34.8s | 本地优先、离线可用、数据只在设备 |
| 34.8–40s | 片尾：网页 / Android 安装方式 |

## 来源

- 所有画面来自真实 Web 版，没有重画 UI；桌面小组件场景是按原生布局做的展示样机。
- `capture-crops.mjs` 抓取短版截图；`capture-full.mjs` 抓取旧版完整版截图；`capture-glass.mjs` 从推广版抓取玻璃主题截图，输出到 `assets-glass/`。
- 推广版截图包含 Agent 的「排日程 / 记任务 / 查空档」、时间轴完成按钮、周视图、任务、专注、功能页和手机端。
- `stage.html` / `stage-full.html` 是 1920×1080 的分镜舞台；`renderFrame(t)` 是纯函数式时间轴，方便逐帧渲染。
- `audio.mjs` 生成 40 秒环境配乐；`audio-full.mjs` 生成 97 秒完整版配乐。
- 字体沿用项目自身：Geist / Geist Mono + 系统中文字体。

## 重新生成

需要 Node 22+、Chrome / Edge、ffmpeg。

```bash
# 1. 启动两个静态服务：
#    8765 给分镜舞台，8766 给推广版页面
python -m http.server 8765 --bind 127.0.0.1
# 另开一个终端，在 release/DayFlow-PC-推广版 目录：
python -m http.server 8766 --bind 127.0.0.1

# 2. 抓推广版玻璃主题截图
cd promo
node capture-glass.mjs

# 3. 生成 97 秒配乐
node audio-full.mjs

# 4. 逐帧渲染（2328 帧，约 2 分钟）
node render-film-full.mjs

# 5. 合成完整版
ffmpeg -y -framerate 24 -i frames-full/f%05d.jpg -i assets-full/soundtrack-full.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest -movflags +faststart DayFlow-promo-full.mp4
```

短版仍可独立生成：

```bash
node capture-crops.mjs
node audio.mjs
node render-film.mjs
ffmpeg -y -framerate 24 -i frames/f%05d.jpg -i assets/soundtrack.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest -movflags +faststart DayFlow-promo.mp4
```

预览：`preview-full/contact-full.jpg` 是完整版每 5 秒一帧的联系表；`preview/contact-final.jpg` 是短版联系表。
