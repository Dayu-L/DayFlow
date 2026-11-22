# 时序 DayFlow — Android APK

## 完整版

APK 位置：`../DayFlow-1.23.0.apk`

SHA-256：

```
0e1577b6b7d38426e719c2c90b8fb193607d552667442ca71c36e5df09d96233
```

- 包名：`com.dayflow.app`
- 版本：1.23.0（versionCode 30）
- minSdk：24（Android 7.0）
- targetSdk：34
- 体积：210,776 字节（约 206 KB，复用系统 WebView，不打包浏览器内核）
- 签名：自签名 release key，可直接侧载安装

## 这个壳做了什么

- 原生 `Activity` + `WebView` 加载完整 Web App，离线可用
- Web 资源通过 `https://appassets.local/...` 自定义域名拦截，从 `assets/www` 读取
  - 这样 `localStorage` 有稳定的 HTTPS origin，日程不会因为 `file://` 丢失
  - 如果主页面拦截失败，会自动回退到 `file:///android_asset/www/index.html`
- 返回键：先关闭当前弹窗；没有弹窗时返回桌面（不直接杀进程）
- 点色块先选中，再点一次打开编辑；「调整」开关会记住，开启后拖动已选中色块改时间
- 缩略模式把 24 小时压进一屏；点日期标题打开月历，周条两侧可切换上一周 / 下一周
- 新建 / 编辑弹窗支持时长快捷按钮和可折叠的地点 / 备注
- 课表节次：设置第 N 节的开始 / 结束时间后，Agent 可把「周三第1到2节 高数」换算成具体时间；未设置时会自动打开课表编辑
- 课表周次：支持 `1-16周` / 单双周；必须先在课表设置里填「学期第 1 周周一」，否则会提示补填，避免按今天反推造成整学期错位
- 大模型模式新增 `addSeries`：一门固定课一个 action，由本地展开整学期，不再只生成一周
- 重复添加会自动合并；多行课表会继承上一行星期 / 周次，避免重复和错排
- 短期记忆：大模型带最近 8 轮对话；本地会沿用上一门系列课的星期 / 周次
- 周视图：周一到周日 7 天并排，顶部「日 / 周」切换；点日期头进入日视图，点空白格按该天新建
- DDL 截止事项：时间轴显示红色横线 + 旗标，DDL 按钮打开分组列表；Agent 支持创建、查询、完成、改期和删除
- 今日收尾：一键把没完成的日程顺延到明天或下一个空档
- 数据与个性化：JSON 全量备份 / 导入、每日自动快照、`.ics` 导入、自定义分类颜色、日程模板
- 语音输入：WebView 支持 SpeechRecognition 时显示麦克风；不支持时自动隐藏
- 「全部清空」清所有日期（不只当前周）；「清空本周 / 下周 / 未来一周」按范围清
- 手机端底部新增「日历 / 功能 / Agent」分页；功能页按用途收纳任务、DDL、顺延、专注、课表和设置，返回键会先回日历
- 选中日程后色块右上角直接显示「完成 / 取消完成」，第一次点击即可勾完成
- 九套主题：HUD（默认）/ 视差 / 空间 / 极光 / 玻璃 / 纸白 / 墨夜 / 暖砂 / 松林；右上角调色板随时切换，选择保存在本机
- 所有主题共用同一套字体、字号、间距、圆角和布局，只改变配色、背景、阴影和玻璃质感
- 顶部信息默认在手机端收起为单行工具栏；点右上角折叠按钮可展开 / 收起标题、周条和统计
- 底部「日历 / Agent」栏预留了安全间距，时间轴和输入框不会被遮挡
- 支持多行长文本和批量写入；一次最多 3000 项，换行不会再被合并成一条
- `window.confirm` 使用原生 `AlertDialog`，删除/清空确认正常
- API Key 使用普通文本输入 + 点号遮罩，不触发 Android 安全键盘
- 图片按钮优先调用原生桥接 `pickImage`：系统相册选取 → 原生读取 / EXIF 旋转 / 压缩到 1400px → 通过 `evaluateJavascript` 直接交给页面。这样完全不依赖 WebView 的 file-input 回传，解决“选完图片不进输入框”
- WebView 的 `onShowFileChooser` + 可直接启动 `GET_CONTENT` / `OPEN_DOCUMENT` 仍保留，作为浏览器 file input 的兜底
- 文件输入使用“可视隐藏”（1px + clip）而不是 `display:none`，兼容部分 WebView 不回调文件选择器的问题
- 导出 `.ics` 使用 Android 系统保存面板（SAF），不需要存储权限
- 桌面小组件：4×2「时序 · 今日日程」，显示下一项 / 进行中日程、后续 2 项和 DDL / 任务数量；超过 3 项可用右下角 `‹ ›` 翻页，点日程直接打开对应事件，颜色跟随当前主题
- 原生提醒：页面把提醒列表交给 `ReminderScheduler`，用 `AlarmManager` 写入系统闹钟；`ReminderReceiver` 负责弹通知
- 提醒列表缓存在 `SharedPreferences`；`BootReceiver` 在开机、应用更新、修改时间 / 时区后自动重排
- 点击提醒通知会启动 App，并通过 `window.__dayflowOpenEvent` 直接打开对应日程
- Android 13+ 请求 `POST_NOTIFICATIONS`；Android 12+ 判断并引导 `SCHEDULE_EXACT_ALARM` 精确闹钟权限
- 允许明文 HTTP，方便连接局域网里的 Ollama / 兼容接口
- 状态栏、导航栏使用 App 的深色

## 安装

把 `DayFlow-1.23.0.apk` 传到手机，允许“安装未知应用”，点击安装即可。

```bash
adb install -r DayFlow-1.23.0.apk
```

## 重新构建

需要：

- JDK 17
- Android SDK Build-Tools 35.0.0
- Android platform 35
- Python 3

当前机器上的工具链位置（持久目录）：

```bash
export JAVA_HOME=/mnt/c/Users/llyyt/AppData/Local/DayFlowBuild/jdk
export ANDROID_SDK_ROOT=/mnt/c/Users/llyyt/AppData/Local/DayFlowBuild/sdk
```

执行：

```bash
cd android
chmod +x build.sh
./build.sh
```

脚本会：

1. 把源目录的 `index.html`、`assets`、`js` 复制到 `assets/www`
2. 用 `aapt2` 编译资源、链接 APK（版本号由 `VERSION_NAME` / `VERSION_CODE` 传入）
3. 用 `javac` + `d8` 编译 `src/com/dayflow/app/` 下的全部 Java 文件
4. 加入 `classes.dex`，`zipalign` 对齐
5. 用 `keystore/dayflow-release.jks` 签名
6. 输出到 `DIST`（默认 `../DayFlow-$VERSION_NAME.apk`）

`SOURCE_ROOT`、`VERSION_NAME`、`VERSION_CODE`、`DIST` 都可以用环境变量覆盖。`AndroidManifest.xml` 不再写死版本号，统一由 `build.sh` 传入，避免出现 APK 内版本和文件名不一致。

如果换机器，安装 SDK 组件：

```bash
sdkmanager "platforms;android-35" "build-tools;35.0.0"
```

## 签名密钥

```
文件：android/keystore/dayflow-release.jks
alias：dayflow
密码：见本地密码管理器（不写入仓库）
```

**这个 keystore 要保留好**。以后发新版 APK 必须用同一个 key 签名，否则手机会拒绝覆盖安装。

构建时密码通过环境变量传入，不写入任何文件：

```bash
export DAYFLOW_STORE_PASS='你的 store 密码'
export DAYFLOW_KEY_PASS='你的 key 密码'
```

证书 SHA-256：

```
BC:B7:51:95:83:97:D8:C1:57:B0:C7:F6:82:79:5B:1E:7B:7B:20:15:C8:AF:D6:DD:3E:F4:18:BE:4E:F1:12:98
```

## 验证说明

- `aapt2` 资源编译、`apksigner verify`（v2 + v3）、`zipalign` 均通过
- `classes.dex` 已包含 `MainActivity`、`ReminderScheduler`、`ReminderReceiver`、`BootReceiver`
- Web 端在真实 Chrome 中完成了交互测试：选中 / 拖动、调整开关记忆、缩略模式一屏适配、月历 / 跨周跳转、课表节次 / 1-16 周 / 单双周换算、上下文改删、批量 1200 项写入、手机端分页 / 折叠、提醒同步、任务自动排程、专注记录、重复系列编辑 / 删除、简报 / 复盘
- 在 Android 14 模拟器上完成了 `adb install` 和 `MainActivity` 启动
- 该模拟器没有 KVM，只能软件模拟，系统 WebView 渲染进程会崩溃；**系统自带的 WebView Shell 也会同样崩溃**，属于模拟器环境问题。因此页面渲染和系统通知建议在真机上安装确认

## 已知限制

- Android 13+ 需要手动允许通知；Android 12+ 的精确闹钟是特殊权限，未授权时会退化为非精确闹钟，可能延迟几分钟
- 系统厂商的后台限制（省电策略、自启动管理）可能影响提醒，必要时把 DayFlow 加入白名单
- 网页版的提醒只在页面打开时生效，不能替代原生闹钟
- 编辑模式默认关闭；浏览模式下时间轴可以正常滑动，开启后才可拖动色块
- 图片识别必须配置支持视觉输入的大模型；本地离线引擎不能识图
- 大模型接口需要服务端允许 WebView 的跨域请求；文字请求失败会回退本地智能体，图片请求失败会明确报错
- WebView 版本决定 CSS/JS 支持程度；Android 7 以下不支持
- 自签名 APK 不适合直接上架 Google Play；上架需要正式签名 AAB、targetSdk 35 和隐私材料

## 文件结构

```
android/
├── AndroidManifest.xml
├── build.sh                 一键构建
├── assets/www/              构建时从 Web 版复制
├── res/                     图标、主题、颜色
├── src/com/dayflow/app/
│   ├── MainActivity.java    WebView 壳 + 图片选择 + 文件导出 + 返回键 + JS 桥
│   ├── ReminderScheduler.java  提醒写入系统闹钟、重排、通知渠道
│   ├── ReminderReceiver.java   到点显示通知
│   └── BootReceiver.java       开机 / 更新 / 改时间后重建提醒
├── keystore/                签名密钥（保留）
└── build/                   中间产物（可删）
```
