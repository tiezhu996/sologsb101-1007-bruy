/**
 * 基准移交登记弹窗：登记换管日期、旧管末次读数、新管初值与原因。
 * - 打开时捕获并发令牌（测点修订时间 + 已有移交数），提交时后到的不能覆盖先完成的移交
 * - 写入失败或冲突时草稿保留在表单内，可修正后直接重试
 */
import { useEffect, useState } from 'react'
import { App as AntdApp, Alert, Form, Input, InputNumber, Modal } from 'antd'
import { useBaselineStore } from '@/stores/baselineStore'
import { db, HandoverConflictError, type HandoverCommitResult } from '@/utils/db'
import type { HandoverDraft, HandoverExpected } from '@/types/baseline'
import type { Point } from '@/types/point'

interface HandoverModalProps {
  point: Point | null
  open: boolean
  onClose: () => void
  onSubmitted?: (result: HandoverCommitResult) => void
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export default function HandoverModal({ point, open, onClose, onSubmitted }: HandoverModalProps) {
  const { message } = AntdApp.useApp()
  const baselineStore = useBaselineStore()
  const [form] = Form.useForm<HandoverDraft>()
  const [expected, setExpected] = useState<HandoverExpected | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState(false)

  const handoverCount = point ? baselineStore.handoversOf(point.id).length : 0

  // 打开时按当前数据预填：旧管末次读数取最新观测，新管初值默认与之衔接（累计从零起算）
  useEffect(() => {
    if (!open || !point) return
    setConflict(false)
    let cancelled = false
    void (async () => {
      const observations = (await db.observations.where('pointId').equals(point.id).toArray()).sort((a, b) =>
        a.date.localeCompare(b.date)
      )
      if (cancelled) return
      const latest = observations.length > 0 ? observations[observations.length - 1] : null
      const today = new Date().toISOString().slice(0, 10)
      form.setFieldsValue({
        handoverDate: today,
        oldLastReading: latest ? latest.reading : point.initialValue,
        newInitialValue: latest ? latest.reading : point.initialValue,
        reason: point.type === '测斜' ? '测斜管换新' : ''
      })
      setExpected({ pointUpdatedAt: point.updatedAt, handoverCount: baselineStore.handoversOf(point.id).length })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, point?.id])

  /** 换管日期变化时，把「旧管末次读数」联动为该日期之前的最后一次观测 */
  const onHandoverDateChange = async (date: string): Promise<void> => {
    if (!point || !DATE_PATTERN.test(date)) return
    const before = (await db.observations.where('pointId').equals(point.id).toArray())
      .filter((row) => row.date < date)
      .sort((a, b) => a.date.localeCompare(b.date))
    const last = before.length > 0 ? before[before.length - 1] : null
    if (last) {
      form.setFieldsValue({ oldLastReading: last.reading, newInitialValue: last.reading })
    }
  }

  const submit = async (): Promise<void> => {
    if (!point) return
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    // 令牌缺失（极端情况下 liveQuery 尚未回流）时以当前库内状态兜底
    const token =
      expected ?? { pointUpdatedAt: point.updatedAt, handoverCount: baselineStore.handoversOf(point.id).length }
    setSubmitting(true)
    try {
      const result = await baselineStore.submitHandover(point.id, values, token)
      message.success(
        `基准移交已登记：${result.recomputed} 条观测自 ${result.handover.handoverDate} 起按新基准重算` +
          (result.reviews.length > 0 ? `，生成 ${result.reviews.length} 条待复核项` : '')
      )
      onSubmitted?.(result)
      onClose()
    } catch (error) {
      if (error instanceof HandoverConflictError) {
        // 后到的提交不覆盖先完成的移交：刷新令牌与当前基准展示，草稿保留供核对后重试
        setConflict(true)
        const fresh = await db.points.get(point.id)
        const count = await db.handovers.where('pointId').equals(point.id).count()
        if (fresh) setExpected({ pointUpdatedAt: fresh.updatedAt, handoverCount: count })
        message.warning('检测到新的基准移交已先完成，本次未覆盖写入；已同步最新基准，请核对后再次提交')
      } else {
        message.error(`移交写入失败：${error instanceof Error ? error.message : '未知错误'}，草稿已保留，可重试`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={point ? `基准移交 · ${point.code}` : '基准移交'}
      onCancel={onClose}
      onOk={submit}
      okText="登记移交"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      {point ? (
        <div style={{ marginBottom: 12 }}>
          <span className="muted">
            当前基准初值 {point.initialValue} {point.unit} · 已移交 {handoverCount} 次；换管当天（含）起的观测将按新基准重算累计变化，之前的观测保留当时结果。
          </span>
        </div>
      ) : null}
      {conflict ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="他人已先完成一次移交，表单已对齐最新基准；请核对新管初值后再次提交。"
        />
      ) : null}
      <Form form={form} layout="vertical">
        <Form.Item
          name="handoverDate"
          label="换管日期"
          rules={[
            { required: true, message: '请填写换管日期' },
            { pattern: DATE_PATTERN, message: '日期格式应为 YYYY-MM-DD' }
          ]}
        >
          <Input
            placeholder="YYYY-MM-DD"
            onChange={(event) => {
              void onHandoverDateChange(event.target.value)
            }}
          />
        </Form.Item>
        <Form.Item name="oldLastReading" label="旧管末次读数" rules={[{ required: true, message: '请填写旧管末次读数' }]}>
          <InputNumber step={0.1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="newInitialValue" label="新管初值（新基准）" rules={[{ required: true, message: '请填写新管初值' }]}>
          <InputNumber step={0.1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="reason" label="换管原因" rules={[{ required: true, message: '请填写换管原因' }]}>
          <Input.TextArea rows={2} placeholder="如 测斜管淤堵损坏，重新埋设" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
