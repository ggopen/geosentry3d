/**
 * 核心领域类型定义
 * 所有模块共享的统一数据模型，保证松散耦合。
 */

/** 三维向量（局部 ENU 坐标，单位：米） */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 可识别的空间对象类型 */
export type ObjectType =
  | 'door'
  | 'window'
  | 'building'
  | 'fence'
  | 'pole'
  | 'road'
  | 'tree'
  | 'ground'
  | 'unknown'

/** 对象包围盒信息（v1.1：增加真实边界与形状特征） */
export interface BoundingInfo {
  /** 中心点（地理坐标） */
  center: { lon: number; lat: number; height: number }
  /** 短边尺寸（米，最小面积外接矩形） */
  width: number
  /** 长边尺寸（米，最小面积外接矩形） */
  length: number
  /** 高度（相对地面基准，米） */
  height: number
  /** 长轴方位角（度，0=北，顺时针） */
  orientationDeg: number
  /** 地面基准高（米） */
  groundHeight: number
  /** 真实边界（凹包多边形，经纬度，不闭合）。v1.1 起取代纯立方体近似 */
  footprint?: Array<{ lon: number; lat: number }>
  /** 边界多边形测地面积（米²） */
  footprintArea?: number
  /** 边界周长（米） */
  perimeter?: number
  /** 形状特征（长宽比 / 圆形度 / 密实度） */
  shapeFeatures?: {
    aspectRatio: number
    circularity: number
    solidity: number
  }
}

/** 空间对象 */
export interface SpatialObject {
  id: string
  type: ObjectType
  /** 识别置信度 0~1 */
  confidence: number
  bbox: BoundingInfo
  properties: Record<string, number | string>
}

/** 测量类型 */
export type MeasurementKind =
  | 'distance'
  | 'width'
  | 'length'
  | 'height'
  | 'area'
  | 'volume'
  | 'angle'
  | 'clearance'

/** 单项测量结果 */
export interface Measurement {
  kind: MeasurementKind
  /** 数值（由测量工具得出，绝不允许臆造） */
  value: number
  unit: string
}

/** 合规状态 */
export type ComplianceStatus = 'PASS' | 'FAIL' | 'WARN'

/** 违规明细 */
export interface Violation {
  rule: string
  actual: number | string
  expected: string
  severity: 'error' | 'warning'
}

/** 合规审查结果 */
export interface ComplianceResult {
  status: ComplianceStatus
  violations: Violation[]
  /** IF...THEN 推导出的属性，例如 { fireLevel: 'Level1' } */
  derived: Record<string, string | number>
}

/** 空间标注规格 */
export interface AnnotationSpec {
  objectId: string
  label: string
  /** Red=违规 Yellow=警告 Green=合规 */
  color: 'red' | 'yellow' | 'green'
}

/** 单对象完整巡检报告项 */
export interface InspectionResult {
  objectId: string
  objectType: ObjectType
  confidence: number
  measurements: Measurement[]
  compliance: ComplianceResult
  annotations: AnnotationSpec[]
  recommendations: string[]
  bbox: BoundingInfo
}

/** 合规规则定义（DSL） */
export interface Rule {
  name: string
  /** DSL 条件表达式，如 "door.width >= 0.9" */
  condition: string
  severity: 'error' | 'warning'
  /** 适用对象类型，缺省表示所有类型 */
  appliesTo?: ObjectType[]
  /** 期望值描述（用于报告展示） */
  expected: string
}
