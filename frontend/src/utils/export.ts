/**
 * 导出工具：整库 JSON 存档、监测台账 CSV、基准移交履历 CSV、结构版本导出
 */
import type { Dam } from '@/types/dam'
import type { Section } from '@/types/section'
import type { Point } from '@/types/point'
import type { Observation } from '@/types/observation'
import type { Alarm } from '@/types/alarm'
import type { Pool } from '@/types/pool'
import type { BaselineHandover, BaselineReview } from '@/types/baseline'
import { checkPool, MIN_BEACH_LENGTH_M, MIN_FREEBOARD_M } from '@/types/pool'
import { baselineLabel, ratioOf, resolveObservationBaseline } from '@/utils/threshold'

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function stampSuffix(): string {
  const date = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

export function exportBackupJson(payload: unknown): string {
  const filename = `gbtaildam-backup-${stampSuffix()}.json`
  download(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
  return filename
}

export function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 观测台账 CSV（含新旧基准口径） */
export function exportObservationCsv(
  dams: Dam[],
  sections: Section[],
  points: Point[],
  observations: Observation[],
  handovers: BaselineHandover[] = []
): string {
  const header = [
    '坝体',
    '坝型',
    '等别',
    '桩号',
    '测点编号',
    '测点类型',
    '观测日期',
    '读数',
    '基准口径',
    '所用初值',
    '原始基准初值',
    '当前新管初值',
    '阈值',
    '累计变化',
    '日速率',
    '占阈值比(%)',
    '观测人'
  ]
  const lines: string[] = [header.map(csvCell).join(',')]
  observations.forEach((observation) => {
    const point = points.find((item) => item.id === observation.pointId)
    const section = point ? sections.find((item) => item.id === point.sectionId) : undefined
    const dam = section ? dams.find((item) => item.id === section.damId) : undefined
    const ownHandovers = handovers.filter((item) => item.pointId === observation.pointId)
    const resolution = point
      ? resolveObservationBaseline(point.initialValue, ownHandovers, observation)
      : null
    const chain = [...ownHandovers].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    const currentNewInitial = chain.length > 0 ? chain[chain.length - 1].newInitialValue : point?.initialValue
    lines.push(
      [
        dam ? dam.name : '—',
        dam ? dam.damType : '—',
        dam ? dam.grade : '—',
        section ? section.stakeNo : '—',
        point ? point.code : '—',
        point ? point.type : '—',
        observation.date,
        observation.reading,
        resolution ? baselineLabel(resolution.handover ? resolution.handover.seq : null) : '—',
        resolution ? resolution.initialValue : '—',
        chain.length > 0 ? chain[0].previousInitialValue : point ? point.initialValue : '—',
        currentNewInitial ?? '—',
        point ? point.threshold : '—',
        observation.cumulative,
        observation.dailyRate,
        point ? (ratioOf(observation.cumulative, point.threshold) * 100).toFixed(1) : '—',
        observation.observer
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `监测观测台账-${stampSuffix()}.csv`
  download(filename, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** 基准移交履历 CSV（新旧基准 + 级别复核结论） */
export function exportHandoverCsv(
  dams: Dam[],
  points: Point[],
  handovers: BaselineHandover[],
  reviews: BaselineReview[]
): string {
  const header = [
    '坝体',
    '测点编号',
    '测点类型',
    '次序',
    '换管日期',
    '旧管末次读数日期',
    '旧管末次读数',
    '旧基准初值',
    '新管初值',
    '原因',
    '说明',
    '登记人',
    '级别变化',
    '复核状态',
    '复核人',
    '复核意见'
  ]
  const lines: string[] = [header.map(csvCell).join(',')]
  handovers
    .slice()
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .forEach((handover) => {
      const point = points.find((item) => item.id === handover.pointId)
      const dam = dams.find((item) => item.id === handover.damId)
      const review = reviews.find((item) => item.handoverId === handover.id)
      const transition = review
        ? `${review.fromLevel ?? '正常'}→${review.toLevel ?? '正常'}`
        : '无变化'
      lines.push(
        [
          dam ? dam.name : '—',
          point ? point.code : '—',
          point ? point.type : '—',
          handover.seq,
          handover.effectiveDate,
          handover.oldLastReadingDate,
          handover.oldLastReading,
          handover.previousInitialValue,
          handover.newInitialValue,
          handover.reason,
          handover.note || '—',
          handover.operator,
          transition,
          review ? review.status : '—',
          review && review.reviewer ? review.reviewer : '—',
          review && review.reviewRemark ? review.reviewRemark : '—'
        ]
          .map(csvCell)
          .join(',')
      )
    })
  const filename = `基准移交履历-${stampSuffix()}.csv`
  download(filename, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** 预警与闭环台账 CSV（保留处置记录，历史不重算） */
export function exportAlarmCsv(dams: Dam[], points: Point[], alarms: Alarm[]): string {
  const header = ['坝体', '测点编号', '测点类型', '级别', '触发值', '触发日期', '状态', '处置人', '处置措施']
  const lines: string[] = [header.map(csvCell).join(',')]
  alarms.forEach((alarm) => {
    const point = points.find((item) => item.id === alarm.pointId)
    const dam = dams.find((item) => item.id === alarm.damId)
    lines.push(
      [
        dam ? dam.name : '—',
        point ? point.code : '—',
        point ? point.type : '—',
        alarm.level,
        alarm.triggerValue,
        alarm.triggerDate,
        alarm.state,
        alarm.handler || '—',
        alarm.measure || '—'
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `预警闭环台账-${stampSuffix()}.csv`
  download(filename, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

/** 库水位与干滩 CSV（含达标校核） */
export function exportPoolCsv(dams: Dam[], pools: Pool[]): string {
  const header = ['坝体', '日期', '库水位(m)', '干滩长度(m)', '安全超高(m)', '校核结论']
  const lines: string[] = [header.map(csvCell).join(',')]
  pools.forEach((pool) => {
    const dam = dams.find((item) => item.id === pool.damId)
    lines.push(
      [
        dam ? dam.name : '—',
        pool.date,
        pool.waterLevelM,
        pool.beachLengthM,
        pool.freeboardM,
        checkPool(pool).text
      ]
        .map(csvCell)
        .join(',')
    )
  })
  const filename = `库水位干滩记录-${stampSuffix()}.csv`
  download(filename, `﻿${lines.join('\n')}`, 'text/csv;charset=utf-8')
  return filename
}

export const POOL_LIMITS = { MIN_BEACH_LENGTH_M, MIN_FREEBOARD_M }

/** 导出结构版本（表结构与行数摘要） */
export function exportStructureVersion(summary: {
  dbName: string
  dbVersion: number
  counts: Record<string, number>
  exportedAt: string
}): string {
  const filename = `gbtaildam-structure-${stampSuffix()}.json`
  download(filename, JSON.stringify(summary, null, 2), 'application/json;charset=utf-8')
  return filename
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  return false
}
