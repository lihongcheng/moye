墨页是面向 macOS 的本地 Markdown 编辑器，支持实时预览，以及 Word、PDF、PNG、JPEG、独立 HTML 导出。

## 下载安装

需要 **macOS 13 或更高版本**。在下方 Assets 中按芯片选择安装包：

| Mac 芯片 | 安装包 |
| --- | --- |
| Apple Silicon（M 系列） | `Moye-版本号-arm64.dmg` |
| Intel | `Moye-版本号-x64.dmg` |

打开 DMG，将「墨页.app」拖入 Applications（应用程序），然后从应用程序文件夹启动。安装包已包含 Electron 和 Pandoc，无需安装 Node.js 或其他依赖。ZIP 是同一应用的压缩版。

## 首次打开

当前安装包使用 ad-hoc 签名，**尚未使用 Apple Developer ID 签名和公证**。macOS 可能阻止首次启动。确认下载来源为本仓库后，先尝试打开应用，再到「系统设置 → 隐私与安全性」点击「仍要打开」，按系统提示确认。无需关闭系统安全保护。

## 验证

发布流程在 Apple Silicon 和 Intel 架构分别运行文件存储测试、打包应用的桌面测试（含五种格式导出）、代码签名完整性检查和 DMG 校验；全部通过后才发布。

`SHA256SUMS.txt` 提供 DMG 和 ZIP 的 SHA-256 校验值。
