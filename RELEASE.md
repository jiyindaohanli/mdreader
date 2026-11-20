# 发布清单

一次发布 = 自动化门禁通过 + 手工回归通过 + 两项人工确认（签名、图标授权）。
全部命令在仓库根目录执行。

## 0. 自动化门禁

```bash
npm ci
npm run verify              # tsc --noEmit + vitest + go vet + go test
npm run build:web           # 验证前端能产出（tsc + vite build）
npx mygo build -skip-installer   # 产出便携 exe
```

`npm run verify` 里的回归断言：

- `files_test.go`：`fixtures/all-features.md` 原样保存后字节不变（BOM + CRLF）；
  编辑后 BOM/CRLF 仍在；`.mdr-history` 只保留 10 份；只读文件报可读的错误；
  未命名文件唯一；图片落盘；`session.json` 的结构
- `tests/markdown.test.ts`：同一个 fixtures 文件逐项渲染（Front Matter、GFM 表格 /
  任务列表 / 删除线 / 自动链接、标题锚点与大纲、源码行号、KaTeX、代码高亮、
  Mermaid 卡片且不预渲染、`<script>` / 事件属性 / `javascript:` 被剥离、
  脚注、相对图片）
- `tests/exportHtml.test.ts`：导出 HTML 的结构、主题与 Mermaid 卡片清理
- `tests/paths.test.ts`：路径拆分
- `shell_test.go`：右键项与「打开方式」的写入、撤销、局部丢失后的自动修复
  （在临时注册表键里跑，不碰真实关联）

## 1. 版本号

- `mygo.config.ts` 的 `version`（决定安装器文件名与「应用和功能」里的版本）
- `CHANGELOG.md` 新增一节
- 打 tag：`git tag -a vX.Y.Z -m "X.Y.Z" && git push origin vX.Y.Z`

## 2. 构建

发布便携版只出 exe（推荐）：

```bash
npx mygo build -skip-installer
# build/windows-amd64/MDReader.exe
```

需要安装器时（可选）：

```bash
npx mygo build
# build/windows-amd64/MDReader.exe
# build/windows-amd64/mdreader-setup-<version>-amd64.exe
```

构建要求：Go 1.27.3+、Node 20+、WebView2 运行时（Win11 自带）。

## 3. 代码签名（可选）

签名不是运行的前提，只影响「别人从网上下载安装包时，Windows 给不给警告」。三条路：

| 分发方式 | 需要证书？ | 说明 |
| --- | --- | --- |
| 源码分发，用户自己构建 | 不需要 | 本地编译的 exe 没有「来自 Internet」标记，SmartScreen 不介入（PortMon 就是这样） |
| 发布安装包，接受警告 | 不需要 | 用户点「更多信息 → 仍要运行」，很多开源 Windows 项目如此 |
| 发布安装包，不想看到警告 | 需要 CA 证书 | 唯一途径，见 [`SIGNING.md`](SIGNING.md) |

现状：按第二种发布，安装包未签名。本机签名（仅本机/内网有效）用
`npm run sign:build`，撤销用 `npm run sign:clean`。

拿到 CA 证书后，`mygo.config.ts` 已经读 `process.env.MDR_SIGN_CERT`，
只需设环境变量，不必改文件：

```powershell
$env:MDR_SIGN_CERT = "certs\mdreader.pfx"
$env:MYGO_WINDOWS_CERTIFICATE_PASSWORD = "..."
npx mygo build
```

要点：

- 预签检查：`MDR_SIGN_CERT` 指向一张证书时，`npm run release:check` 把签名一项
  标为通过（并注明是本地证书）；不设时视为「未签名发布」，只提示、不当作待办。
- **先签 exe，再打安装包，安装包也要签**。只签安装包会让解压出来的 exe 仍然无签名。
  用 mygo 的 `certificate` / `signCommand` 时它会在打包前签好 exe 和安装器；
  不要手工对成品安装器补签后当作完事。
- 证书与密码不进仓库：`certs/`、`*.pfx`、`*.p12` 已经在 `.gitignore` 里。
- 校验：

```powershell
signtool verify /pa /v build\windows-amd64\MDReader.exe
signtool verify /pa /v build\windows-amd64\mdreader-setup-<version>-amd64.exe
```

## 4. 手工回归（发布前必须）

自动化测不到的部分，每次发布都要过一遍：

1. **便携运行**：把 `MDReader.exe` 放进一个空文件夹双击；不应弹 UAC、不应出现安装目录；
   首次启动后 `HKCU\Software\Classes\cn.evegood.mdreader.md` 等项应存在并指向这个 exe。
2. **双击打开**：双击 `fixtures/all-features.md`（先设为默认或从「打开方式」选）；
   逐项看渲染；保存后 `git status` 应无变化（字节保真）；`.mdr-history` 里出现保存前的版本。
3. **右键菜单**：先**不启动应用**，双击 `注册右键菜单.cmd`，右键 `.md` → 显示更多选项 →
   用 MDReader 打开；「打开方式」里也有 MDReader；再双击 `取消右键菜单.cmd` 应全部移除。
   启动应用后把 exe 换个目录，右键项自动指向新路径；`⋯` → 取消右键打开后重启不会自动加回。
4. **托盘与关闭**：关闭窗口 → 进程仍在、窗口隐藏；双击另一个 `.md` → 窗口回来并切到该文件
   （常驻时应在 0.3s 左右）；`⋯` → 关闭时收进托盘（取消勾选）→ 关闭窗口应退出进程；
   托盘菜单的「打开 MDReader」「退出 MDReader」都应生效。
5. **状态栏**：分栏 / 编辑模式左侧有行号；行/列随光标变化，选中后显示选中字符数；
   长度、行数正确；`Insert` 或点 INS 切到 OVR 后输入应替换字符；自动换行与字号菜单
   立即生效，重启后仍保持。
6. **格式切换**：状态栏把 LF 切成 CRLF 后，磁盘字节应出现 `\r\n`；UTF-8 → GBK → UTF-8
   往返后中文仍正确；含 emoji 的文档切 GBK 应提示失败，状态栏回退到原编码。
7. **外部修改**：在别的编辑器里改同一文件并保存，应用应弹「重新载入 / 保留我的」。
8. **大文件**：`node fixtures/make-large.mjs` 生成 5MB / 12MB，确认 5MB 需手动渲染、
   12MB 被拒绝。
9. **视图与导航**：`Ctrl+E` 三态、大纲（`Ctrl+Shift+O`）、`Ctrl+P`、命令面板、
   `Ctrl+F` / `Ctrl+H`、字号与深浅色。
10. **导出**：导出 HTML 后断网打开，图片与公式都在；打印对话框可另存 PDF。
11. **窗口与标签**：拖拽排序、拖出成新窗、拖进另一个窗口、关闭最后一个标签即收进托盘。
12. **重启恢复**：打开若干标签、移动光标与滚动，退出应用再启动，位置与内容都应回来。
13. **只读文件**：设成只读后保存，应提示「文件是只读的，或者没有写入权限」。
14. **卸载**：`⋯` → 取消右键打开，确认 `HKCU\Software\Classes\cn.evegood.mdreader.md`
    与 `Applications\MDReader.exe` 被删；删掉 exe 与 `%AppData%\MDReader` 即彻底清除。

## 5. 图标授权（发布前必须，当前未确认）

`resources/icon.png` 是用户提供的二次元同人图，**公开发布前必须确认授权**，
见 `resources/ICON-LICENSE.md`。没有书面许可就换成自有 / CC0 / 商用授权图标，
再重新构建。

## 6. 发布

- 上传 `MDReader.exe` 到 GitHub Release（便携版；需要安装器时才传 setup）
- Release notes 从 `CHANGELOG.md` 对应小节复制
- 正文里写明：免安装（双击即用）、SmartScreen 的处理方式（更多信息 → 仍要运行）、
  首次运行会写 `HKCU` 的右键项与「打开方式」、无自动更新、
  数据存放位置（`%AppData%\MDReader`、`.mdr-history`、`assets/`）
