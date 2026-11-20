# 应用图标

`resources/icon.png` 来自用户提供的二次元同人图（同人图通常只授权个人欣赏，
不覆盖公开发布与再分发）。

**公开发布前必须满足以下任一项：**

- [ ] 已取得作者针对「随开源软件公开分发、可被任意下载」的书面许可，且许可
      允许再分发图标文件本身；或
- [ ] 已替换为自有 / CC0 / 商用授权的图标，并在本文件记录来源与许可。

未满足前，发布包（`build/windows-amd64/*.exe`）不应包含此图。

替换图标时要改的地方：

1. `resources/icon.png`（源图，建议正方形 ≥ 1024px）
2. 重新 `npx mygo build`，`build/windows-amd64/icon.png` 与安装器图标会重新生成

`README.md` 的「许可」一节也提到这件事：代码 MIT，图标另算。

STATUS: UNCONFIRMED

上面的 STATUS 行由 `scripts/release-check.ps1` 读取，改成 `STATUS: CONFIRMED`
之前，发布门禁会一直提醒。

状态：**待确认**（2026-11-20，维护者 fivenull）。
