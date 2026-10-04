/**
 * <HandoverModal> 测点基准移交登记
 * 登记换管日期、旧管末次读数、新管初值与原因；
 * 草稿先落 localStorage，写入失败（含“后到覆盖先完成”冲突）后保留，可重试。
 */
import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import type { Point } from '@/types/point'
import type { ObservationRow } from '@/utils/db'
import { HandoverConflictError } from '@/utils/db'
import { HANDOVER_REASONS, type HandoverDraft, type HandoverReason } from '@/types/baseline'
import { useBaselineStore } from '@/stores/baselineStore'

export interface HandoverModalProps {
  open: boolean
  point: Point | null
  observations: ObservationRow[]
  onClose: () => void
  onDone?: () => void
}

interface HandoverFormValues {
  effectiveDate: Dayjs
  oldLastReadingDate: Dayjs
  oldLastReading: number
  newInitialValue: number
  reason: HandoverReason
  note: string
  operator: string
}

export function HandoverModal({ open, point, observations, onClose, onDone }: HandoverModalProps) {
  const { message } = AntdApp.useApp()
  const baselineStore = useBaselineStore()
  const [form] = Form.useForm<HandoverFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const sortedOld = useMemo(
    () =>
      observations
        .filter((row) => row.pointId === point?.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [observations, point]
  )
  const latest = sortedOld[0] ?? null
  const existing = point ? baselineStore.handoversOfPoint(point.id) : []
  const latestEffective = existing.length > 0 ? existing[existing.length - 1].effectiveDate : null

  useEffect(() => {
    if (!open || !point) return
    setErrorText(null)
    const saved = baselineStore.draftOf(point.id)
    const hasDraft = Boolean(saved.effectiveDate || saved.operator || saved.note)
    if (hasDraft) {
      form.setFieldsValue({
        ...saved,
        effectiveDate: saved.effectiveDate ? dayjs(saved.effectiveDate) : dayjs(),
        oldLastReadingDate: saved.oldLastReadingDate ? dayjs(saved.oldLastReadingDate) : undefined,
        newInitialValue: saved.newInitialValue
      })
      return
    }
    form.setFieldsValue({
      effectiveDate: dayjs(),
      oldLastReadingDate: latest ? dayjs(latest.date) : undefined,
      oldLastReading: latest ? latest.reading : 0,
      newInitialValue: latestEffective
        ? existing[existing.length - 1].newInitialValue
        : point.initialValue,
      reason: '测斜管换新',
      note: '',
      operator: ''
    })
    // 仅依赖原始值：避免 submitHandover 更新 store 后该 effect 用默认值覆盖用户输入
  }, [open, point, latest?.id, latestEffective, form])

  const buildDraft = async (): Promise<HandoverDraft | null> => {
    const values = await form.validateFields().catch(() => null)
    if (!values || !point) return null
    return {
      pointId: point.id,
      effectiveDate: values.effectiveDate.format('YYYY-MM-DD'),
      oldLastReadingDate: values.oldLastReadingDate.format('YYYY-MM-DD'),
      oldLastReading: Number(values.oldLastReading) || 0,
      newInitialValue: Number(values.newInitialValue) || 0,
      reason: values.reason,
      note: values.note.trim(),
      operator: values.operator.trim()
    }
  }

  const submit = async (): Promise<void> => {
    const draft = await buildDraft()
    if (!draft) return
    setSubmitting(true)
    setErrorText(null)
    try {
      await baselineStore.submitHandover(draft)
      message.success('基准移交已登记，换管当天起按新基准展示；级别变化已生成复核项（如有）')
      onDone?.()
      onClose()
    } catch (error) {
      if (error instanceof HandoverConflictError) {
        setErrorText(error.message)
        message.error('提交冲突：后到的移交不能覆盖先完成的移交，请调整换管日期后重试')
      } else {
        setErrorText(`移交登记写入失败：${error instanceof Error ? error.message : '未知错误'}（草稿已保留，可重试）`)
        message.error('移交登记失败，草稿已保留，可直接重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const pendingDraft = point ? baselineStore.drafts[point.id] : undefined

  return (
    <Modal
      open={open}
      title={point ? `基准移交登记 · ${point.code}` : '基准移交登记'}
      onCancel={onClose}
      onOk={submit}
      okText={pendingDraft ? '重试提交' : '提交移交'}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
      width={560}
    >
      {point ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="换管当天起累计变化按新管初值展示；原观测保留当时结果并挂在旧基准，已闭环预警不被重算。"
          />
          {existing.length > 0 ? (
            <Alert
              type="warning"
              style={{ marginBottom: 12 }}
              message={`该测点已完成 ${existing.length} 次基准移交，最近一次生效日 ${latestEffective ?? '—'}；本次换管日期必须更晚。`}
            />
          ) : null}
          {errorText ? (
            <Alert
              type="error"
              style={{ marginBottom: 12 }}
              message={errorText}
              action={
                <Space direction="vertical" size={4}>
                  <Button size="small" type="primary" loading={submitting} onClick={submit}>
                    重试
                  </Button>
                </Space>
              }
            />
          ) : null}
          <Form form={form} layout="vertical">
            <Form.Item
              name="effectiveDate"
              label="换管日期（当天起按新基准）"
              rules={[{ required: true, message: '请选择换管日期' }]}
            >
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Form.Item
              name="oldLastReadingDate"
              label="旧管末次读数日期"
              dependencies={['effectiveDate']}
              rules={[
                { required: true, message: '请选择旧管末次读数日期' },
                ({ getFieldValue }) => ({
                  validator(_rule, value: Dayjs | undefined) {
                    const effective = getFieldValue('effectiveDate') as Dayjs | undefined
                    if (!value || !effective || value.isBefore(effective, 'day')) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error('旧管末次读数日期必须早于换管日期'))
                  }
                })
              ]}
            >
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Form.Item
              name="oldLastReading"
              label={`旧管末次读数（${point.unit}）`}
              rules={[{ required: true, message: '请填写旧管末次读数' }]}
            >
              <InputNumber step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="newInitialValue"
              label={`新管初值（${point.unit}）`}
              rules={[{ required: true, message: '请填写新管初值' }]}
              extra="提交后测点当前初值切换为新管初值；历史初值保留在移交履历中。"
            >
              <InputNumber step={0.01} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="reason" label="换管 / 移交原因" rules={[{ required: true, message: '请选择原因' }]}>
              <Select options={HANDOVER_REASONS.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item name="note" label="原因说明">
              <Input.TextArea rows={2} placeholder="如 原测斜管变形损坏，换新管并重新测读初值" />
            </Form.Item>
            <Form.Item name="operator" label="登记人" rules={[{ required: true, message: '请填写登记人' }]}>
              <Input placeholder="如 陈文" />
            </Form.Item>
          </Form>
        </>
      ) : null}
    </Modal>
  )
}

export default HandoverModal
