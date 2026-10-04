/**
 * 测点基准（初值）沿革计算
 * 测点初始为「原始基准」；每次基准移交（如测斜管换新）生成一段新基准，
 * 自换管日期（含）起生效。历史观测保留当时所属基准的结算结果。
 */
import type { BaselineHandover } from '@/types/baseline'

export interface BaselineRef {
  /** 基准序号：0 = 原始基准，1..n = 第 n 次移交后的基准 */
  seq: number
  /** 来源移交记录 id；原始基准为 null */
  handoverId: string | null
  /** 该基准的初值 */
  initialValue: number
  /** 生效起始日期（含）；原始基准为 null */
  sinceDate: string | null
}

/** 移交记录按换管日期升序（同日期按登记先后） */
export function sortHandovers(handovers: BaselineHandover[]): BaselineHandover[] {
  return [...handovers].sort(
    (a, b) => a.handoverDate.localeCompare(b.handoverDate) || a.createdAt - b.createdAt
  )
}

/**
 * 列出测点全部基准（原始基准 + 各次移交后基准，按生效时间升序）
 * @param currentInitialValue 测点当前初值（即最新基准值；无移交时即原始基准值）
 */
export function listBaselines(currentInitialValue: number, handovers: BaselineHandover[]): BaselineRef[] {
  const sorted = sortHandovers(handovers)
  const original: BaselineRef = {
    seq: 0,
    handoverId: null,
    // 有移交时，原始基准值取自首次移交登记的旧初值，避免被后续改写
    initialValue: sorted.length > 0 ? sorted[0].oldInitialValue : currentInitialValue,
    sinceDate: null
  }
  const handed: BaselineRef[] = sorted.map((handover, index) => ({
    seq: index + 1,
    handoverId: handover.id,
    initialValue: handover.newInitialValue,
    sinceDate: handover.handoverDate
  }))
  return [original, ...handed]
}

/** 指定观测日期适用的基准：换管当天（含）起按新基准 */
export function baselineForDate(currentInitialValue: number, handovers: BaselineHandover[], date: string): BaselineRef {
  const baselines = listBaselines(currentInitialValue, handovers)
  const applicable = sortHandovers(handovers)
    .filter((handover) => handover.handoverDate <= date)
    .pop()
  if (!applicable) return baselines[0]
  return baselines.find((baseline) => baseline.handoverId === applicable.id) ?? baselines[0]
}

/** 基准显示名：原始基准 / 第 n 次移交基准 */
export function baselineLabel(ref: BaselineRef): string {
  return ref.seq === 0 ? '原始基准' : `第${ref.seq}次移交基准`
}
