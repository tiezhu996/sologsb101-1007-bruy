/**
 * 由测点类型、阈值与观测值推导蓝/黄/橙/红级别并生成预警草稿
 * 被监测录入、预警闭环两页消费。
 */
import { useCallback, useMemo } from 'react'
import type { Point } from '@/types/point'
import type { AlarmDraft, AlarmLevel } from '@/types/alarm'
import { ALARM_LEVELS } from '@/types/alarm'
import {
  ALARM_BG,
  ALARM_COLOR,
  alarmBasis,
  alarmLevelOf,
  cumulativeOf,
  ratioOf,
  severityScore
} from '@/utils/threshold'

export interface AlarmEvaluation {
  cumulative: number
  ratio: number
  level: AlarmLevel | null
  /** 是否进入预警区间（蓝级及以上） */
  exceeded: boolean
  score: number
}

export interface AlarmDraftResult {
  draft: AlarmDraft
  /** 判定依据文案 */
  basis: string
}

export interface UseAlarmLevelResult {
  /** initialValue 可选：换管后的观测按当日基准初值判定 */
  evaluate: (point: Point, reading: number, initialValue?: number) => AlarmEvaluation
  /** 越限时返回预警草稿与依据，未越限返回 null */
  buildDraft: (point: Point, date: string, reading: number, initialValue?: number) => AlarmDraftResult | null
  colorOf: (level: AlarmLevel) => string
  bgOf: (level: AlarmLevel) => string
  levelOptions: AlarmLevel[]
}

export function useAlarmLevel(): UseAlarmLevelResult {
  const evaluate = useCallback((point: Point, reading: number, initialValue?: number): AlarmEvaluation => {
    const base = Number.isFinite(initialValue) ? (initialValue as number) : point.initialValue
    const cumulative = cumulativeOf(reading, base)
    const ratio = ratioOf(cumulative, point.threshold)
    const level = alarmLevelOf(cumulative, point.threshold)
    return {
      cumulative,
      ratio,
      level,
      exceeded: level !== null,
      score: severityScore(level, point.type)
    }
  }, [])

  const buildDraft = useCallback(
    (point: Point, date: string, reading: number, initialValue?: number): AlarmDraftResult | null => {
      const evaluation = evaluate(point, reading, initialValue)
      if (evaluation.level === null) return null
      return {
        draft: {
          pointId: point.id,
          level: evaluation.level,
          triggerValue: evaluation.cumulative,
          triggerDate: date,
          state: '待处置',
          handler: '',
          measure: ''
        },
        basis: alarmBasis(point, evaluation.cumulative, evaluation.level)
      }
    },
    [evaluate]
  )

  return useMemo(
    () => ({
      evaluate,
      buildDraft,
      colorOf: (level: AlarmLevel) => ALARM_COLOR[level],
      bgOf: (level: AlarmLevel) => ALARM_BG[level],
      levelOptions: ALARM_LEVELS
    }),
    [evaluate, buildDraft]
  )
}
