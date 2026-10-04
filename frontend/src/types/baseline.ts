/** 基准移交：测斜管换新等导致测点基准切换的登记记录 */
import type { AlarmLevel } from '@/types/alarm'

export interface BaselineHandover {
  id: string
  pointId: string
  /** 冗余坝体 id，便于按坝体筛选 */
  damId: string
  /** 换管日期 YYYY-MM-DD，自该日（含）起观测按新基准展示 */
  handoverDate: string
  /** 旧基准初值（移交登记时测点的当前初值） */
  oldInitialValue: number
  /** 旧管末次读数 */
  oldLastReading: number
  /** 旧管末次观测日期（无观测则为空串） */
  oldLastDate: string
  /** 新管初值（新基准） */
  newInitialValue: number
  /** 换管原因 */
  reason: string
  createdAt: number
  updatedAt: number
}

export interface HandoverDraft {
  handoverDate: string
  oldLastReading: number
  newInitialValue: number
  reason: string
}

export const EMPTY_HANDOVER_DRAFT: HandoverDraft = {
  handoverDate: '',
  oldLastReading: 0,
  newInitialValue: 0,
  reason: ''
}

/** 提交移交时的并发守卫令牌：打开表单那一刻测点的修订时间与已有移交数 */
export interface HandoverExpected {
  pointUpdatedAt: number
  handoverCount: number
}

/** 基准移交后预警级别发生变化时生成的复核项 */
export type ReviewState = '待复核' | '已复核'

export interface BaselineReview {
  id: string
  pointId: string
  /** 冗余坝体 id，便于按坝体筛选 */
  damId: string
  /** 级别发生变化的预警单（已闭环预警不生成） */
  alarmId: string
  /** 引发本次复核的基准移交记录 */
  handoverId: string
  /** 移交前预警单登记级别 */
  oldLevel: AlarmLevel
  /** 新基准下按最新累计变化判定的级别；null 表示不再越限 */
  newLevel: AlarmLevel | null
  state: ReviewState
  /** 复核说明（判定依据） */
  note: string
  createdAt: number
  updatedAt: number
}

export const REVIEW_STATES: ReviewState[] = ['待复核', '已复核']
