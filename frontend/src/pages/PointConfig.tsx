/**
 * /points 测点布设与阈值配置
 * 按断面批量建点、逐点设初值与阈值；阈值改动先进草稿，再逐条或批量提交。
 * 消费 Point、Section；复用 <FilterBar>、<EmptyPanel>、<StatBadge>。
 */
import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, Badge, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import EmptyPanel from '@/components/common/EmptyPanel'
import FilterBar, { type FilterModel } from '@/components/common/FilterBar'
import StatBadge from '@/components/common/StatBadge'
import BaselineTag from '@/components/baseline/BaselineTag'
import HandoverModal from '@/components/baseline/HandoverModal'
import HandoverHistoryDrawer from '@/components/baseline/HandoverHistoryDrawer'
import { useDamStore } from '@/stores/damStore'
import { usePointStore } from '@/stores/pointStore'
import { useBaselineStore } from '@/stores/baselineStore'
import { useIdbTable } from '@/hooks/useIdbTable'
import { db, type ObservationRow } from '@/utils/db'
import {
  EMPTY_POINT_DRAFT,
  POINT_TYPES,
  POINT_UNIT,
  type Point,
  type PointDraft,
  type PointType
} from '@/types/point'
import { alarmLevelOf, effectiveCumulative, isExceeded, ratioOf } from '@/utils/threshold'

interface BulkDraft {
  sectionId: string
  type: PointType
  count: number
  prefix: string
  initialValue: number
  threshold: number
  installDate: string
}

export default function PointConfig() {
  const { message } = AntdApp.useApp()
  const damStore = useDamStore()
  const pointStore = usePointStore()
  const baselineStore = useBaselineStore()
  const observationTable = useIdbTable<ObservationRow>(db.observations)

  const [pointForm] = Form.useForm<PointDraft>()
  const [bulkForm] = Form.useForm<BulkDraft>()
  const [pointOpen, setPointOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [handoverPoint, setHandoverPoint] = useState<Point | null>(null)
  const [historyPoint, setHistoryPoint] = useState<Point | null>(null)

  // 挂载时载入写入失败待重试的移交草稿（localStorage）
  useEffect(() => {
    baselineStore.loadDrafts()
  }, [baselineStore])

  const filter = pointStore.filter
  const filterSelects = useMemo(
    () => [
      {
        key: 'damId',
        label: '坝体',
        multiple: false,
        options: damStore.dams.map((dam) => ({ label: dam.name, value: dam.id }))
      },
      { key: 'types', label: '测点类型', options: POINT_TYPES.map((item) => ({ label: item, value: item })) }
    ],
    [damStore.dams]
  )

  const model: FilterModel = { keyword: filter.keyword, damId: filter.damId, types: filter.types }

  const onModelChange = (next: FilterModel): void => {
    pointStore.patchFilter({
      keyword: String(next.keyword ?? ''),
      damId: typeof next.damId === 'string' ? next.damId : '',
      types: (Array.isArray(next.types) ? next.types : []) as PointType[]
    })
  }

  /** 各测点最新的累计变化量（换管后按当日基准展示，用于越限统计） */
  const latestCumulative = useMemo(() => {
    const map: Record<string, number> = {}
    pointStore.points.forEach((point) => {
      const own = observationTable.rows
        .filter((row) => row.pointId === point.id)
        .sort((a, b) => b.date.localeCompare(a.date))
      const latestRow = own[0]
      if (latestRow) {
        map[point.id] = effectiveCumulative(
          point.initialValue,
          baselineStore.handoversOfPoint(point.id),
          latestRow
        )
      }
    })
    return map
  }, [observationTable.rows, pointStore.points, baselineStore])

  const exceededCount = pointStore.points.filter((point) =>
    isExceeded(latestCumulative[point.id] ?? 0, point.threshold)
  ).length

  const rows = pointStore.points.filter((point) => {
    if (filter.damId && point.damId !== filter.damId) return false
    if (filter.types.length > 0 && !filter.types.includes(point.type)) return false
    const text = filter.keyword.trim().toLowerCase()
    if (text.length === 0) return true
    const section = damStore.sections.find((item) => item.id === point.sectionId)
    const dam = damStore.dams.find((item) => item.id === point.damId)
    return (
      point.code.toLowerCase().includes(text) ||
      (section ? section.stakeNo.toLowerCase().includes(text) : false) ||
      (dam ? dam.name.toLowerCase().includes(text) : false)
    )
  })

  const sectionOptions = damStore.sections.map((section) => {
    const dam = damStore.dams.find((item) => item.id === section.damId)
    return { label: `${dam ? dam.name : '未知坝体'} · 桩号 ${section.stakeNo}`, value: section.id }
  })

  const openCreate = (): void => {
    if (sectionOptions.length === 0) {
      message.warning('请先在坝体台账录入断面')
      return
    }
    setEditingId(null)
    pointForm.setFieldsValue({
      ...EMPTY_POINT_DRAFT,
      sectionId: filter.damId
        ? sectionOptions.find((item) => item.value && damStore.sections.find((s) => s.id === item.value)?.damId === filter.damId)?.value ?? sectionOptions[0].value
        : sectionOptions[0].value
    })
    setPointOpen(true)
  }

  const openEdit = (point: Point): void => {
    setEditingId(point.id)
    pointForm.setFieldsValue({
      sectionId: point.sectionId,
      code: point.code,
      type: point.type,
      initialValue: point.initialValue,
      threshold: point.threshold,
      unit: point.unit,
      installDate: point.installDate
    })
    setPointOpen(true)
  }

  const submitPoint = async (): Promise<void> => {
    const values = await pointForm.validateFields().catch(() => null)
    if (!values) return
    const payload: PointDraft = { ...values, unit: values.unit || POINT_UNIT[values.type] }
    if (editingId) {
      await pointStore.updatePoint(editingId, payload)
      message.success('测点已更新')
    } else {
      await pointStore.createPoint(payload)
      message.success('测点已布设')
    }
    setPointOpen(false)
  }

  const removePoint = async (point: Point): Promise<void> => {
    await pointStore.removePoint(point.id)
    message.success('测点及其观测记录已删除')
  }

  const openBulk = (): void => {
    if (sectionOptions.length === 0) {
      message.warning('请先在坝体台账录入断面')
      return
    }
    bulkForm.setFieldsValue({
      sectionId: sectionOptions[0].value,
      type: '表面位移',
      count: 3,
      prefix: 'DB',
      initialValue: 0,
      threshold: 25,
      installDate: new Date().toISOString().slice(0, 10)
    })
    setBulkOpen(true)
  }

  const submitBulk = async (): Promise<void> => {
    const values = await bulkForm.validateFields().catch(() => null)
    if (!values) return
    const count = Math.max(1, Math.min(12, Math.round(values.count)))
    const drafts: PointDraft[] = Array.from({ length: count }).map((_item, index) => ({
      sectionId: values.sectionId,
      code: `${values.prefix.trim() || 'PT'}-${String(index + 1).padStart(2, '0')}`,
      type: values.type,
      initialValue: values.initialValue,
      threshold: values.threshold,
      unit: POINT_UNIT[values.type],
      installDate: values.installDate
    }))
    const created = await pointStore.bulkCreatePoints(values.sectionId, drafts)
    message.success(`已批量布设 ${created} 个测点`)
    setBulkOpen(false)
  }

  const commitAll = async (): Promise<void> => {
    const count = await pointStore.commitAllThresholdDrafts()
    if (count === 0) {
      message.warning('没有待提交的阈值草稿')
      return
    }
    message.success(`已提交 ${count} 个测点的初值与阈值`)
  }

  const columns: TableColumnsType<Point> = [
    { title: '测点编号', dataIndex: 'code', width: 120, render: (value: string) => <strong>{value}</strong> },
    {
      title: '坝体 / 断面',
      width: 200,
      render: (_value, record) => {
        const dam = damStore.dams.find((item) => item.id === record.damId)
        const section = damStore.sections.find((item) => item.id === record.sectionId)
        return `${dam ? dam.name : '—'} / ${section ? section.stakeNo : '—'}`
      }
    },
    { title: '类型', dataIndex: 'type', width: 100, render: (value: PointType) => <Tag color="blue">{value}</Tag> },
    {
      title: '初值 / 阈值',
      width: 230,
      render: (_value, record) => {
        const draft = pointStore.thresholdDraft[record.id]
        const initial = draft ? draft.initialValue : record.initialValue
        const threshold = draft ? draft.threshold : record.threshold
        const handed = baselineStore.handoversOfPoint(record.id).length > 0
        return (
          <Space size={4}>
            <Tooltip title={handed ? '该测点已做基准移交，初值请通过「基准移交」演进；此处仅可调整阈值' : undefined}>
              <InputNumber
                size="small"
                style={{ width: 84 }}
                value={initial}
                step={0.1}
                disabled={handed}
                onChange={(value) =>
                  pointStore.setThresholdDraft(record.id, { initialValue: Number(value ?? 0), threshold })
                }
              />
            </Tooltip>
            <span>/</span>
            <InputNumber
              size="small"
              style={{ width: 84 }}
              value={threshold}
              min={0.1}
              step={0.5}
              onChange={(value) =>
                pointStore.setThresholdDraft(record.id, { initialValue: initial, threshold: Number(value ?? 1) })
              }
            />
            <Button
              type="link"
              size="small"
              disabled={!draft}
              onClick={async () => {
                await pointStore.commitThresholdDraft(record.id)
                message.success(
                  handed ? `${record.code} 阈值已保存（初值由基准移交管理）` : `${record.code} 初值与阈值已保存`
                )
              }}
            >
              保存
            </Button>
          </Space>
        )
      }
    },
    { title: '单位', dataIndex: 'unit', width: 80 },
    { title: '安装日期', dataIndex: 'installDate', width: 120 },
    {
      title: '基准',
      width: 110,
      render: (_value, record) => {
        const list = baselineStore.handoversOfPoint(record.id)
        const last = list[list.length - 1] ?? null
        return last ? (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
            <BaselineTag handover={last} />
            <span className="muted" style={{ fontSize: 12 }}>
              自 {last.effectiveDate}
            </span>
          </Space>
        ) : (
          <BaselineTag old />
        )
      }
    },
    {
      title: '最新累计变化',
      width: 150,
      render: (_value, record) => {
        const cumulative = latestCumulative[record.id]
        if (cumulative === undefined) return <span className="muted">暂无观测</span>
        const level = alarmLevelOf(cumulative, record.threshold)
        return (
          <span style={{ color: level ? '#b03a2e' : undefined }}>
            {cumulative.toFixed(3)} {record.unit}（{(ratioOf(cumulative, record.threshold) * 100).toFixed(0)}%）
          </span>
        )
      }
    },
    {
      title: '操作',
      width: 240,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Tooltip title={record.type === '测斜' ? '登记换管：换管日期、旧管末次读数、新管初值' : '登记基准重设移交'}>
            <Button type="link" size="small" onClick={() => setHandoverPoint(record)}>
              基准移交
              {baselineStore.drafts[record.id] ? (
                <Badge status="error" offset={[4, -2]} title="有写入失败待重试的草稿" />
              ) : null}
            </Button>
          </Tooltip>
          <Button type="link" size="small" onClick={() => setHistoryPoint(record)}>
            履历
          </Button>
          <Popconfirm title="删除该测点将同时删除其观测记录、预警单与基准履历" onConfirm={() => removePoint(record)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-head__title">测点布设与阈值配置</h2>
          <p className="page-head__desc">
            按断面批量布点并配置初值与阈值；越限判定按「累计变化量 ÷ 阈值」分蓝/黄/橙/红四级。
          </p>
        </div>
        <div className="page-head__actions">
          <Button onClick={openBulk}>批量布点</Button>
          <Button disabled={Object.keys(pointStore.thresholdDraft).length === 0} onClick={commitAll}>
            提交阈值草稿（{Object.keys(pointStore.thresholdDraft).length}）
          </Button>
          <Button type="primary" onClick={openCreate}>
            新增测点
          </Button>
        </div>
      </div>

      <div className="stat-row">
        <StatBadge label="测点总数" value={pointStore.points.length} suffix="个" tone="primary" />
        <StatBadge label="断面数" value={damStore.sections.length} suffix="个" tone="info" />
        <StatBadge label="越限测点" value={exceededCount} suffix="个" tone="warning" />
        <StatBadge
          label="越限占比"
          value={exceededCount}
          percent={pointStore.points.length === 0 ? 0 : Math.round((exceededCount / pointStore.points.length) * 100)}
          tone="danger"
        />
        <StatBadge label="基准移交" value={baselineStore.handovers.length} suffix="次" tone="info" />
        <StatBadge label="待复核级别变化" value={baselineStore.pendingReviewCount()} suffix="项" tone="warning" />
        <StatBadge label="待重试草稿" value={Object.keys(baselineStore.drafts).length} suffix="份" tone="danger" />
      </div>

      <FilterBar
        model={model}
        selects={filterSelects}
        keywordPlaceholder="搜索测点编号 / 桩号 / 坝体"
        onModelChange={onModelChange}
      />

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h3 className="panel-title" style={{ margin: 0 }}>
            测点清单（{rows.length} / {pointStore.points.length}）
          </h3>
          <span className="muted">阈值改动先进入草稿，确认后再提交</span>
        </div>
        {rows.length === 0 ? (
          <EmptyPanel
            title="没有匹配的测点"
            description="先到坝体台账录入断面，再按断面布设测点与阈值。"
            actionText="新增测点"
            secondaryText="重置筛选"
            onAction={openCreate}
            onSecondary={() => pointStore.resetFilter()}
            compact
          />
        ) : (
          <Table<Point> rowKey="id" size="small" bordered dataSource={rows} columns={columns} pagination={false} scroll={{ x: 1480 }} />
        )}
      </div>

      <Modal
        open={pointOpen}
        title={editingId ? '编辑测点' : '新增测点'}
        onCancel={() => setPointOpen(false)}
        onOk={submitPoint}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={pointForm} layout="vertical" initialValues={EMPTY_POINT_DRAFT}>
          <Form.Item name="sectionId" label="所属断面" rules={[{ required: true, message: '请选择断面' }]}>
            <Select options={sectionOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="code" label="测点编号" rules={[{ required: true, message: '请填写测点编号' }]}>
            <Input placeholder="如 DB-01" />
          </Form.Item>
          <Form.Item name="type" label="测点类型" rules={[{ required: true, message: '请选择测点类型' }]}>
            <Select
              options={POINT_TYPES.map((item) => ({ label: `${item}（${POINT_UNIT[item]}）`, value: item }))}
              onChange={(value: PointType) => pointForm.setFieldsValue({ unit: POINT_UNIT[value] })}
            />
          </Form.Item>
          <Form.Item
            name="initialValue"
            label="初值"
            extra={editingId && baselineStore.handoversOfPoint(editingId).length > 0
              ? '该测点已做基准移交，初值由移交履历管理，如需演进请使用「基准移交」'
              : undefined}
            rules={[{ required: true, message: '请填写初值' }]}
          >
            <InputNumber
              step={0.1}
              style={{ width: '100%' }}
              disabled={Boolean(editingId && baselineStore.handoversOfPoint(editingId).length > 0)}
            />
          </Form.Item>
          <Form.Item name="threshold" label="阈值（允许最大变化量）" rules={[{ required: true, message: '请填写阈值' }]}>
            <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请填写单位' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="installDate" label="安装日期" rules={[{ required: true, message: '请填写安装日期' }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={bulkOpen}
        title="按断面批量布点"
        onCancel={() => setBulkOpen(false)}
        onOk={submitBulk}
        okText="批量创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={bulkForm} layout="vertical">
          <Form.Item name="sectionId" label="所在断面" rules={[{ required: true, message: '请选择断面' }]}>
            <Select options={sectionOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="type" label="测点类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={POINT_TYPES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="prefix" label="编号前缀" rules={[{ required: true, message: '请填写编号前缀' }]}>
            <Input placeholder="如 DB" />
          </Form.Item>
          <Form.Item name="count" label="数量" rules={[{ required: true, message: '请填写数量' }]}>
            <InputNumber min={1} max={12} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="initialValue" label="统一初值" rules={[{ required: true, message: '请填写初值' }]}>
            <InputNumber step={0.1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="threshold" label="统一阈值" rules={[{ required: true, message: '请填写阈值' }]}>
            <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="installDate" label="安装日期" rules={[{ required: true, message: '请填写安装日期' }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>

      <HandoverModal
        open={handoverPoint !== null}
        point={handoverPoint}
        observations={observationTable.rows}
        onClose={() => setHandoverPoint(null)}
      />

      <HandoverHistoryDrawer
        open={historyPoint !== null}
        point={historyPoint}
        onClose={() => setHistoryPoint(null)}
        onNewHandover={() => {
          if (historyPoint) {
            setHandoverPoint(historyPoint)
            setHistoryPoint(null)
          }
        }}
      />
    </div>
  )
}
