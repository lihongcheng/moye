# 墨页 Moye

一个面向 macOS 的本地 Markdown 编辑器。支持实时预览，并导出 Word、PDF、PNG、JPEG 和独立 HTML。

当前版本：**0.1.0**。技术栈为 Electron + React + TypeScript + CodeMirror 6，Word 转换使用随应用打包的 Pandoc。

## 下载安装

前往 **[GitHub Releases 下载最新版本](https://github.com/lihongcheng/moye/releases/latest)**，在 Assets 中选择对应芯片的安装包：

| Mac 芯片 | DMG 安装包 |
| --- | --- |
| Apple Silicon（M 系列） | [Moye-0.1.0-arm64.dmg](https://github.com/lihongcheng/moye/releases/download/v0.1.0/Moye-0.1.0-arm64.dmg) |
| Intel | [Moye-0.1.0-x64.dmg](https://github.com/lihongcheng/moye/releases/download/v0.1.0/Moye-0.1.0-x64.dmg) |

打开 DMG，将「墨页.app」拖入 Applications（应用程序），然后从应用程序文件夹启动。安装包已内置 Electron 和 Pandoc，**不需要安装 Node.js 或 Pandoc**。Release 同时提供 ZIP 和 SHA-256 校验文件。

运行要求：**macOS 13 或更高版本**。当前公开安装包使用 ad-hoc 签名，尚未使用 Apple Developer ID 签名和公证。若 macOS 阻止首次启动，请确认来源为本仓库，尝试打开后前往「系统设置 → 隐私与安全性 → 仍要打开」，按系统提示确认。

## 已实现

- 多标签编辑、新建、打开、最近文件、拖入 Markdown、另存为。
- 编辑 / 分栏 / 预览三种视图，目录跳转、同步滚动、字数统计。
- Markdown 语法高亮、撤销重做、查找替换、格式工具栏。
- GFM 表格、任务列表、代码高亮、KaTeX 公式、Mermaid 图表。
- 本地图片预览、图片粘贴 / 拖入 / 文件选择导入，统一保存到文档旁的 `.assets/`。
- 浅色、深色、跟随系统、编辑字号、可选自动保存。
- 原子文件保存、草稿备份、崩溃后恢复、关闭前保存提示。
- 外部文件变更检测；存在冲突时，可载入磁盘版本，并将未保存内容保留在单独的备份标签。
- macOS 菜单、快捷键、文件关联、窗口位置恢复。

| 导出格式 | 行为 |
| --- | --- |
| Word `.docx` | 正文、标题、表格、公式可继续编辑；Mermaid 转图片；使用 Pandoc 的内置 Word 样式 |
| PDF | Chromium 排版；A4 / Letter、横竖版、边距、页码 |
| PNG / JPEG | 整篇长图或分页图片；1× / 2×；PNG 可透明背景 |
| HTML | 将图片和公式字体内嵌，生成可离线打开的单文件 |

PDF、图片和 HTML 提供经典、书页、极简三种样式。Word 排版与预览不保证像素一致；输出是 `.docx`，不生成旧版 `.doc`。

## 从源码开发

需要 macOS、Node.js 22.12+ 和 npm。首次安装需要网络。

```bash
cd /path/to/moye
npm ci
node node_modules/electron/install.js
npm run setup:pandoc
npm run dev
```

部分新版 npm 会拦截依赖安装脚本，所以上面显式执行 Electron 安装脚本。`setup:pandoc` 只下载到项目内的 `resources/pandoc/<arch>/`，不修改系统安装；版本固定为 3.12，并校验 SHA-256。

```bash
npm run dev:web       # 浏览器 UI 预览：http://127.0.0.1:5173
npm run typecheck     # TypeScript 检查
npm test              # 文件存储与恢复测试
npm run test:e2e      # 构建并启动真实 Electron 应用验证
npm run build        # 生产代码构建
npm run pack         # 生成当前架构的 .app
npm run dist:mac     # 生成当前架构的 DMG / ZIP
```

浏览器模式用于检查编辑界面，支持 Markdown 下载及 HTML 导出；Word、PDF、图片导出和本地文件管理需要桌面版。

在 Apple Silicon 上准备 Intel 构建：

```bash
node scripts/setup-pandoc.mjs --x64
npm run licenses
npm run build
npx electron-builder --mac dmg zip --x64
```

重新生成应用图标：`xcrun swift scripts/make-icon.swift resources`，需要 Xcode Command Line Tools。

## 发布安装包

[macOS 发布工作流](.github/workflows/release-macos.yml) 会分别在 Apple Silicon 和 Intel runner 上构建、测试 DMG / ZIP，并在全部验证通过后上传到 GitHub Releases。公开构建使用 ad-hoc 签名，不需要额外配置 Apple 或 GitHub 密钥。

维护者先将 `package.json` 和 `package-lock.json` 更新到待发布版本并提交，再推送同版本标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

标签必须与 `package.json` 版本一致。也可以在 Actions 中手动运行工作流：选择分支时只构建并保存安装包，不创建 Release；选择版本标签时会发布该版本。已有 Release 不会被自动覆盖。

本地生成相同签名方式的安装包：

```bash
npm run dist:mac -- --publish never -c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.notarize=false
```

本地 `.app` 和 DMG / ZIP 位于 `release/`。正式 Developer ID 签名与公证需要维护者另行提供 Apple 开发者证书和公证凭据。

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| ⌘N / ⌘O | 新建 / 打开 |
| ⌘S / ⇧⌘S | 保存 / 另存为 |
| ⇧⌘E | 导出 |
| ⌘W / ⌘Q | 关闭标签 / 退出应用 |
| ⌘F | 查找与替换 |
| ⌘B / ⌘I | 粗体 / 斜体 |
| ⌘1 / ⌘2 / ⌘3 | 分栏 / 仅编辑 / 仅预览 |
| ⌘, | 设置 |
| ⌘\ | 切换侧边栏 |

## 数据与边界

- Markdown 文件由用户选择保存位置，UTF-8 原样保存。会话草稿、设置和最近文件保存在 `~/Library/Application Support/墨页/`。通过 `MOYE_USER_DATA` 可为测试指定独立目录。
- 自动保存默认关闭。会话草稿在停止修改后约半秒内写入，用于恢复尚未手动保存的内容；强制终止可能丢失最后半秒内的输入。
- 文字在本机处理，没有账号、云同步或文档上传。Markdown 引用的 HTTP(S) 图片会连接原地址；导出时下载并嵌入。
- 文档最大 10 MB，单张图片最大 25 MB。本地图片限定在文档所在目录及其子目录；其他位置的图片请通过“插入图片”复制进来。
- 跨目录另存为时，相对图片会转成内嵌数据，以保留可用性，因此 Markdown 文件可能增大。
- 长图最多约 6000 万像素，单边高度不超过 30000 像素；超过时会提示切换分页或降低倍率。分页最多 100 张，以页面高度切分，跨页段落可能被截开，完整排版建议使用 PDF。
- 原始 HTML 不执行；不支持通过 Markdown 注入脚本、任意 HTML 或任意本地文件读取。
- 当前采用源码编辑 + 预览，尚未实现所见即所得编辑、云协作、插件系统、自动更新、自定义 Word 模板。

## 项目结构

```text
src/main/              Electron 主进程、文件存储、导出
src/preload/           受限 IPC 接口
src/shared/            类型与默认设置
src/renderer/src/      编辑器、预览、对话框与样式
scripts/               Pandoc 安装、图标、许可证和桌面测试
tests/                 文件保存和恢复测试
resources/             应用图标、权限声明、第三方许可
out/                   构建输出
release/               macOS 应用与安装包
test-results/          测试截图、DOCX/PDF/图片/HTML 实际导出样本
```

桌面测试使用独立临时文档和用户目录，覆盖五种格式的真实文件、Word XML 内容、外部修改冲突、图片路径和导入、跨目录另存为、分页透明 PNG、长图限制、键盘编辑、主题、崩溃恢复及退出确认。不会改动用户文档。

打包后验证：

```bash
MOYE_TEST_EXECUTABLE="$PWD/release/mac-arm64/墨页.app/Contents/MacOS/墨页" \
  node scripts/smoke-test.mjs
```

许可证见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
