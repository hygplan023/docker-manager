# Docker 管理中心

> 开发工作室：**南充远达文化广告策划工作室**

## 项目简介

本平台基于 Docker 可视化管理 Ollama 本地大模型，支持容器启停、模型拉取、安全检测、Codex / Claude Code 本地直连调试，Windows / macOS 一键部署，无需复杂命令行操作。

## 核心功能

- Ollama 容器可视化管控，自动检测 11434 端口运行状态
- 本地模型拉取、查看、参数配置、性能测试
- Codex CLI 一键配置，自动生成跨平台启动脚本
- 离线安装包一键解压启动，适配 Windows 批处理 / macOS 脚本
- 完整 API 连通检测工具，快速排查本地模型连接问题

## 离线安装包下载

**永久下载链接（永不过期）：**

👉 https://github.com/hygplan023/docker-manager/raw/main/dist-package.zip

点击即可直接下载离线安装包 `dist-package.zip`（约 500 KB，仅含源码与启动脚本）。该链接指向仓库内文件，永久有效、不会过期。

> 安装包不含 `node_modules`，首次运行启动脚本时会自动执行 `pnpm install` 联网安装依赖，请保持网络畅通并耐心等待。

## 本地部署教程

1. 下载仓库内离线安装包 `dist-package.zip`
2. Windows：双击一键启动 `start-windows.bat`
3. macOS / Linux：终端执行 `./start-mac.sh`
4. 访问本地地址 http://localhost:11434 进入管理面板

## 适配环境

- Windows 10/11、macOS 12+
- Docker Desktop 4.70 及以上
- Node.js 20 LTS、pnpm 包管理器

## 版权信息

©2026 南充远达文化广告策划工作室 版权所有
