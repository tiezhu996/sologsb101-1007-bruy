/**
 * 测点基准移交（换管 / 基准重设）
 * - 移交登记：换管日期、旧管末次读数、新管初值、原因
 * - 换管当天起累计变化按新基准展示；原观测保留当时结果并挂在旧基准
 * - 跨日速率始终按相邻原始读数差值 ÷ 间隔天数，与基准无关
 * - 已闭环预警不参与历史重算；移交前后级别变化生成待复核项
 */
import type { AlarmLevel } from '@/types/alarm'

/** 换管 / 移交原因 */
export type HandoverReason = '测斜管换新' | '测斜管损坏' | '测斜管堵塞' | '基准校核调整' | '其他'

export const HANDOVER_REASONS: HandoverReason[] = ['测斜管换新', '测斜管损坏', '测斜管堵塞', '基准校核调整', '其他']

/** 基准移交记录（一次换管 = 一条；后到的移交不能覆盖先完成的移交） */
export interface BaselineHandover {
  id: string
  pointId: string
  /** 冗余坝体 id */
  damId: string
  /** 同一测点第几次移交（从 1 起） */
  seq: number
  /** 换管日期 YYYY-MM-DD：当天起按新基准展示累计变化 */
  effectiveDate: string
  /** 旧管末次读数日期 */
  oldLastReadingDate: string
  /** 旧管末次读数（原始读数） */
  oldLastReading: number
  /** 移交前正在使用的初值（旧基准初值） */
  previousInitialValue: number
  /** 新管初值（新基准初值） */
  newInitialValue: number
  reason: HandoverReason
  /** 换管原因说明 / 备注 */
  note: string
  /** 登记人 */
  operator: string
  createdAt: number
  updatedAt: number
}

/** 移交表单草稿（写入失败后保留，可重试） */
export interface HandoverDraft {
  pointId: string
  effectiveDate: string
  oldLastReadingDate: string
  oldLastReading: number
  newInitialValue: number
  reason: HandoverReason
  note: string
  operator: string
}

export type ReviewStatus = '待复核' | '已复核'

/** 基准移交引起的级别变化待复核项 */
export interface BaselineReview {
  id: string
  pointId: string
  damId: string
  /** 触发复核的移交记录 */
  handoverId: string
  effectiveDate: string
  /** 移交前级别（按旧管末次读数与旧基准判定，null 为正常） */
  fromLevel: AlarmLevel | null
  /** 移交后级别（按新基准下最新读数判定，null 为正常） */
  toLevel: AlarmLevel | null
  fromCumulative: number
  toCumulative: number | null
  status: ReviewStatus
  reviewer: string
  reviewRemark: string
  createdAt: number
  reviewedAt: number | null
  updatedAt: number
}

export function createEmptyHandoverDraft(pointId = ''): HandoverDraft {
  return {
    pointId,
    effectiveDate: '',
    oldLastReadingDate: '',
    oldLastReading: 0,
    newInitialValue: 0,
    reason: '测斜管换新',
    note: '',
    operator: ''
  }
}
