import 'fake-indexeddb/auto'
import { strict as assert } from 'node:assert'

// Node 环境 localStorage 兜底（浏览器为真实实现）
const lsStore = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => (lsStore.has(key) ? (lsStore.get(key) as string) : null),
  setItem: (key: string, value: string) => void lsStore.set(key, String(value)),
  removeItem: (key: string) => void lsStore.delete(key),
  clear: () => void lsStore.clear(),
  key: (index: number) => Array.from(lsStore.keys())[index] ?? null,
  get length() {
    return lsStore.size
  }
} as Storage
import {
  db,
  seedDatabase,
  putObservation,
  submitBaselineHandover,
  HandoverConflictError,
  readHandoverDrafts,
  saveHandoverDraft,
  clearHandoverDraft
} from '@/utils/db'
import { effectiveCumulative, dailyRateOf, resolveObservationBaseline } from '@/utils/threshold'
import type { PointRow } from '@/utils/db'

let failures = 0
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}:`, error)
  }
}

await test('播种后 pt-2 旧观测挂旧基准、换管后观测挂新基准', async () => {
  await seedDatabase()
  const rows = (await db.observations.where('pointId').equals('pt-2').toArray()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  assert.equal(rows.length, 4)
  assert.equal(rows[0].baselineId, null)
  assert.equal(rows[2].date, '2024-06-09')
  assert.equal(rows[2].cumulative, 27.9) // 旧管末次，旧基准初值 0
  assert.equal(rows[3].date, '2024-06-12')
  assert.equal(rows[3].baselineId, 'hd-1')
  assert.equal(rows[3].cumulative, 2.1) // 新管初值 0
  // 跨换管边界日速率：|2.1 - 27.9| / 3 天
  assert.equal(rows[3].dailyRate, dailyRateOf(2.1, 27.9, 3))
  assert.ok(Math.abs(rows[3].dailyRate - 8.6) < 1e-9)

  const point = (await db.points.get('pt-2')) as PointRow
  const handovers = await db.baselineHandovers.where('pointId').equals('pt-2').toArray()
  // 历史行即使日期 < 换管日，解析仍挂旧基准；新行挂新基准
  const oldRowResolved = resolveObservationBaseline(point.initialValue, handovers, rows[2])
  assert.equal(oldRowResolved.handover, null)
  const newRowResolved = resolveObservationBaseline(point.initialValue, handovers, rows[3])
  assert.equal(newRowResolved.handover?.id, 'hd-1')
})

await test('已闭环预警不被重算改写', async () => {
  const al4 = await db.alarms.get('al-4')
  assert.ok(al4)
  assert.equal(al4.state, '已闭环')
  assert.equal(al4.triggerValue, 27.9)
})

await test('播种已生成 黄→正常 待复核项', async () => {
  const reviews = await db.baselineReviews.toArray()
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].fromLevel, '黄')
  assert.equal(reviews[0].toLevel, null)
  assert.equal(reviews[0].status, '待复核')
})

await test('换管后新录入观测按新基准累计、速率按原始读数', async () => {
  await putObservation({
    id: 'ob-test-1',
    pointId: 'pt-2',
    date: '2024-06-15',
    reading: 3.6,
    observer: '测试',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  const row = await db.observations.get('ob-test-1')
  assert.ok(row)
  assert.equal(row.baselineId, 'hd-1')
  assert.equal(row.cumulative, 3.6)
  // |3.6 - 2.1| / 3 天 = 0.5
  assert.ok(Math.abs(row.dailyRate - 0.5) < 1e-9)
})

await test('后到的移交不能覆盖先完成的移交（同测点更早日冲突）', async () => {
  await assert.rejects(
    submitBaselineHandover({
      pointId: 'pt-2',
      effectiveDate: '2024-06-08',
      oldLastReadingDate: '2024-06-07',
      oldLastReading: 1,
      newInitialValue: 0,
      reason: '测斜管换新',
      note: '冲突测试',
      operator: '测试'
    }),
    HandoverConflictError
  )
  const handovers = await db.baselineHandovers.where('pointId').equals('pt-2').toArray()
  assert.equal(handovers.length, 1) // 未写入
})

await test('更晚日期的第二次移交成功且更新当前初值、生成级别复核', async () => {
  // 换管日 2024-06-20，先提交移交（新初值 5），再录入换管日后读数 27.4：
  // 新基准累计 22.4（/25=0.896）→ 黄；旧管末次 27.4（旧基准）→ 橙
  const result = await submitBaselineHandover({
    pointId: 'pt-1',
    effectiveDate: '2024-06-20',
    oldLastReadingDate: '2024-06-09',
    oldLastReading: 27.4,
    newInitialValue: 5,
    reason: '测斜管换新',
    note: '第二次移交测试',
    operator: '测试'
  })
  assert.equal(result.handover.seq, 1)
  const pointAfter = await db.points.get('pt-1')
  assert.ok(pointAfter)
  assert.equal(pointAfter.initialValue, 5)
  // 移交时新基准下尚无读数 → 复核为 橙 → 正常(null)
  assert.ok(result.review)
  assert.equal(result.review.fromLevel, '橙')
  assert.equal(result.review.toLevel, null)

  // 再补一条新基准读数（27.4 → 新基准 22.4 黄），单独验证级别复核口径函数
  await putObservation({
    id: 'ob-pt1-new',
    pointId: 'pt-1',
    date: '2024-06-25',
    reading: 27.4,
    observer: '测试',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  const newRow = await db.observations.get('ob-pt1-new')
  assert.ok(newRow)
  assert.equal(newRow.baselineId, result.handover.id)
  assert.equal(newRow.cumulative, 22.4)

  // 历史观测未被改写
  const oldRow = (await db.observations.where('pointId').equals('pt-1').toArray()).find((r) => r.date === '2024-06-09')
  assert.ok(oldRow)
  assert.equal(oldRow.cumulative, 27.4)
  assert.equal(oldRow.baselineId, null)
})

await test('换管后尚无新观测时复核为 旧级别 → 正常(null)', async () => {
  const before = (await db.baselineReviews.toArray()).length
  // pt-3 最新 14.9（相对初值 12.6 累计 2.3，橙）；换管后无 >= 生效日观测
  await submitBaselineHandover({
    pointId: 'pt-3',
    effectiveDate: '2024-07-01',
    oldLastReadingDate: '2024-06-10',
    oldLastReading: 14.9,
    newInitialValue: 12.6,
    reason: '基准校核调整',
    note: '',
    operator: '测试'
  })
  const after = await db.baselineReviews.toArray()
  assert.equal(after.length, before + 1)
  const last = after.sort((a, b) => b.createdAt - a.createdAt)[0]
  assert.equal(last.fromLevel, '橙')
  assert.equal(last.toLevel, null)
})

await test('移交草稿可持久化与重试清理', async () => {
  const draft = {
    pointId: 'pt-4',
    effectiveDate: '2024-08-01',
    oldLastReadingDate: '2024-07-31',
    oldLastReading: 11.2,
    newInitialValue: 0,
    reason: '测斜管换新' as const,
    note: '草稿',
    operator: '赵'
  }
  saveHandoverDraft(draft)
  const stored = readHandoverDrafts()
  assert.equal(stored['pt-4'].effectiveDate, '2024-08-01')
  clearHandoverDraft('pt-4')
  assert.equal(readHandoverDrafts()['pt-4'], undefined)
})

await test('级联删除测点时清理移交与复核', async () => {
  const { deletePointCascade } = await import('@/utils/db')
  await deletePointCascade('pt-1')
  assert.equal((await db.baselineHandovers.where('pointId').equals('pt-1').count()), 0)
  assert.equal((await db.baselineReviews.where('pointId').equals('pt-1').count()), 0)
  assert.equal(await db.points.get('pt-1'), undefined)
})

await test('effectiveCumulative 对旧行保留旧基准结果、新行按新基准', async () => {
  const point = (await db.points.get('pt-2')) as PointRow
  const handovers = await db.baselineHandovers.where('pointId').equals('pt-2').toArray()
  const oldRow = (await db.observations.where('pointId').equals('pt-2').toArray()).find((r) => r.date === '2024-06-09')
  const newRow = (await db.observations.where('pointId').equals('pt-2').toArray()).find((r) => r.date === '2024-06-12')
  assert.ok(oldRow && newRow)
  assert.equal(effectiveCumulative(point.initialValue, handovers, oldRow), 27.9)
  assert.equal(effectiveCumulative(point.initialValue, handovers, newRow), 2.1)
})

await db.close()
if (failures > 0) {
  console.error(`\n${failures} 个测试失败`)
  process.exit(1)
}
console.log('\n全部测试通过')
