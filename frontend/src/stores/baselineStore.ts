/**
 * 基准移交状态（Zustand）
 * 维护基准移交记录与级别复核项，提交移交走 db.commitHandover 事务（含并发守卫）。
 */
import { create } from 'zustand'
import { liveQuery } from 'dexie'
import {
  commitHandover,
  db,
  type HandoverCommitResult,
  type HandoverRow,
  type ReviewRow
} from '@/utils/db'
import { sortHandovers } from '@/utils/baseline'
import type { BaselineHandover, BaselineReview, HandoverDraft, HandoverExpected } from '@/types/baseline'

interface BaselineState {
  handovers: BaselineHandover[]
  reviews: BaselineReview[]
  ready: boolean
  handoversOf: (pointId: string) => BaselineHandover[]
  reviewsOf: (pointId: string) => BaselineReview[]
  pendingReviews: () => BaselineReview[]
  /** 提交基准移交；并发冲突或写入失败时抛错，由调用方保留草稿重试 */
  submitHandover: (pointId: string, draft: HandoverDraft, expected: HandoverExpected) => Promise<HandoverCommitResult>
  resolveReview: (id: string) => Promise<void>
}

export const useBaselineStore = create<BaselineState>((_set, get) => ({  handovers: [],
  reviews: [],
  ready: false,

  handoversOf(pointId) {
    return sortHandovers(get().handovers.filter((item) => item.pointId === pointId))
  },

  reviewsOf(pointId) {
    return get().reviews.filter((item) => item.pointId === pointId)
  },

  pendingReviews() {
    return get().reviews.filter((item) => item.state === '待复核')
  },

  async submitHandover(pointId, draft, expected) {
    return commitHandover(pointId, draft, expected)
  },

  async resolveReview(id) {
    await db.reviews.update(id, { state: '已复核', updatedAt: Date.now() })
  }
}))

liveQuery(async () => (await db.handovers.toArray()) as HandoverRow[]).subscribe({
  next: (rows) => useBaselineStore.setState({ handovers: rows, ready: true }),
  error: () => useBaselineStore.setState({ ready: true })
})

liveQuery(async () =>
  ((await db.reviews.toArray()) as ReviewRow[]).sort((a, b) => {
    if (a.state !== b.state) return a.state === '待复核' ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
).subscribe({
  next: (rows) => useBaselineStore.setState({ reviews: rows }),
  error: () => undefined
})
