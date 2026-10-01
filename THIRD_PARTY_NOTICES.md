# 第三方组件

墨页自己的源代码使用 MIT License。第三方组件各自保留原许可证。

## Pandoc 3.12

- Copyright © John MacFarlane and other contributors.
- 许可证：GNU General Public License，版本 2 或更新版本（GPL-2.0-or-later）。
- 官网：https://pandoc.org/
- 对应源代码：https://github.com/jgm/pandoc/tree/3.12
- 源码归档：https://github.com/jgm/pandoc/archive/refs/tags/3.12.tar.gz
- 二进制来源：https://github.com/jgm/pandoc/releases/tag/3.12
- 完整许可证：`resources/legal/PANDOC-COPYING.md`；应用内位于 `Contents/Resources/pandoc/COPYING.md`。

墨页将未修改的 Pandoc 作为独立可执行程序，通过命令行调用。下载脚本固定版本并校验官方发布包的 SHA-256。上述源码链接用于定位对应源代码；向第三方分发包含 Pandoc 的安装包时，还需按 GPL 要求提供完整对应源代码或有效的书面提供承诺。

## Electron 与 JavaScript 组件

应用使用 Electron、React、CodeMirror、unified/remark/rehype、KaTeX、Mermaid、DOMPurify、highlight.js 与 Lucide 等开源组件。精确版本锁定在 `package-lock.json`。

`npm run licenses` 会从已安装的依赖生成 `resources/legal/npm-licenses.txt`，包含生产依赖的版权与许可文本，并随应用打包。Electron / Chromium 的许可文本同时由 Electron 运行时提供。
