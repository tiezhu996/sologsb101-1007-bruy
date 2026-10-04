/** 观测：某测点某日的读数记录 */
export interface Observation {
  id: string
  pointId: string
  /** 观测日期 YYYY-MM-DD */
  date: string
  /** 读数 */
  reading: number
  /** 累计变化（读数 − 当时基准初值，按观测当时结果固化，历史重算不改写） */
  cumulative: number
  /** 日速率（与相邻原始读数的差值 ÷ 间隔天数，跨换管边界仍按原始读数计算） */
  dailyRate: number
  /** 所属基准：null = 原始基准；否则为基准移交记录 id */
  baselineId: string | null
  observer: string
  createdAt: number
  updatedAt: number
}

export interface ObservationDraft {
  pointId: string
  date: string
  reading: number
  observer: string
}

export const EMPTY_OBSERVATION_DRAFT: ObservationDraft = {
  pointId: '',
  date: '',
  reading: 0,
  observer: ''
}

/** 单测点观测序列取点 */
export interface TrendPoint {
  seq: number
  date: string
  reading: number
  cumulative: number
  dailyRate: number
}

/** 观测录入页的成组录入行 */
export interface ObservationBatchRow {
  pointId: string
  date: string
  reading: number
  observer: string
}
