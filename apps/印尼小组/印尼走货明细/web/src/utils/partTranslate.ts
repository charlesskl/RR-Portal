// 塑胶/搪胶件中文名 → 英文（本地术语词典，离线、确定性）。
// 处理方位前缀（左/右/前/后/上/下/顶/内/外…）与后缀（配件/组件/件）。未命中返回 ''。

// 方位前缀
const POS: Record<string, string> = {
  左: 'Left', 右: 'Right', 前: 'Front', 后: 'Rear', 上: 'Upper', 下: 'Lower',
  顶: 'Top', 底: 'Bottom', 内: 'Inner', 外: 'Outer', 大: 'Large', 小: 'Small', 中: 'Middle',
}

// 部件名词词典（尽量收常见汽车/玩具部件；按需扩充）
const TERMS: Record<string, string> = {
  排气管: 'Exhaust pipe', 排气管柱: 'Exhaust pipe column', 排气管孔: 'Exhaust pipe hole',
  喇叭: 'Horn', 保险杠: 'Bumper', 挡泥板: 'Fender', 轮挡泥板: 'Wheel fender',
  扶手: 'Armrest', 视镜: 'Mirror', 后视镜: 'Rear-view mirror', 倒后镜: 'Rear-view mirror',
  门: 'Door', 车门: 'Door', 车窗: 'Window', 窗: 'Window',
  按件: 'Button part', 按钮: 'Button', 配件: 'Accessory',
  车顶: 'Roof', 顶盖: 'Top cover', 盖: 'Cover', 底盖: 'Bottom cover', 罩: 'Cover',
  轮: 'Wheel', 车轮: 'Wheel', 轮胎: 'Tire', 轮毂: 'Hub', 轮轴: 'Wheel axle', 轴: 'Axle',
  座位: 'Seat', 座椅: 'Seat', 台架: 'Stand', 支架: 'Bracket',
  压簧: 'Compression spring', 弹簧: 'Spring', 螺丝: 'Screw', 螺母: 'Nut',
  方向盘: 'Steering wheel', 引擎盖: 'Hood', 车身: 'Body', 车架: 'Frame',
  底盘: 'Chassis', 底架: 'Underframe',
  货斗: 'Cargo bed', 车斗: 'Truck bed', 油箱: 'Fuel tank',
  灯: 'Light', 车灯: 'Light', 大灯: 'Headlight', 尾灯: 'Taillight', 灯罩: 'Lamp cover',
  把手: 'Handle', 手柄: 'Handle', 踏板: 'Pedal', 栏杆: 'Railing',
  链条: 'Chain', 履带: 'Track', 铲: 'Shovel', 铲斗: 'Bucket', 吊臂: 'Boom',
  天线: 'Antenna', 标牌: 'Nameplate', 装饰件: 'Trim', 装饰条: 'Trim strip',
  踏脚: 'Footstep', 水箱: 'Radiator', 散热器: 'Radiator', 排挡: 'Gear lever',
  仪表: 'Dashboard', 仪表盘: 'Dashboard', 挡风玻璃: 'Windshield',
  工具箱: 'Toolbox', 箱: 'Box', 蓄电池: 'Battery', 电池: 'Battery',
  过滤器: 'Filter', 滤芯: 'Filter element', 前灯: 'Headlight',
  操纵杆: 'Control lever', 杆: 'Lever', 拉杆: 'Pull rod', 连杆: 'Connecting rod',
  挡板: 'Baffle', 隔板: 'Partition', 卡扣: 'Clip', 卡子: 'Clip',
  齿轮: 'Gear', 凸轮: 'Cam', 滑块: 'Slider', 转轴: 'Pivot',
}

// 名词（含后缀拆解）翻译
function transNoun(s: string): string {
  if (!s) return ''
  if (TERMS[s]) return TERMS[s]
  const sufs: [string, string][] = [['配件', 'accessory'], ['组件', 'assembly'], ['盖', 'cover'], ['罩', 'cover'], ['件', 'part'], ['条', 'strip'], ['架', 'bracket']]
  for (const [suf, en] of sufs) {
    if (s.endsWith(suf) && s.length > suf.length) {
      const base = transNoun(s.slice(0, -suf.length))
      if (base) return `${base} ${en}`
    }
  }
  return ''
}

// 中文部件名 → 英文（未命中返回 ''）
export function translatePartName(zh?: string): string {
  let s = String(zh || '').trim()
  if (!s) return ''
  if (TERMS[s]) return TERMS[s]
  s = s.replace(/^车(?=.)/, '')              // 去掉作为整体前缀的「车」（车左门→左门）
  // 尾部数字（过滤器1 → Filter 1）
  let numSuffix = ''
  const nm = s.match(/(\d+)$/)
  if (nm) { numSuffix = ' ' + nm[1]; s = s.slice(0, -nm[1].length) }
  // 头部方位（前/左/顶…）
  const pos: string[] = []
  while (s.length > 1 && POS[s[0]]) { pos.push(POS[s[0]]); s = s.slice(1) }
  // 尾部方位（前灯罩左 → … Left）
  const tail: string[] = []
  while (s.length > 1 && POS[s[s.length - 1]]) { tail.unshift(POS[s[s.length - 1]]); s = s.slice(0, -1) }
  const noun = transNoun(s)
  if (!noun) return ''
  return [...pos, noun, ...tail].join(' ') + numSuffix
}
