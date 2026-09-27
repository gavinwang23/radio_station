import { getApiUrl } from '@/config/endpoints'

// UI metadata only. Source configuration and credentials belong to the backend.
export const signalModules = [
  {
    id: 'adsb', label: 'ADS-B 航空', icon: 'plane', kind: '航空器位置与遥测',
    description: '接收 1090 MHz ADS-B 消息，展示航空器位置、高度、速度和接收状态。',
    endpoint: getApiUrl('adsb/snapshot'), mapLayer: '航空器目标、标签与本次会话航迹'
  },
  {
    id: 'ais', label: 'AIS 船舶', icon: 'ship', kind: '船舶位置与航行信息',
    description: '接入 AIS 解码结果，包含 MMSI、船名、经纬度、航速、航向和消息时间。',
    endpoint: getApiUrl('ais/snapshot'), mapLayer: '船舶目标与航迹；需接入有效位置消息'
  },
  {
    id: 'sstv', label: 'SSTV 图像', icon: 'image', kind: '慢扫描电视图像',
    description: '接入 SSTV 解码后的图像产品，记录接收时间、模式、频率和文件位置。',
    endpoint: getApiUrl('sstv/products'), mapLayer: '以图像产品为主；没有定位信息的图像不放置地图标记'
  },
  {
    id: 'weather', label: '气象卫星', icon: 'weather', kind: '卫星接收图像产品',
    description: '接入 APT、LRPT 等气象卫星解码产品，记录卫星、接收时间和图像文件位置。',
    endpoint: getApiUrl('weather/products'), mapLayer: '带地理配准信息的产品可叠加影像；原始图像以文件展示'
  },
  {
    id: 'satellites', label: '卫星轨道', icon: 'satellite', kind: '轨道要素与过境预报',
    description: '接入 TLE 等轨道要素及站点过境预报，记录卫星标识、要素历元和计算时间。',
    endpoint: getApiUrl('satellites/elements'), passesEndpoint: getApiUrl('satellites/passes'), mapLayer: '轨道与地面轨迹；需有效轨道要素和计算结果'
  }
]
