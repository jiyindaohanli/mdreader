# 代码签名：证书怎么来、怎么配

签名是**可选**的：它只影响「别人从网上下载安装包时，Windows 给不给警告」。
自己构建、源码分发、内网使用都不需要证书。要看是否需要，先看 [`RELEASE.md`](RELEASE.md#3-代码签名可选)
里的三条分发路径。

未签名的安装包会被 SmartScreen 拦成「未知发布者」。这份文档讲三件事：证书怎么选、
拿到后怎么接到 MDReader 的构建里、没有证书时怎么先把流程演练通。

## 0. 先知道两件事

1. **2023 年 6 月起，公开 CA 不再给你能拷走的 `.pfx`**。CA/Browser Forum 规定代码签名
   私钥必须待在硬件（USB token）或云端 HSM 里。所以「下载一个 pfx 就能用」的方案，
   要么是自签名，要么是内部 CA。
2. **签名不等于立刻没有警告**。SmartScreen 按证书积累声誉，新证书前几百次下载仍可能提示。
   EV 证书和 Azure Trusted Signing 起步更好，但别把它当承诺。

## 1. 选一条路

| 路线 | 花钱 | 拿到要多久 | 私钥在哪 | 适合 |
| --- | --- | --- | --- | --- |
| Certum Open Source Code Signing | 免费或很低（看当期政策） | 项目审核，几天 | 云端（SimplySign） | MIT 开源项目，先试这条 |
| SignPath.io 开源赞助 | 免费 | 审核几天 | 他们的云 | 只想在 CI 里签，不想管证书 |
| Azure Trusted Signing | 约 US$10/月 | 主体/身份验证，数天 | 微软 HSM | 长期稳定、不想碰硬件 |
| 商业 OV | US$200–500/年 | 3–10 个工作日 | USB token 或云 HSM | 有公司主体、要正规发票 |
| 商业 EV | US$300–800/年 | 1–3 周 | USB token | 面向企业客户、要求最高 |
| 自签名 | 0 | 立刻 | 你自己 | 本机/内网可用（`scripts/setup-signing.ps1`），**不能用于公开发布** |

证书发给**主体**（个人或公司），要验身份证明、电话、地址。个人也能买 OV，但不是每家 CA
都接；国内购买一般走代理，**注意代理不能代持私钥**（私钥必须由你控制）。

推荐顺序：Certum 开源 → SignPath → Azure Trusted Signing → 商业 OV。
前两条要求项目公开可查、有一定历史；MDReader 的 GitHub 仓库与 README 够用。

## 2. 装 signtool

mygo 用 `signtool` 签 exe、安装器，以及安装器里的 uninstaller。它来自 Windows SDK：

- 已装 Visual Studio：安装器里勾「Windows SDK」的 Signing Tools
- 或者 `winget install Microsoft.WindowsSDK.10.0.26100`
- 或者只下构建工具（约 20MB，解压即用）：
  <https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools>
  → 用 `bin/<版本>/x64/signtool.exe`

mygo 找 signtool 的顺序是 `PATH` → `%ProgramFiles(x86)%\Windows Kits\10\bin\10.*\x64`。
用 NuGet 解压版时，把那个 `x64` 目录加进 `PATH`，或者用 `signCommand` 写全路径。
`scripts/setup-signing.ps1` 另外会找 `%LOCALAPPDATA%\MDReader\signtool.exe`——
单个 `signtool.exe` 就能自己跑（约 540KB），机器上没装 SDK 时放一份在那里即可。

## 3. 三条接法

mygo 的签名在打包流程里：**编译 exe → 签 exe → 打安装器 → 签安装器 → 签 uninstaller**。
所以不要事后只签安装包——里面的 exe 还是裸的。

### A. 手里有 `.pfx`（自签名演练，或 CA 给的导出文件）

```ts
// mygo.config.ts
windows: {
  installerInclude: "build/installer.nsh",
  certificate: "certs/mdreader.pfx",
  timestampUrl: "http://timestamp.digicert.com",
},
```

```powershell
$env:MYGO_WINDOWS_CERTIFICATE_PASSWORD = "证书密码"   # 只从环境变量读
npx mygo build
```

### B. 证书在 USB token 或云签名客户端（多数商业 OV/EV、Certum SimplySign）

装好 token 驱动后证书会出现在 `CurrentUser\My`，signtool 按名字挑：

```ts
windows: {
  signCommand:
    'signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /n "Your Name" /a %1',
},
```

`%1` 是 mygo 传进来的文件路径（会自动加引号）。`/n` 换成证书 Subject 里一段唯一文字，
先用 `Get-ChildItem Cert:\CurrentUser\My | Format-List Subject, Thumbprint` 确认。

厂商自带 CLI 的（Sectigo、DigiCert KeyLocker、SSL.com eSigner），把那条命令写进
`signCommand`，文件路径的位置换成 `%1`。

### C. Azure Trusted Signing

1. Azure 订阅里建 Trusted Signing 账户 + Certificate Profile（Public Trust）
2. `npm i -g @azure/trusted-signing-cli`
3. 配置：

```ts
windows: {
  signCommand:
    "trusted-signing-cli -e https://<region>.codesigning.azure.net -a <account> -c <profile> %1",
},
```

4. 本机先 `az login`；CI 用服务主体，凭据放 secrets，不要写进配置。

### D. SignPath（开源免费）

它签在 CI 里，不接本地构建。流程是「构建 exe → SignPath 签 exe → 再打安装器 → 再签安装器」，
用 mygo 时要拆成两步（先 `-skip-installer` 拿 exe，签完再打安装器并签）。具体按 SignPath
的 GitHub Actions 文档来，别把 `signCommand` 硬接进去。

## 4. 没有证书：本机签名身份

**先说清楚边界**：公开受信任的代码签名证书只能由 CA 发给通过实名验证的主体，
没有任何工具能“生成信任”。所以这里做的是**本机/内网签名**：证书由你自己签，
添加到本机信任后，签名在本机显示为有效发布者；别人下载安装包时，因为他们的 Windows
不信任这张证书，SmartScreen 照样警告。

`scripts/setup-signing.ps1` 做这些事：

1. 生成自签名证书 `CN=fivenull (MDReader)`（5 年），私钥存到
   `certs/mdreader-local.pfx`，密码在工作目录的 `mdreader-local.pfx.password`（`certs/` 已 gitignore）
2. `-Trust`：把证书加入**当前 Windows 用户**的 `Root` 与 `TrustedPublisher`，
   使 `Get-AuthenticodeSignature` 返回 `Valid`（不改系统级 Store，不需要管理员）
3. `-Sign`：设置 `MDR_SIGN_CERT` 与密码，跑 `npx mygo build`，并列出每个产物的签名状态
4. `-Untrust` / `-Clean`：分别去掉信任、彻底删除证书与文件

```powershell
# 生成证书（不安装信任）
npm run sign:setup

# 生成 + 本机信任 + 构建签名（需要 signtool）
npm run sign:build

# signtool 找不到时，直接调脚本并指定路径
powershell -ExecutionPolicy Bypass -File scripts/setup-signing.ps1 -Trust -Sign -Signtool "C:\path\to\signtool.exe"

# 撤销
npm run sign:clean
```

`-Sign` 会依次在 `PATH`、`%LOCALAPPDATA%\MDReader\signtool.exe`、Windows SDK 里找
signtool，并把它的目录临时加进 `PATH` 供 mygo 使用。

`mygo.config.ts` 里 `certificate: process.env.MDR_SIGN_CERT`：**不设这个环境变量时，
`npx mygo build` 仍然是未签名包**，适合对外发布前的干净构建；需要本机签名时用
`-Sign` 或自己设两个环境变量。

请把 `certs/mdreader-local.pfx` 当成真私钥看待：它一旦泄露，任何人在信任了它的机器上
都能冒充 MDReader。别提交、别放进安装包、别发给别人。

想要对外也没有警告，只有第 1 节里那些 CA 路线，其中 Certum / SignPath 对开源项目免费，
但都需要你本人提交身份与项目材料——这一步无法代劳。申请时要的材料见第 8 节。

## 5. 验证

```powershell
signtool verify /pa /v build\windows-amd64\MDReader.exe
signtool verify /pa /v build\windows-amd64\mdreader-setup-<version>-amd64.exe
```

也可以 `Get-AuthenticodeSignature <文件> | Format-List`（PowerShell 自带，不看信任链）：

- 没签名：`No signature found`
- 本机证书、未 `-Trust`：`UnknownError` / `UntrustedRoot`，正常
- 本机证书、已 `-Trust`：`Valid`
- 真证书：`Valid`，并且 `TimeStamperCertificate` 不为空

安装器里的 uninstaller 也会被签（NSIS 3.08+，mygo 自动下载的版本满足）。

## 6. 常见坑

- **只签安装包**：装出来的 exe 没签名，SmartScreen 照样拦。
- **忘了时间戳**：证书过期后签名立即失效。`/tr` + `/td sha256` 是 RFC3161 时间戳。
- **USB token 插在 CI 里**：跑不了。CI 用云端签名（Trusted Signing / SignPath / CA 云 HSM）。
- **密码写进配置**：会进 git。用环境变量或厂商 CLI 的登录态。
- **签完再改文件**：任何字节改动都会毁掉签名。签完只打包，不再改资源。
- **证书续期**：旧版本已签的包不受影响，新构建换新证书，声誉会重新积累一部分。
- **多架构**：目前只出 amd64；以后加 arm64 时每个 exe 都要签。
- **PowerShell 5.1 报「Cert 驱动器不存在」**：有些机器的 `PSModulePath` 混进了
  PowerShell 7 的模块，证书提供程序就加载不了。`scripts/setup-signing.ps1` 已经自动处理；
  手写命令时先 `$env:PSModulePath = "$PSHOME\Modules"` 再
  `Import-Module Microsoft.PowerShell.Security, PKI -Force`。

## 7. 预算与时间（参考，政策以官网为准）

| 路线 | 钱 | 时间 |
| --- | --- | --- |
| Certum 开源 | 0 或很低 | 审核几天 |
| Azure Trusted Signing | 约 $10/月 | 验证几天 |
| OV | $200–500/年 + token 快递 | 1–2 周 |
| EV | $300–800/年 | 2–4 周 |

买之前确认三件事：证书类型（OV/EV）、私钥形态（token/云 HSM）、是否支持你所在的主体类型。

## 8. 申请时直接用的材料

Certum / SignPath / Azure 的表格都问同一类问题，下面这段直接改改就能填：

```text
项目名称：MDReader
项目简介：Windows 上的 Markdown 阅读器兼编辑器（Go + MyGo/WebView2），单 exe、
  免管理员安装、双击 .md 直接阅读；支持 GFM、脚注、Front Matter、KaTeX、Mermaid、
  自动保存与会话恢复。
仓库：https://github.com/jiyindaohanli/mdreader
许可证：MIT
类别：桌面应用 / 开源工具
构建：npm ci && npx mygo build；产物 build/windows-amd64/MDReader.exe 与
  mdreader-setup-<version>-amd64.exe；签名步骤见仓库 SIGNING.md
维护者：fivenull（<你的实名与联系方式>）
签名对象：上述 exe 与安装器，以及安装器内的 uninstaller
私钥保管：USB token / 云端 HSM（按 CA 要求）
```

需要的附件通常是：身份证明、项目主页截图、仓库地址、下载页或 Release 链接。
Azure Trusted Signing 还要求 Azure 订阅与主体信息；SignPath 要在 GitHub 上安装它的 App。
