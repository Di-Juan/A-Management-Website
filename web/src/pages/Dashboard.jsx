import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../icons.jsx';
import { api, canExport, canManage, canManageCollections, canUse, formatDate, money } from '../api.js';
import { useAuth } from '../context.jsx';
import { CategoryBreakdown, MonthlyChart } from '../components/Charts.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import TransactionDetailModal from '../components/TransactionDetail.jsx';
import { EmptyState, PageHeader, Skeleton, StatStrip } from '../components/UI.jsx';

export default function Dashboard() {
  const { user, meta } = useAuth();
  const [summary, setSummary] = useState(null);
  const [collections, setCollections] = useState([]);
  const [ops, setOps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryTab, setCategoryTab] = useState('expense');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [data, collectionData, opsData] = await Promise.all([
        api.get('/summary'),
        api.get('/collections'),
        api.get('/summary/operations'),
      ]);
      setSummary(data);
      setCollections(collectionData.items || []);
      setOps(opsData);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const balance = summary?.balance?.balanceCents ?? 0;
  const openCollections = collections.filter((item) => item.status === 'open');
  const pendingReviewCount = collections.reduce((total, item) => total + (item.stats?.pendingCount || 0), 0);
  const collectedTotal = collections.reduce((total, item) => total + (item.stats?.collectedCents || 0), 0);
  const collectionPreview = collections.slice(0, 3);

  const quickLinks = [
    { to: '/equipment', label: '设备预约', icon: 'cpu', perm: 'equipment' },
    { to: '/printing', label: '打印任务', icon: 'printer', perm: 'equipment' },
    { to: '/inventory', label: '库存借还', icon: 'box', perm: 'inventory' },
    { to: '/access', label: '门禁申请', icon: 'door', perm: 'access' },
    { to: '/activities', label: '活动报名', icon: 'calendar', perm: 'activity' },
    { to: '/documents', label: '资料归档', icon: 'folder', perm: 'doc' },
  ].filter((item) => canUse(user, item.perm));

  const todayLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const myPaymentMeta = (item) => {
    const mine = item.myPayment;
    if (!mine) return { label: '未缴纳', className: 'badge-muted' };
    if (mine.status === 'approved') return { label: '已通过', className: 'badge-income' };
    if (mine.status === 'pending') return { label: '待审核', className: 'badge-pending' };
    return { label: '已驳回', className: 'badge-expense' };
  };

  return (
    <div className="page">
      <PageHeader
        title="运营总览"
        description={[meta.orgName || meta.className, meta.term].filter(Boolean).join(' · ')}
        actions={
          <>
            {canExport(user) ? (
              <Link to="/export" className="btn btn-ghost">
                <Icon name="download" size={16} />
                导出账单
              </Link>
            ) : null}
            {canManage(user) ? (
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" size={16} />
                记一笔
              </button>
            ) : null}
          </>
        }
      />

      {error ? <div className="alert">{error}</div> : null}

      <section className="card">
        <div className="card-head">
          <div>
            <h3>运营概览</h3>
            <p className="card-desc">点击任意卡片可直达对应板块</p>
          </div>
          <Link to="/equipment" className="link">
            设备预约
            <Icon name="chevronRight" size={14} />
          </Link>
        </div>
        <StatStrip
          items={[
            {
              label: '待审核预约',
              value: loading ? '—' : ops?.pendingBookings ?? 0,
              hint: '设备与打印任务',
              to: '/equipment',
            },
            { label: '待审核门禁', value: loading ? '—' : ops?.pendingAccess ?? 0, hint: '门禁申请', to: '/access' },
            {
              label: '库存预警',
              value: loading ? '—' : ops?.lowStock ?? 0,
              hint: '耗材与元器件',
              tone: ops?.lowStock ? 'warn' : undefined,
              to: '/inventory',
            },
            {
              label: '报名中活动',
              value: loading ? '—' : ops?.openActivities ?? 0,
              hint: '可报名活动',
              to: '/activities',
            },
            {
              label: '今日值班',
              value: loading ? '—' : ops?.todayDuty?.total ?? 0,
              hint: ops?.todayDuty?.mine ? '我今天值班' : '今日班次',
              to: '/activities?tab=duty',
            },
            {
              label: '我的借出',
              value: loading ? '—' : ops?.myBorrowed ?? 0,
              hint: ops?.myOverdue ? `逾期 ${ops.myOverdue} 件` : '仪器设备',
              tone: ops?.myOverdue ? 'danger' : undefined,
              to: '/inventory',
            },
            {
              label: '经费余额',
              value: loading ? '—' : money(balance),
              hint: '点击查看账单',
              to: '/ledger',
            },
          ]}
        />
        {ops?.lowStockPreview?.length ? (
          <div className="ops-alert">
            <Icon name="info" size={15} />
            <span>
              库存预警：
              {ops.lowStockPreview.map((item) => `${item.name}（${item.quantity}${item.unit}）`).join('、')}
              {ops.lowStock > ops.lowStockPreview.length ? ' 等' : ''}
            </span>
            <Link to="/inventory" className="link">
              去补货
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>
        ) : null}
      </section>

      <section className="ops-hero">
        <div className="card ops-hero-col">
          <div className="card-head">
            <div>
              <h3>今日值班</h3>
              <p className="card-desc">{todayLabel}</p>
            </div>
            <Link to="/activities?tab=duty" className="link">
              值班安排
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          {loading ? (
            <Skeleton lines={2} />
          ) : ops?.todayDuty?.shifts?.length ? (
            <ul className="duty-list">
              {ops.todayDuty.shifts.map((shift) => (
                <li key={shift.id} className={shift.mine ? 'mine' : ''}>
                  <strong>
                    {shift.startTime} - {shift.endTime}
                  </strong>
                  <span>{shift.location || '未设置地点'}</span>
                  <div className="duty-people">
                    {shift.assignees.length ? (
                      (shift.presence || shift.assignees.map((name) => ({ name, presence: 'off' }))).map((item) => (
                        <span key={item.name} className={`presence-label presence-${item.presence || 'off'}`}>
                          <i className={`presence-dot ${item.presence || 'off'}`} />
                          {item.name}
                          <em>{item.presence === 'on' ? '在岗' : item.presence === 'away' ? '暂离' : '离岗'}</em>
                        </span>
                      ))
                    ) : (
                      <span className="muted">待排班</span>
                    )}
                    {shift.mine ? <span className="muted small">（我）</span> : null}
                    {typeof shift.onDutyCount === 'number' && shift.assignees.length ? (
                      <span className="muted small">在岗 {shift.onDutyCount} 人</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">今天没有值班安排，可在“活动与值班”中创建班次。</p>
          )}
        </div>

        <div className="card ops-hero-col">
          <div className="card-head">
            <div>
              <h3>快捷入口</h3>
              <p className="card-desc">按我的权限展示常用模块</p>
            </div>
          </div>
          {quickLinks.length === 0 ? (
            <p className="muted">暂未分配运营模块权限，请联系管理员。</p>
          ) : (
            <div className="quick-grid">
              {quickLinks.map((item) => (
                <Link key={item.to} to={item.to} className="quick-item">
                  <span className="quick-icon">
                    <Icon name={item.icon} size={18} />
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
          {canManage(user) ? (
            <button type="button" className="btn btn-ghost btn-block quick-create" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} />
              记一笔经费收支
            </button>
          ) : null}
        </div>
      </section>

      <section className="dashboard-main-grid">
        <div className="dashboard-stat-column">
          <div className="stat-card">
            <div className="stat-icon green">
              <Icon name="ledger" size={19} />
            </div>
            <div>
              <span className="stat-label">收支记录</span>
              <strong>{loading ? '—' : `${summary?.balance?.count || 0} 笔`}</strong>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon blue">
              <Icon name="image" size={19} />
            </div>
            <div>
              <span className="stat-label">凭证存档</span>
              <strong>{loading ? '—' : `${summary?.range?.voucherCount || 0} 张`}</strong>
            </div>
          </div>
        </div>

        <div className="card dashboard-collection-card">
          <div className="card-head">
            <div>
              <h3>台账缴费</h3>
              <p className="card-desc">收款进度与我的缴纳状态</p>
            </div>
            <Link to="/collections" className="link">
              查看全部
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>

          {loading ? (
            <Skeleton lines={3} />
          ) : collections.length === 0 ? (
            <p className="muted dashboard-collection-empty">
              {canManageCollections(user)
                ? '暂无收款任务，发布后成员即可上传缴纳凭证。'
                : '暂无收款任务，管理员发布后会显示在这里。'}
            </p>
          ) : (
            <>
              <div className="dashboard-collection-summary">
                <span>
                  进行中 <b>{openCollections.length}</b> 项
                </span>
                <span>
                  已收 <b>{money(collectedTotal)}</b>
                </span>
                {canManageCollections(user) ? (
                  <span>
                    待审核 <b>{pendingReviewCount}</b> 笔
                  </span>
                ) : null}
              </div>
              <ul className="dashboard-collection-list">
                {collectionPreview.map((item) => {
                  const meta = myPaymentMeta(item);
                  return (
                    <li key={item.id}>
                      <Link to="/collections" className="dashboard-collection-row">
                        <div className="dashboard-collection-main">
                          <strong>{item.title}</strong>
                          <span>
                            {money(item.amountCents)}/人 · 已缴 {item.stats.approvedCount}/
                            {item.stats.memberCount} 人 · 截止{' '}
                            {item.dueDate ? formatDate(item.dueDate) : '不限'}
                          </span>
                        </div>
                        <span className={`badge ${meta.className}`}>{meta.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>近 12 个月收支趋势</h3>
              <p className="card-desc">按月统计全部账单</p>
            </div>
          </div>
          {loading ? <Skeleton lines={5} /> : <MonthlyChart data={summary?.monthly || []} />}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>分类构成</h3>
              <p className="card-desc">按累计金额排序</p>
            </div>
            <div className="mini-tabs">
              <button
                type="button"
                className={categoryTab === 'expense' ? 'active' : ''}
                onClick={() => setCategoryTab('expense')}
              >
                支出
              </button>
              <button
                type="button"
                className={categoryTab === 'income' ? 'active' : ''}
                onClick={() => setCategoryTab('income')}
              >
                收入
              </button>
            </div>
          </div>
          {loading ? (
            <Skeleton lines={4} />
          ) : (
            <CategoryBreakdown
              items={summary?.byCategory || []}
              type={categoryTab}
              emptyHint={categoryTab === 'expense' ? '还没有支出记录' : '还没有收入记录'}
            />
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>最新账单</h3>
            <p className="card-desc">点击查看详情与凭证</p>
          </div>
          <Link to="/ledger" className="link">
            查看全部
            <Icon name="chevronRight" size={14} />
          </Link>
        </div>

        {loading ? (
          <Skeleton lines={5} />
        ) : summary?.recent?.length ? (
          <ul className="recent-list">
            {summary.recent.map((item) => (
              <li key={item.id}>
                <button type="button" className="recent-row" onClick={() => setDetailId(item.id)}>
                  <div className={`recent-mark ${item.type}`}>
                    <Icon name={item.type === 'income' ? 'arrowDownRight' : 'arrowUpRight'} size={17} />
                  </div>
                  <div className="recent-main">
                    <strong>{item.reason}</strong>
                    <span>
                      {item.categoryName} · {formatDate(item.occurredAt)} · {item.operatorName}
                    </span>
                  </div>
                  {item.attachmentCount > 0 ? (
                    <span className="voucher-hint">
                      <Icon name="image" size={13} />
                      {item.attachmentCount}
                    </span>
                  ) : null}
                  <div className={`recent-amount ${item.type}`}>
                    {item.type === 'income' ? '+' : '-'}
                    {money(item.amountCents)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="receipt"
            title="还没有账单"
            description={
              canManage(user) ? '记下第一笔经费收支，凭证可以一起上传' : '管理员记账后，这里会显示最新明细'
            }
            action={
              canManage(user) ? (
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                  <Icon name="plus" size={16} />
                  记一笔
                </button>
              ) : null
            }
          />
        )}
      </section>

      <TransactionModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={load} />
      <TransactionDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={load} />
    </div>
  );
}
