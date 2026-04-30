# Tauri Demo

这是一个最小的 Tauri 示例：

- 前端：原生 HTML + CSS + JS
- 后端：Rust
- 能力：前端通过 `invoke("greet")` 调用 Rust 命令

## 运行

先确保本机已安装：

- Node.js
- Rust
- Tauri 的系统依赖

然后在项目目录执行：

```powershell
npm install
npm run dev
```

其中：

- `npm run dev` 会先启动 Vite，再由 Tauri 打开桌面窗口
- `npm run build` 会构建前端并打包桌面应用

如果你想把它改成 Vue、React 或者接入你现有项目，我可以继续直接改。
