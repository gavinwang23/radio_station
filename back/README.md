# Radio Station Express API

Node.js 20+，Express 5，ESM JavaScript。后端接收 dump1090 30002 TCP AVR 报文并完成 ADS-B 协议解码，提供统一 API、WebSocket、航空器资料查询和模块注册。SDR 采样与射频解调仍由 dump1090 或其他外部接收程序完成。

## 启动

```powershell
cd back
npm.cmd install
Copy-Item .env.example .env
# 编辑 .env 后启动
npm.cmd run dev
```

正式运行使用 `npm.cmd start`；验证使用 `npm.cmd test`。其他系统可直接使用 `npm`。默认监听 `http://127.0.0.1:3000`，通过 `HOST` / `PORT` 设置。`.env`、`node_modules` 和 `storage` 不应提交。数据库密码和 Google Key 只保留在后端 `.env`。

同一个端口只启动一个后端进程。遇到 `EADDRINUSE`，先在已有后端终端按 Ctrl+C，再重新启动；也可修改后端 `PORT`，并将前端 `VUE_APP_BACKEND_URL` 改为相应地址后重启前端。监听失败会明确提示占用的端口，不打印成功启动日志。

前后端连接与地图配置说明见 [环境配置](../docs/environment.md)。Google 官方上游默认是 `GOOGLE_MAPS_API_BASE_URL=https://tile.googleapis.com`，可在后端 `.env` 配置受控 HTTP(S) 代理地址；`GOOGLE_MAPS_API_KEY` 仅在后端使用。修改后端配置后重启服务。

`DB_NAME` 未填写时，数据库状态是 `unconfigured`，不会创建连接池或发起数据库请求。健康检查不依赖数据库成功。启动后初始化接收源时，会幂等创建 `signal_sources` 和 `rs_schema_migrations` 两张应用表，再读取配置；也可用 `npm.cmd run migrate` 提前建表。数据库账号须有新表创建及接收源表读写权限。用户导入的航空器资料表只读，迁移不会修改它。

`DB_QUERY_TIMEOUT_MS` 默认 5000，允许 1–120000 毫秒，是每次数据库操作从连接池排队到语句准备、执行的总截止时间。执行超时会销毁连接，避免未完成语句回到连接池；排队超时后若取得连接，只归还连接，不执行 SQL。查询超时返回 `504 DATABASE_TIMEOUT`，数据库状态接口返回 `unavailable` 和超时原因；服务健康检查保持可用。

## API

| 方法与路径 | 数据 |
| --- | --- |
| `/api/v1/health` | HTTP 服务健康与运行时间 |
| `/api/v1/modules` | `{ id, label, kind, status, endpoints }` 数组 |
| `/api/v1/database/status` | `unconfigured` / `available` / `unavailable` |
| `GET /api/v1/adsb/source` | 数据库保存的接收源及实时连接状态 |
| `PUT /api/v1/adsb/source` | 保存接收源，成功后切换 TCP 接收器 |
| `GET /api/v1/adsb/snapshot` | 后端解码产生的当前目标快照 |
| `WS /api/v1/stream` | 后端主动推送目标与接收状态 |
| `/api/v1/adsb/catalog/schema` | 已导入资料表的只读列结构与映射状态 |
| `/api/v1/adsb/catalog/:icao` | 六位十六进制 ICAO 对应的航空器资料 |
| `/api/v1/maps/config` | 可用底图描述 |
| `/api/v1/maps/google/tiles/:z/:x/:y` | Google 官方 Map Tiles API 图像 |
| `/api/v1/maps/google/viewport` | 视口版权归属信息 |

JSON 响应统一为 `{ "ok": true, "data": ..., "meta": { "requestId": "..." } }`；错误为 `{ "ok": false, "error": { "code": "...", "message": "..." }, "meta": { "requestId": "..." } }`。`X-Request-Id` 可由客户端传入安全且长度不超过 128 的字符串，否则自动生成 UUID。内部 SQL、堆栈、数据库密码和 Google Key 不返回给客户端。地图图像响应保持二进制。

### ADS-B 接收源

前端“数据接入”通过 `PUT /api/v1/adsb/source` 保存 `{ name, host, port, enabled, station: { name, latitude, longitude } }`。`host` 是主机名或 IP，不能填 HTTP URL；默认端口 `30002`，协议为 `avr-tcp`。经纬度未设置时使用 `null`。数据库保存失败不切换当前 TCP 接收器，也不报告保存成功。`GET` 返回 `{ source, persisted, status, revision }`；无记录时提供停用的可编辑默认值，不将它标记为已保存。

后端启动后恢复配置；首次数据库读取失败会退避重试。连接超时、30 秒无原始字节或断开会自动重连，退避 1–30 秒。切换、停用或断连清理旧目标。`waiting` 表示 TCP 已连接但当前没有有效支持的 ADS-B 报文；超过 15 秒没有有效帧也回到 `waiting`，原始心跳不能维持“接收中”。最近字节与有效报文时间分别记录。CRC 无效和不支持的报文不会生成目标。

当前解码 DF17 与 DF18 CF0 的呼号、Q 位气压高度、GNSS 高度、速度/航向/垂直率及配对空中 CPR 位置。地面位置无参考条件不猜测；Q0 高度及不支持的报文保持未知。详细支持范围见 [解码器说明](src/modules/adsb/decoder/README.md)。快照保留 dump1090 常用字段与 ft/kt 单位，每秒推送；实时目标保存在有界内存中，不自动写入历史资料表。

WebSocket 消息为 `{ "type": "adsb.snapshot", "data": { "snapshot": { "now": ..., "messages": ..., "aircraft": [...] }, "status": ..., "source": ..., "persisted": true, "revision": ... } }`。快照携带对应配置，支持多个页面同步接收源与实际站点；`revision` 在服务进程内单调。通道只接收服务端推送，支持心跳、慢客户端限制与关停清理；前端不解码原始报文。生产反向代理必须转发 Upgrade/Connection。新信号类型可复用通道，以独立 `type` 识别事件。

HTTP 快照未配置或停用返回 `503 ADSB_SOURCE_UNCONFIGURED`，TCP 不可用返回 `503 ADSB_SOURCE_UNAVAILABLE`；`waiting` 时可返回空快照。模块发现的 `configured` 只表示输入源已设置，实时接收请查看 `status`。旧 HTTP JSON Adapter 保留为独立模块，默认应用不再装配，也不读取 `ADSB_SOURCE_URL` 作为实时输入。

### 已导入航空器资料

设置 `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`。资料表权限可仅为只读；应用配置表需要创建、读写权限。随后设置实际表名 `ADSB_TABLE`，不要把未知表结构当作迁移模板。

本地连接使用用户确认的数据库名 `radio_station`；具体主机和凭据仅在未提交的 `.env` 中保存。

```dotenv
ADSB_TABLE=aircraft
ADSB_COLUMN_MAPPING={"icao":"ModeS","registration":"Registration","type":"ICAOTypeCode","manufacturer":"Manufacturer","operator":"Operator"}
```

此示例仅说明配置格式，须替换成导入表的真实列名。逻辑字段仅支持 `icao`（必需）、`registration`、`type`、`manufacturer`、`operator`；未映射字段不查询。默认仅映射 `icao -> icao`，表名默认未配置。表/列名允许字母、数字、下划线、美元符号、连字符（1–64 字符），统一引用；查询值使用参数绑定。

`catalog/schema` 在数据库未配置、不可用、表未配置、表不存在/不可见、字段不匹配时分别返回 `database_unconfigured`、`database_unavailable`、`table_unconfigured`、`table_missing`、`column_mismatch`，可用于接入检查；`ready` 表示字段匹配。查询接口在这些状态下返回明确 503 错误。参数无效返回 400，资料不存在返回 404。当前只读取资料，不把资料表作为实时位置源。若实际导入表存储历史位置，应新增独立 Observation Repository。

## 模块扩展

`src/modules/<id>/` 独立存放 Router、Service、Repository、输入 Adapter。已登记 `adsb`、`ais`、`sstv`、`weather`、`satellites`；后四个为 `not_connected` 占位，不宣称已实现接收、解码或轨道计算。

`ModuleRegistry.register({ id, label, kind, router, status, endpoints })` 登记模块，`status` 可以是字符串或异步函数；`mount(app)` 挂载 `/api/v1/<id>`，`list()` 返回不含内部 router/config 的描述数组。应用装配时也可通过 `createApp({ config, modules: [module] })` 覆盖默认模块或增加独立模块。例如提供 `id: 'satellites'` 的 router 即替换默认占位。`app.locals.moduleRegistry` 提供注册表，`app.locals.database` 提供连接池生命周期入口。

- AIS：适配外部 NMEA/JSON 解码输出，实时位置提供 `/snapshot`，静态 MMSI 资料和历史观测使用独立 Repository。
- SSTV/气象卫星：使用 `/products` 列出解码器已生成图像；文件放受控文件系统或对象存储，MariaDB 保存索引与元数据。产品建议包含 `{ id, module, stationId, capturedAt, receivedAt, mimeType, width, height, assetUrl, thumbnailUrl, footprint, metadata }`。无地理范围时仅在图库显示；明确 WGS 84 范围后才叠加地图。不要把图像产品混作位置快照。
- 卫星轨道：`/elements` 管理外部 TLE/OMM，`/passes` 基于接收站和轨道传播计算 AOS、LOS、最大仰角及时间。元素建议包含 `{ noradId, name, format, epoch, line1, line2, importedAt, source }`。结果需报告元素时间与新鲜度，不生成虚构轨道。站点配置位于 `config.station`，未填经纬度时不得用零作为实际站址。

通用观测建议使用 `{ id, module, sourceId, observedAt, position: { longitude, latitude, altitudeMeters }, motion: { speedMetersPerSecond, courseDegrees }, attributes, raw }`；未知值使用 `null`，时间使用 UTC ISO 8601，地理坐标为 WGS 84。详细边界见根目录 `docs/architecture.md`。

所有模块使用统一响应和 `AppError(status, code, message)`，外部请求应有超时，查询应绑定参数。新增模块时验证失败状态、输入边界和数据单位。`SIGINT` / `SIGTERM` 停止 TCP、快照定时器和 WebSocket，再停止 HTTP 并关闭数据库连接池，10 秒后强制退出。
