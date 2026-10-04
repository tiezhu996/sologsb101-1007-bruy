/**
 * <HandoverHistoryDrawer> 测点基准履历
 * 查看该测点新旧基准链（换管日期 / 旧管末次读数 / 新管初值 / 原因）
 * 与基准移交引起的级别复核记录。
 */
import { useState } from 'react'
import { App as AntdApp, Button, Descriptions, Drawer, Empty, Form, Input, Modal, Space, Table, Tag } from 'antd'
import type { TableColumnsType } from 'antd'
import type { Point } from '@/types/point'
import type { BaselineHandover, BaselineReview } from '@/types/baseline'
import AlarmTag from '@/components/common/AlarmTag'
import BaselineTag from './BaselineTag'
import { useBaselineStore } from '@/stores/baselineStore'

export interface HandoverHistoryDrawerProps {
  open: boolean
  point: Point | null
  onClose: () => void
  onNewHandover?: () => void
}

function LevelTransition({ review }: { review: BaselineReview }) {
  return (
    <Space size={6}>
      {review.fromLevel ? <AlarmTag level={review.fromLevel} size="small" /> : <Tag color="green">正常</Tag>}
      <span className="muted">→</span>
      {review.toLevel ? <AlarmTag level={review.toLevel} size="small" /> : <Tag color="green">正常</Tag>}
    </Space>
  )
}

export function HandoverHistoryDrawer({ open, point, onClose, onNewHandover }: HandoverHistoryDrawerProps) {
  const { message } = AntdApp.useApp()
  const baselineStore = useBaselineStore()
  const [reviewTarget, setReviewTarget] = useState<BaselineReview | null>(null)
  const [reviewForm] = Form.useForm<{ reviewer: string; reviewRemark: string }>()

  const handovers = point ? baselineStore.handoversOfPoint(point.id) : []
  const reviews = point ? baselineStore.reviewsOfPoint(point.id) : []

  const openReview = (review: BaselineReview): void => {
    setReviewTarget(review)
    reviewForm.setFieldsValue({ reviewer: review.reviewer, reviewRemark: review.reviewRemark })
  }

  const submitReview = async (): Promise<void> => {
    const values = await reviewForm.validateFields().catch(() => null)
    if (!values || !reviewTarget) return
    await baselineStore.resolveReview(reviewTarget.id, values.reviewer, values.reviewRemark)
    message.success('级别变化复核已归档')
    setReviewTarget(null)
  }

  const handoverColumns: TableColumnsType<BaselineHandover> = [
    { title: '次序', dataIndex: 'seq', width: 60, render: (value: number) => `第${value}次` },
    { title: '换管日期', dataIndex: 'effectiveDate', width: 110 },
    {
      title: '旧管末次读数',
      width: 150,
      render: (_value, record) =>
        `${record.oldLastReadingDate} · ${record.oldLastReading.toFixed(3)} ${point?.unit ?? ''}`
    },
    {
      title: '旧基准初值',
      dataIndex: 'previousInitialValue',
      width: 100,
      render: (value: number) => value.toFixed(3)
    },
    {
      title: '新管初值',
      dataIndex: 'newInitialValue',
      width: 100,
      render: (value: number) => <strong>{value.toFixed(3)}</strong>
    },
    { title: '基准', width: 110, render: (_v, record) => <BaselineTag handover={record} /> },
    { title: '原因', dataIndex: 'reason', width: 110 },
    { title: '说明 / 登记人', render: (_v, record) => `${record.note || '—'}（${record.operator}）` }
  ]

  const reviewColumns: TableColumnsType<BaselineReview> = [
    { title: '生效日期', dataIndex: 'effectiveDate', width: 110 },
    { title: '级别变化', width: 220, render: (_v, record) => <LevelTransition review={record} /> },
    {
      title: '旧基准累计',
      dataIndex: 'fromCumulative',
      width: 110,
      render: (value: number) => value.toFixed(3)
    },
    {
      title: '新基准累计',
      dataIndex: 'toCumulative',
      width: 110,
      render: (value: number | null) => (value === null ? '—' : value.toFixed(3))
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: BaselineReview['status']) => (
        <Tag color={value === '已复核' ? 'green' : 'orange'}>{value}</Tag>
      )
    },
    {
      title: '复核人 / 意见',
      render: (_v, record) =>
        record.status === '已复核' ? `${record.reviewer}：${record.reviewRemark || '—'}` : '—'
    },
    {
      title: '操作',
      width: 90,
      render: (_v, record) =>
        record.status === '待复核' ? (
          <Button type="link" size="small" onClick={() => openReview(record)}>
            复核
          </Button>
        ) : (
          '—'
        )
    }
  ]

  return (
    <>
      <Drawer
        open={open}
        width={860}
        title={point ? `基准履历 · ${point.code}` : '基准履历'}
        onClose={onClose}
        extra={
          onNewHandover ? (
            <Button type="primary" size="small" onClick={onNewHandover}>
              登记新移交
            </Button>
          ) : null
        }
      >
        {point ? (
          <>
            <Descriptions size="small" bordered column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="测点类型">{point.type}</Descriptions.Item>
              <Descriptions.Item label="安装日期">{point.installDate}</Descriptions.Item>
              <Descriptions.Item label="当前初值">
                {point.initialValue.toFixed(3)} {point.unit}
              </Descriptions.Item>
            </Descriptions>

            <h4 style={{ marginBottom: 8 }}>基准移交链（{handovers.length}）</h4>
            {handovers.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="尚未登记基准移交（原始基准即当前基准）"
                style={{ margin: '12px 0' }}
              />
            ) : (
              <Table<BaselineHandover>
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                dataSource={handovers}
                columns={handoverColumns}
                scroll={{ x: 900 }}
              />
            )}

            <h4 style={{ margin: '18px 0 8px' }}>级别变化复核（{reviews.length}）</h4>
            {reviews.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="历次移交前后预警级别无变化，无需复核"
                style={{ margin: '12px 0' }}
              />
            ) : (
              <Table<BaselineReview>
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                dataSource={reviews}
                columns={reviewColumns}
                scroll={{ x: 900 }}
              />
            )}
          </>
        ) : null}
      </Drawer>

      <Modal
        open={reviewTarget !== null}
        title="基准级别变化复核"
        onCancel={() => setReviewTarget(null)}
        onOk={submitReview}
        okText="提交复核"
        cancelText="取消"
        destroyOnClose
      >
        {reviewTarget ? (
          <>
            <Space style={{ marginBottom: 12 }}>
              <LevelTransition review={reviewTarget} />
            </Space>
            <Form form={reviewForm} layout="vertical">
              <Form.Item name="reviewer" label="复核人" rules={[{ required: true, message: '请填写复核人' }]}>
                <Input placeholder="如 刘振国" />
              </Form.Item>
              <Form.Item name="reviewRemark" label="复核意见" rules={[{ required: true, message: '请填写复核意见' }]}>
                <Input.TextArea rows={3} placeholder="如 换管后累计变化恢复正常，原黄色预警已闭环，结论维持不变" />
              </Form.Item>
            </Form>
          </>
        ) : null}
      </Modal>
    </>
  )
}

export default HandoverHistoryDrawer
