/**
 * <BaselineTag> 基准口径标签：旧基准（灰）/ 新基准（蓝）
 */
import type { CSSProperties } from 'react'
import type { BaselineHandover } from '@/types/baseline'
import { baselineLabel } from '@/utils/threshold'

export interface BaselineTagProps {
  handover?: BaselineHandover | null
  /** 直接指定“旧基准”文案时使用 */
  old?: boolean
  size?: 'small' | 'default'
}

export function BaselineTag({ handover = null, old = false, size = 'small' }: BaselineTagProps) {
  const isOld = old || handover === null
  const label = handover ? baselineLabel(handover.seq) : baselineLabel(null)
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    padding: size === 'small' ? '0 8px' : '2px 10px',
    fontSize: size === 'small' ? 12 : 13,
    lineHeight: size === 'small' ? '18px' : '20px',
    border: `1px solid ${isOld ? '#94a3b8' : '#1f5c99'}`,
    backgroundColor: isOld ? '#f1f5f9' : '#e8f1fb',
    color: isOld ? '#64748b' : '#1f5c99',
    fontWeight: 600,
    whiteSpace: 'nowrap'
  }
  return <span style={style}>{label}</span>
}

export default BaselineTag
