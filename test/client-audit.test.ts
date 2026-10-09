import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

describe('Client Web UI: Telemetry Card & Audit Drawer Sessions Migration (Task-3 & Task-5)', () => {
  const clientSource = readFileSync(join(process.cwd(), 'src/client/index.ts'), 'utf8')

  it('1. Main page removes Telemetry Card completely and adds Audit button in header', () => {
    // Verify renderTelemetryCard is removed from main page view
    assert.ok(!clientSource.includes('renderTelemetryCard'), 'Main page must not contain renderTelemetryCard')
    assert.ok(!clientSource.includes('遥测总览 (Telemetry Metrics)'), 'Main page must not contain 遥测总览 (Telemetry Metrics)')

    // Verify header has 审计明细 button
    assert.ok(clientSource.includes("' 审计明细'"), 'Header card must contain 审计明细 button')
    assert.ok(clientSource.includes('setShowAuditDrawer(true)'), 'Audit button must open audit drawer')
  })

  it('2. Account cards display Google account email directly and add account form uses new placeholder', () => {
    assert.ok(clientSource.includes('const isAutoAlias = !acc.alias || /^备用.*账号/i.test(acc.alias) || /^主账号/i.test(acc.alias)'), 'Must detect auto alias')
    assert.ok(clientSource.includes('const displayName = acc.email ? (isAutoAlias ? acc.email : acc.alias) : (acc.alias || acc.id)'), 'Must prioritize Google account email')
    assert.ok(clientSource.includes('可选别名 (留空直接使用 Google 账号名称)'), 'Add account form must have updated placeholder')
    assert.ok(!clientSource.includes('`备用 Google 账号 ${(status?.pool?.accounts?.length ?? 1) + 1}`'), 'Must not auto-generate 备用 Google 账号 on add')
  })

  it('3. Audit Drawer contains top aggregate summary cards from statsOverview', () => {
    const drawerMatch = clientSource.match(/const renderAuditDrawer = \(\): unknown => \{([\s\S]*?)\n\t\t\};/)
    assert.ok(drawerMatch && drawerMatch[1], 'renderAuditDrawer must be defined')
    const drawerBody = drawerMatch[1]!

    // Verify aggregate summary cards in drawer
    assert.ok(drawerBody.includes('请求总数'), 'Audit drawer must render 请求总数 card')
    assert.ok(drawerBody.includes('缓存命中率 (Cache Hit %)'), 'Audit drawer must render 缓存命中率 card')
    assert.ok(drawerBody.includes('Token 汇总 (P / C / O)'), 'Audit drawer must render Token 汇总 card')
    assert.ok(drawerBody.includes('平均耗时 / TTFT'), 'Audit drawer must render 平均耗时 / TTFT card')
  })

  it('4. Audit Drawer supports Tab switcher between Requests and Sessions', () => {
    // State definitions
    assert.ok(clientSource.includes("const [auditTab, setAuditTab] = useState<'requests' | 'sessions'>('requests')"), 'auditTab state must be defined with default requests')
    assert.ok(clientSource.includes('const [auditSessions, setAuditSessions] = useState'), 'auditSessions state must be defined')
    assert.ok(clientSource.includes('const [auditSessionsTotal, setAuditSessionsTotal] = useState'), 'auditSessionsTotal state must be defined')
    assert.ok(clientSource.includes('const [auditSessionsPage, setAuditSessionsPage] = useState'), 'auditSessionsPage state must be defined')
    assert.ok(clientSource.includes('const [auditSessionsLoading, setAuditSessionsLoading] = useState'), 'auditSessionsLoading state must be defined')

    // Tab buttons
    assert.ok(clientSource.includes('按请求明细 (Requests)'), 'Tab switcher must have 按请求明细 (Requests)')
    assert.ok(clientSource.includes('按会话统计 (Sessions)'), 'Tab switcher must have 按会话统计 (Sessions)')
  })

  it('5. fetchAuditSessions calls stats/sessions endpoint with pagination', () => {
    assert.ok(clientSource.includes('fetchAuditSessions'), 'fetchAuditSessions must be defined')
    assert.ok(
      clientSource.includes('${API_PREFIX}/stats/sessions?limit=${limit}&offset=${offset}') ||
      clientSource.includes('/stats/sessions?limit='),
      'fetchAuditSessions must query /stats/sessions with limit and offset'
    )
  })

  it('6. Sessions table renders expected columns, empty state, and pagination', () => {
    const drawerMatch = clientSource.match(/const renderAuditDrawer = \(\): unknown => \{([\s\S]*?)\n\t\t\};/)
    assert.ok(drawerMatch && drawerMatch[1], 'renderAuditDrawer must be defined')
    const drawerBody = drawerMatch[1]!

    // Columns
    assert.ok(drawerBody.includes('更新时间'), 'Sessions table must have 更新时间 column')
    assert.ok(drawerBody.includes('会话 ID'), 'Sessions table must have 会话 ID column')
    assert.ok(drawerBody.includes('账号'), 'Sessions table must have 账号 column')
    assert.ok(drawerBody.includes('请求数 (总数 / 成功 / 失败)'), 'Sessions table must have 请求数 column')
    assert.ok(drawerBody.includes('Token (Prompt / 命中缓存 / 命中率)'), 'Sessions table must have Token column')
    assert.ok(drawerBody.includes('状态/详情'), 'Sessions table must have 状态/详情 column')

    // Empty state
    assert.ok(drawerBody.includes('暂无会话审计记录'), 'Sessions table must have empty state')

    // Pagination
    assert.ok(drawerBody.includes('上一页'), 'Drawer footer must have 上一页 button')
    assert.ok(drawerBody.includes('下一页'), 'Drawer footer must have 下一页 button')
  })

  it('7. Compiled dist/client.js contains build artifacts', () => {
    const distPath = join(process.cwd(), 'dist/client.js')
    assert.ok(existsSync(distPath), 'dist/client.js must exist')
    const distContent = readFileSync(distPath, 'utf8')
    assert.ok(distContent.includes('按会话统计 (Sessions)'), 'dist/client.js must include 按会话统计 (Sessions)')
    assert.ok(distContent.includes('stats/sessions'), 'dist/client.js must include stats/sessions')
  })
})
