# MDReader

Windows 上的 Markdown 阅读器兼编辑器。Go + MyGo（WebView2），单 exe、免管理员安装、双击 `.md` 就能看。

阅读是主角：打开就是干净的阅读态，需要改再切分栏。界面是苹果风格的纯色方案——白卡片、圆角、极淡阴影，**没有任何毛玻璃或半透明表面**。

## 它能做什么

- **阅读 / 分栏 / 编辑** 三态，`Ctrl+E` 循环切换；打开文件默认是阅读态
- **编辑器**：分栏 / 编辑模式左侧行号与当前行高亮；底部状态栏显示行/列、选中字符数、长度、行数，
  可直接切换换行符（CRLF / LF / CR）、编码（UTF-8 / UTF-8 BOM / GBK / UTF-16 LE/BE）与编辑器字号
- **INS / OVR 与自动换行**：`Insert` 切换插入/覆盖，状态栏开关自动换行（会记住）
- **免安装**：单 exe，首次运行自动加入「打开方式」与 `.md` 右键菜单（只写 HKCU，不需要管理员）
- **常驻托盘**：关闭窗口默认收进托盘，再双击 `.md` 是热接力（约 0.1–0.3s）；
  `⋯` 菜单可关闭这个行为，托盘菜单可打开 / 退出
- **多窗口 + 多标签**，标签可拖动排序、拖出成新窗口、拖到另一个窗口里合并
- **自动保存**：停止输入 800ms 落盘，`Ctrl+S` 立即保存；覆盖前把旧版本留在 `.mdr-history/`（滚动保留 10 份）
- **字节保真**：保留原文件的 UTF-8 BOM 与 CRLF/LF，保存不会把别人的文件改坏
- **外部修改检测**：别的程序改了同一个文件会提示「重新载入 / 保留我的」，不会静默覆盖
- **会话恢复**：重启后窗口位置、标签、光标、滚动位置全部回来
- **格式全支持**：GFM（表格、任务列表、删除线、自动链接）、脚注、Front Matter、KaTeX 公式、Mermaid 图表（点击才渲染）、裸 HTML（DOMPurify 白名单过滤）、相对路径图片
- **粘贴/拖入图片**：自动存到文档旁的 `assets/`，插入 Markdown 链接
- **大纲**：`Ctrl+Shift+O` 开关，随滚动高亮，点击同时定位编辑器光标
- **快速打开** `Ctrl+P` 与**命令面板** `Ctrl+Shift+P`
- **导出**：自包含 HTML（字体、图片全部内联，离线可看）；打印走系统对话框可另存 PDF
- **大文件保护**：超过 3MB 不渲染预览（5MB 文档渲染一次会产生 51 万个 DOM 节点），超过 10MB 直接拒绝打开

## 快捷键

| 快捷键 | 动作 |
| --- | --- |
| `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | 打开 / 保存 / 另存为 |
| `Ctrl+T` / `Ctrl+W` | 新建标签 / 关闭标签 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签 |
| `Ctrl+1`…`Ctrl+8` / `Ctrl+9` | 跳到第 N 个 / 最后一个标签 |
| `Ctrl+E` | 阅读 → 分栏 → 编辑 |
| `Ctrl+P` / `Ctrl+Shift+P` | 快速打开 / 命令面板 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 正文字号放大 / 缩小 / 复位 |
| `Ctrl+Shift+O` | 大纲开关 |
| `Ctrl+Shift+D` | 深浅色切换 |
| `Insert` | 插入 / 覆盖模式 |

标签上还有：中键关闭、双击标签栏空白新建、右键菜单（关闭其他 / 关闭右侧 / 复制路径 / 在资源管理器显示 / 移动到新窗口）。

## 运行（免安装）

下载 `build/windows-amd64/MDReader.exe`，放到任意文件夹，双击运行。不需要安装器，也不需要管理员：

- 首次启动会把**当前 exe 的路径**写进 `HKCU\Software\Classes`，`.md` / `.markdown` / `.mdown`
  的「打开方式」里会出现 MDReader
- Windows 11：右键 `.md` → **显示更多选项** → **用 MDReader 打开**
- 把 exe 挪到别处？下次启动会自动把右键项改到新位置
- 取消：`⋯` 菜单 → 取消右键打开（会记住选择，之后不再自动加回）
- **关闭窗口默认收进托盘**，不退出应用：`⋯` → 关闭时收进托盘（带勾）可关掉，
  关掉后关闭窗口即退出；托盘菜单有「打开 MDReader」「退出 MDReader」。常驻时双击 `.md`
  只是把文件交给已经运行的实例，约 0.1–0.3s；冷启动则约 1s（WebView2 启动成本）

想设为默认程序：`⋯` → 设为默认 .md 程序，会跳到系统设置——Windows 10 之后禁止程序自己抢默认关联，这是系统的规矩，不是我们的偷懒。

`npx mygo build` 仍会顺带生成 NSIS 安装器（`mdreader-setup-*.exe`），那是可选项；
发布便携版用 `npx mygo build -skip-installer`，只出 exe。

### 不打开应用就加右键菜单

`注册右键菜单.cmd` 和 `取消右键菜单.cmd` 与 exe 放在同一个文件夹，双击即可：

- 双击 `注册右键菜单.cmd`：不弹窗口、不需要管理员，写入 HKCU；**注册一次后一直有效**，
  不需要 MDReader 常驻，也不用每次先打开它
- 双击 `取消右键菜单.cmd`：移除右键项和「打开方式」注册，不碰文档与历史
- 移动了 exe：重新双击一次 `注册右键菜单.cmd`
- 命令行等价于 `MDReader.exe --register` / `MDReader.exe --unregister`

## 开发

需要 Go 1.27.3+、Node 20+、WebView2 运行时（Win11 自带）。

```bash
npm install
npx mygo dev          # 开发模式：Vite 热更 + Go 侧改动自动重启
npx mygo build        # 产出 build/windows-amd64/MDReader.exe 与安装器
npm run typecheck     # 类型检查
npm test              # 前端回归（vitest + jsdom）
go test ./...         # Go 回归（字节保真、历史快照、会话）
npm run verify        # 以上四项一起跑，CI 跑的就是它
node fixtures/make-large.mjs   # 生成 5MB / 12MB 的大文件测试样本
```

> 前端命令走 npm 而不是 Bun：Bun 的安装脚本需要从 GitHub Releases 拉二进制，某些网络下拉不下来。`mygo.config.ts` 里的 `devCommand` / `buildCommand` 已改成 npm 脚本。

### 测试都在测什么

`fixtures/all-features.md` 是唯一的回归样本，两种语言都拿它当断言来源：

- `files_test.go`：原样保存后字节不变（BOM + CRLF）、编辑后编码不丢、
  `.mdr-history` 只留 10 份、只读文件的可读错误、未命名文件、图片落盘、
  `session.json` 结构
- `tests/markdown.test.ts`：全格式逐项渲染，含 XSS 剥离与 Mermaid 不预渲染
- `tests/exportHtml.test.ts` / `tests/paths.test.ts`：导出 HTML 与路径处理

发布流程、签名与图标授权的检查项在 [`RELEASE.md`](RELEASE.md)。

## 结构

```
main.go          单实例、无菜单栏、窗口工厂
workspace.go     窗口/标签/文档的唯一真相；打开去重、拖拽命中测试、大文件上限
files.go         读写（保 BOM+CRLF）、.mdr-history 快照、未命名文件、图片落盘
session.go       %AppData%\MDReader\session.json 的写入与恢复
shell_windows.go 免安装注册：HKCU 里的「打开方式」与 .md 右键项
src/App.tsx      三态、快捷键、滚动联动、大纲、命令面板
src/components/  Editor(CM6) / Preview(markdown-it) / TabBar / Outline / Palette / TitleBar / StatusBar / EmptyState
src/lib/         markdown 管线、highlight、exportHtml、useWorkspace、paths
fixtures/        all-features.md 回归用例（故意是 BOM + CRLF）
files_test.go    Go 回归：字节保真、历史快照、会话、图片落盘
shell_test.go    Go 回归：右键项的写入/撤销/修复（用临时注册表键）
tests/           前端回归：markdown 渲染、导出 HTML、路径
.github/workflows/ci.yml  windows 上跑 verify
```

## 数据在哪

| 路径 | 内容 |
| --- | --- |
| `%AppData%\MDReader\session.json` | 窗口、标签顺序、光标与滚动位置 |
| `%AppData%\MDReader\untitled\` | 未命名标签的实体文件（从新建那一刻就在磁盘上） |
| `%AppData%\MDReader\preferences.json` | 「关闭时收进托盘」等偏好 |
| `<文档目录>\.mdr-history\<文件名>\` | 保存前的旧版本，最多 10 份 |
| `<文档目录>\assets\` | 粘贴/拖入的图片 |

## 已知限制

- **无 CA 证书**：默认构建未签名，SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」；
  本机可用 `npm run sign:build` 生成自签名证书并签名（仅本机信任，对外仍会警告）。
  证书怎么选、怎么接：见 [`SIGNING.md`](SIGNING.md)
- **无自动更新**：升级就是重装一次安装器，标签和窗口会由会话恢复带回来
- **Mermaid 约 4MB**：不渲染就不会加载，但它确实在安装包里；砍掉它是 13MB 版本的前提
- **窗口重叠时的拖拽命中**以「非源窗口」为准，不做 z 序精确判定
- **右键菜单位置**：Windows 11 把传统动词收在「显示更多选项」里；现代「打开方式」菜单一直可见
- **编码识别**：自动识别 UTF-8 / UTF-8 BOM / GBK / 带 BOM 的 UTF-16；无 BOM 的 UTF-16、Big5、Shift-JIS 等旧编码不支持
- **不做**：文件树、笔记库、云同步、插件、全库搜索——这是阅读器，不是 Obsidian

## 许可

代码 MIT，见 [`LICENSE`](LICENSE)。`resources/icon.png` 来自用户提供的二次元同人图，公开分发前请自行确认授权——
没有书面许可就换成自有 / CC0 图标，检查项见 [`resources/ICON-LICENSE.md`](resources/ICON-LICENSE.md)。
