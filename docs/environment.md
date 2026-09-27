# 环境配置

前端使用 Vue CLI 的 `.env` 加载机制。开发默认值在 `front/.env.development`，生产默认值在 `front/.env.production`。本机覆盖可复制 `front/.env.local.example` 为 `.env.development.local` 或 `.env.production.local`，不提交覆盖文件。修改开发配置须重启 `npm.cmd run dev`，生产配置须重新执行 `npm.cmd run build:prod`。

| 前端变量 | 含义 |
| --- | --- |
| `DEV_SERVER_PORT` | 开发服务器端口，默认 `9528` |
| `VUE_APP_BACKEND_URL` | 开发代理连接的 Express 地址，默认 `http://127.0.0.1:3000`；只影响开发代理 |
| `VUE_APP_API_BASE_URL` | 浏览器 HTTP API 前缀，默认 `/api/v1`；可使用完整 HTTPS 地址 |
| `VUE_APP_WS_URL` | WebSocket 地址；留空时从 API 地址派生 `/stream`，自动转换为 `ws` / `wss` |
| `VUE_APP_API_TIMEOUT_MS` | HTTP 请求超时，默认 `8000` 毫秒 |
| `VUE_APP_MAP_DEFAULT_LAYER` | 初始图层：`esri-satellite`、`google-satellite`、`dark`、`offline` |
| `VUE_APP_MAP_ESRI_URL` | Esri 卫星瓦片模板，保留 `{z}/{y}/{x}` 占位符 |
| `VUE_APP_MAP_CARTO_URL` | CARTO 瓦片模板，保留 `{z}/{x}/{y}` 占位符 |
| `VUE_APP_MAP_GOOGLE_TILES_PATH` | Google 后端瓦片路径，默认 `maps/google/tiles/{z}/{x}/{y}` |
| `VUE_APP_MAP_GOOGLE_VIEWPORT_PATH` | Google 后端视口版权路径，默认 `maps/google/viewport` |
| `VUE_APP_CESIUM_BASE_URL` | Cesium 静态资源目录；留空使用部署目录中的 `cesium/` |
| `VUE_APP_MAP_OFFLINE_URL` | 离线 Natural Earth 图层目录；留空使用 Cesium 内置资源 |

开发环境中，相对的 API 前缀由 Vue 开发服务器代理至 Express 的 `/api/v1`。例如前端前缀 `/radio-api` 会被转写为后端 `/api/v1`。生产环境没有 Vue 开发代理，须配置同源反向代理并支持 WebSocket Upgrade，或将 API/WS 配置为可访问的后端地址。

后端配置在 `back/.env`，新环境从 `back/.env.example` 复制后填写。修改后重启 Express。

| 后端变量 | 含义 |
| --- | --- |
| `HOST` / `PORT` | Express 监听地址与端口 |
| `CORS_ORIGINS` | 允许的浏览器来源，逗号分隔 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MariaDB 连接；本项目数据库名为 `radio_station` |
| `DB_QUERY_TIMEOUT_MS` | 单次数据库操作总截止时间，默认 `5000` 毫秒 |
| `GOOGLE_MAPS_API_KEY` | Google Map Tiles API 密钥，只保存在后端 |
| `GOOGLE_MAPS_API_BASE_URL` | Google 上游，默认 `https://tile.googleapis.com`；支持受控 HTTP(S) 代理及路径前缀 |
| `ADSB_TABLE` / `ADSB_COLUMN_MAPPING` | 已导入航空器资料表及字段映射 |

dump1090 主机和 `30002` 端口通过页面“数据接入”保存到 MariaDB 的 `signal_sources` 表。它是可在线变更的接收源配置，不依赖前端环境变量，后端重启后自动恢复。

`VUE_APP_*` 会写入公开的前端构建产物，不能存放数据库密码或 Google Key。根目录 `.gitignore` 排除后端 `.env` 和本机覆盖文件，保留前端公共默认配置及 `.env.example`。
