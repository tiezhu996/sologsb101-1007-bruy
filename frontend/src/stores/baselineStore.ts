/**
 * 基准移交状态（Zustand）
 * 维护移交履历、级别变化待复核项，以及移交草稿（写入失败可重试）。
 */
import { create } from 'zustand'
import { liveQuery } from 'dexie'
import {
  clearHandoverDraft,
  db,
  readHandoverDrafts,
  resolveBaselineReview,
  saveHandoverDraft,
  submitBaselineHandover,
  type BaselineHandoverRow,
  type BaselineReviewRow,
  type SubmitHandoverInput
} from '@/utils/db'
import {
  createEmptyHandoverDraft,
  type BaselineHandover,
  type BaselineReview,
  type HandoverDraft
} from '@/types/baseline'

interface BaselineState {
  handovers: BaselineHandover[]
  reviews: BaselineReview[]
  /** 待提交/失败待重试的移交草稿：测点 id → 草稿 */
  drafts: Record<string, HandoverDraft>
  /** 提交进行中标记（同一会话内防止重复提交） */
  submitting: boolean
  ready: boolean
  handoversOfPoint: (pointId: string) => BaselineHandover[]
  reviewsOfPoint: (pointId: string) => BaselineReview[]
  pendingReviewCount: () => number
  loadDrafts: () => void
  putDraft: (draft: HandoverDraft) => void
  removeDraft: (pointId: string) => void
  draftOf: (pointId: string) => HandoverDraft
  /** 提交移交；失败时草稿保留并抛出，调用方提示后可重试 */
  submitHandover: (draft: HandoverDraft) => Promise<void>
  resolveReview: (reviewId: string, reviewer: string, remark: string) => Promise<void>
}

export const useBaselineStore = create<BaselineState>((set, get) => ({
  handovers: [],
  reviews: [],
  drafts: {},
  submitting: false,
  ready: false,

  handoversOfPoint(pointId) {
    return get()
      .handovers.filter((item) => item.pointId === pointId)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  },

  reviewsOfPoint(pointId) {
    return get()
      .reviews.filter((item) => item.pointId === pointId)
      .sort((a, b) => b.createdAt - a.createdAt)
  },

  pendingReviewCount() {
    return get().reviews.filter((item) => item.status === '待复核').length
  },

  loadDrafts() {
    set({ drafts: readHandoverDrafts() })
  },

  putDraft(draft) {
    saveHandoverDraft(draft)
    set({ drafts: { ...get().drafts, [draft.pointId]: draft } })
  },

  removeDraft(pointId) {
    clearHandoverDraft(pointId)
    const next = { ...get().drafts }
    delete next[pointId]
    set({ drafts: next })
  },

  draftOf(pointId) {
    return get().drafts[pointId] ?? createEmptyHandoverDraft(pointId)
  },

  async submitHandover(draft) {
    if (get().submitting) return
    set({ submitting: true })
    const input: SubmitHandoverInput = {
      pointId: draft.pointId,
      effectiveDate: draft.effectiveDate,
      oldLastReadingDate: draft.oldLastReadingDate,
      oldLastReading: Number(draft.oldLastReading) || 0,
      newInitialValue: Number(draft.newInitialValue) || 0,
      reason: draft.reason,
      note: draft.note,
      operator: draft.operator
    }
    // 先持久化草稿：写入失败（含冲突）后保留，可重试或改期重试
    get().putDraft(draft)
    try {
      await submitBaselineHandover(input)
      get().removeDraft(draft.pointId)
    } finally {
      set({ submitting: false })
    }
  },

  async resolveReview(reviewId, reviewer, remark) {
    await resolveBaselineReview(reviewId, reviewer, remark)
  }
}))

liveQuery(async () =>
  (await db.baselineHandovers.toArray()).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt - b.createdAt)
).subscribe({
  next: (rows: BaselineHandoverRow[]) => useBaselineStore.setState({ handovers: rows, ready: true }),
  error: () => useBaselineStore.setState({ ready: true })
})

liveQuery(async () =>
  (await db.baselineReviews.toArray()).sort((a, b) => b.createdAt - a.createdAt)
).subscribe({
  next: (rows: BaselineReviewRow[]) => useBaselineStore.setState({ reviews: rows }),
  error: () => undefined
})
