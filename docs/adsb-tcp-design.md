# ADS-B TCP 接收与推送

用户要求将页面填写的 dump1090 地址保存到 MariaDB，通过 30002 原始报文端口接收，在后端解码后由 WebSocket 推送给前端。

链路为：页面保存接收源 → `signal_sources` → 后端 TCP 接收器 → AVR 分帧 → Mode S / ADS-B 校验解码 → 有界航空器状态 → `/api/v1/stream` → Cesium。浏览器不直接访问 TCP 端口，也不再轮询接收机 JSON。

新增 `rs_schema_migrations` 和 `signal_sources`，仅管理平台自己的结构。原有航空器资料导入表保持独立，实际表名/列映射仍由用户导入后配置。本次持久化接收源配置；实时航空器状态保留于内存，不逐帧写数据库。

30002 使用 AVR 文本格式。解析器处理拆包、粘包、噪声和长度上限；解码器验证 CRC，并合并呼号、高度、速度、航向及位置。空中 CPR 位置需要同一航空器时间接近的偶/奇帧，不能从单条压缩位置消息猜测经纬度。无支持的高度编码或地面定位参考时保留未知值。

保存接口先写数据库再切换接收器；数据库失败不能显示已保存或使用临时配置冒充持久化。后端重启读取已启用配置，数据库暂时不可用时退避重试。TCP 连接成功、等待有效数据、正在接收、断线重连和停用分别报告。只有字节心跳而 15 秒无有效报文时回到等待状态，不把心跳当飞机数据。切源与断线清除旧目标，避免显示过期空域。

WebSocket 同源复用 HTTP 端口，发送 `{type:'adsb.snapshot',data:{snapshot,status,source,persisted,revision}}`，连接立即发送当前状态，后续按一秒合并推送。每个快照携带对应接收源配置，多页面切源时同步实际站点，不覆盖正在编辑的草稿。实时模式停用源时仍订阅配置变化；revision 在服务实例内单调，新连接接受新的实例初始状态。设置消息大小、慢客户端积压上限和 ping/pong 清理；客户端断线自动重连，忽略旧连接事件，卸载时停止。WebSocket 连通不代表 dump1090 接收正常。

验证使用已知 ADS-B 报文、本地 TCP 模拟接收机和真实 WebSocket 客户端。远程库只创建上述平台表、读取目录；不写入模拟接收地址或模拟航班。真实接收机地址未提供时不宣称已接收真实信号。

参考：[FlightAware 数据流说明](https://flightaware.engineering/sdr-hardware-software-architecture/)、[dump1090](https://github.com/flightaware/dump1090)、[ws](https://github.com/websockets/ws)。
