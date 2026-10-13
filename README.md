<div align="center">

# 大叔巡站

**DS SITEWATCH · 大叔日记旗下站点监控**

网站状态，一眼掌握。

</div>

---

## 项目说明

大叔巡站是「大叔日记」旗下的轻量级网站监控服务，提供站点状态展示、可用性监测与运维管理界面。

## 功能

| 功能 | 说明 |
|---|---|
| 在线状态监控 | 定时检测 HTTP/HTTPS 网站状态 |
| 响应时间统计 | 记录响应时间并汇总平均值 |
| SSL 证书检查 | 查看证书状态与剩余有效期 |
| 历史记录 | 保存并查看监控历史及可用率 |
| 站点分组 | 自定义分组、图标与颜色 |
| 异常通知 | 支持企业微信与邮件通知 |
| 请求自定义 | 配置请求方式、请求头、状态码和关键词 |
| 自适应界面 | 支持桌面和移动设备，并提供明暗主题 |
| 氛围音乐与界面音效 | 使用发布包内置的《Kiss The Rain》MP3 音轨，默认关闭，可通过页面右下角手动开启或关闭 |

## 技术栈

- 前端：React、Vite、Tailwind CSS
- 接口：Cloudflare Pages Functions
- 定时任务：Cloudflare Workers
- 数据存储：Cloudflare KV
- 自动部署：GitHub Actions

## 部署到 Cloudflare

### 1. 准备 Cloudflare API Token

在 Cloudflare 创建 API Token，并授予部署所需的 Pages、Workers、KV 和账户读取权限。请按 Cloudflare 当前权限界面选择对应权限范围。

### 2. 配置仓库 Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

| Secret | 用途 | 必填 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 部署 Pages、Workers 和 KV | 是 |
| `ADMIN_PASSWORD` | 设置后台密码 | 否 |
| `ADMIN_PATH` | 自定义后台路径 | 否 |

`ADMIN_PATH` 只填写路径名，例如 `my-admin`，不需要添加 `/`；系统会自动去掉路径首尾的斜杠。未设置 `ADMIN_PASSWORD` 时，系统会使用演示默认密码；未设置 `ADMIN_PATH` 时，后台路径为 `/admin`。**正式部署前必须配置独立的 `ADMIN_PASSWORD` 和自定义 `ADMIN_PATH`，不要让线上实例使用演示默认密码。**

### 3. 运行部署工作流

在 GitHub **Actions** 中运行「部署（大叔巡站 · Cloudflare Pages + Worker）」工作流。完成后可在工作流摘要或 Cloudflare Pages 控制台查看站点地址。

工作流使用以下资源名称：

- Pages 项目：`dashu-sitewatch`
- Worker：`dashu-sitewatch`
- KV 命名空间：`dashu-sitewatch`
- KV 绑定名：`MONITOR_DATA`

如果账号中仍有旧名称 `dashu-sitewatch_MONITOR_DATA`，下次部署会将其原地改名为 `dashu-sitewatch`，保留命名空间 ID 和已有监控数据。若旧、新名称的命名空间同时存在，工作流会优先复用新名称对应的命名空间。

## 本地开发

需要 Node.js 和 npm。在 `frontend` 目录安装依赖并构建静态资源：

```bash
cd frontend
npm ci
npm run build
```

在第一个终端启动 Pages Functions 和本地 KV 模拟：

```bash
npx wrangler pages dev dist --ip 127.0.0.1 --port 8787 --kv MONITOR_DATA --compatibility-date 2025-07-18
```

在第二个终端（仍位于 `frontend` 目录）启动前端：

```bash
npm run dev
```

打开 `http://localhost:3000/`。本地模拟 KV 与 Cloudflare 线上数据相互独立；默认本地后台密码为 `admin123456`。

## 使用说明

1. 打开 `/<ADMIN_PATH>` 登录后台；默认地址为 `/admin`。
2. 在「站点管理」中添加要监控的网站，并设置分组和高级检测选项。
3. 在「通知设置」中配置企业微信或邮件渠道，并发送测试通知。
4. 在「网站设置」中调整站点名称、说明文字和页面标题。

## 常见问题

### 登录提示密码错误

检查部署时配置的 `ADMIN_PASSWORD`。本地演示环境在未设置时会使用 `admin123456`；线上实例应在 GitHub Actions Secrets 中配置独立密码。已部署实例也可能在 KV 的 `admin_password` 中保存了单独密码。

### 本地页面无法登录

确保 Pages Functions 正在 `127.0.0.1:8787` 运行，并使用 `--kv MONITOR_DATA` 绑定本地 KV。仅启动 Vite 前端（3000 端口）不会启动 API。

### 忘记后台路径

后台路径由 `ADMIN_PATH` Secret 或 KV 键 `admin_path` 控制。未设置时使用 `/admin`。

### 监控周期和历史保留期

定时检测由 Cloudflare Worker Cron 触发；默认保留 30 天历史数据。可在后台的数据设置中调整相关选项。
