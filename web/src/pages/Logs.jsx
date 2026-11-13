import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../icons.jsx';
import { api, formatDateTime, formatRelative, money } from '../api.js';
import { useToast } from '../context.jsx';
import { EmptyState, PageHeader, Skeleton } from '../components/UI.jsx';

const ACTION_META = {
  'auth.login': { label: '登录系统', icon: 'user', tone: 'teal' },
  'auth.change_password': { label: '修改密码', icon: 'key', tone: 'teal' },
  'transaction.create': { label: '新增账单', icon: 'plus', tone: 'green' },
  'transaction.update': { label: '修改账单', icon: 'edit', tone: 'amber' },
  'transaction.delete': { label: '删除账单', icon: 'trash', tone: 'red' },
  'attachment.upload': { label: '上传凭证', icon: 'image', tone: 'blue' },
  'attachment.delete': { label: '删除凭证', icon: 'trash', tone: 'red' },
  'user.create': { label: '创建账号', icon: 'users', tone: 'green' },
  'user.batch_create': { label: '批量创建账号', icon: 'users', tone: 'green' },
  'user.update': { label: '修改账号', icon: 'users', tone: 'amber' },
  'user.profile_update': { label: '修改姓名', icon: 'user', tone: 'teal' },
  'user.reset_password': { label: '重置密码', icon: 'key', tone: 'amber' },
  'collection.create': { label: '发布收款', icon: 'wallet', tone: 'green' },
  'collection.update': { label: '修改收款', icon: 'wallet', tone: 'amber' },
  'collection.pay': { label: '提交缴纳', icon: 'receipt', tone: 'blue' },
  'collection.review': { label: '审核缴纳', icon: 'check', tone: 'green' },
  'collection.review_all': { label: '批量审核缴纳', icon: 'check', tone: 'green' },
  'category.create': { label: '新增分类', icon: 'plus', tone: 'green' },
  'category.update': { label: '修改分类', icon: 'edit', tone: 'amber' },
  'category.delete': { label: '删除分类', icon: 'trash', tone: 'red' },
  'export.excel': { label: '导出 Excel', icon: 'download', tone: 'blue' },
  'export.zip': { label: '导出凭证包', icon: 'download', tone: 'blue' },
  'settings.update': { label: '修改设置', icon: 'settings', tone: 'amber' },
  'backup.create': { label: '自动备份', icon: 'database', tone: 'teal' },
  'backup.download': { label: '下载备份', icon: 'database', tone: 'blue' },
};

const TYPE_LABEL = { income: '收入', expense: '支出' };

function describe(log) {
  const d = log.detail || {};
  switch (log.action) {
    case 'transaction.create':
    case 'transaction.delete':
      return `${TYPE_LABEL[d.type] || ''} ${d.amountCents != null ? money(d.amountCents) : ''} · ${d.reason || ''}`;
    case 'transaction.update': {
      const before = d.before || {};
      const after = d.after || {};
      const parts = [];
      if (before.amountCents !== after.amountCents) {
        parts.push(`金额 ${money(before.amountCents)} → ${money(after.amountCents)}`);
      }
      if (before.reason !== after.reason) parts.push(`原因「${before.reason}」→「${after.reason}」`);
      if (before.occurredAt !== after.occurredAt)
        parts.push(`日期 ${before.occurredAt} → ${after.occurredAt}`);
      if (before.type !== after.type)
        parts.push(`类型 ${TYPE_LABEL[before.type]} → ${TYPE_LABEL[after.type]}`);
      return parts.join('；') || '更新账单信息';
    }
    case 'attachment.upload':
      return `上传 ${d.count || 1} 个凭证文件`;
    case 'attachment.delete':
      return `删除凭证「${d.originalName || ''}」`;
    case 'user.create':
      return `创建账号 ${d.username}（${d.displayName}）`;
    case 'user.batch_create':
      return `批量创建 ${d.count} 个账号（${d.startUsername} ~ ${d.endUsername}）`;
    case 'user.update': {
      const before = d.before || {};
      const after = d.after || {};
      const roleLabel = { admin: '管理员', finance: '财务员', member: '普通成员' };
      const parts = [];
      if (before.role !== after.role) parts.push(`角色 ${roleLabel[before.role]} → ${roleLabel[after.role]}`);
      if (before.status !== after.status)
        parts.push(
          `状态 ${before.status === 'active' ? '启用' : '停用'} → ${after.status === 'active' ? '启用' : '停用'}`,
        );
      if (before.displayName !== after.displayName)
        parts.push(`姓名 ${before.displayName} → ${after.displayName}`);
      if (before.canIncome !== after.canIncome)
        parts.push(`收入权限 ${before.canIncome ? '开' : '关'} → ${after.canIncome ? '开' : '关'}`);
      if (before.canExpense !== after.canExpense)
        parts.push(`支出权限 ${before.canExpense ? '开' : '关'} → ${after.canExpense ? '开' : '关'}`);
      return parts.join('；') || '更新账号信息';
    }
    case 'user.profile_update':
      return `姓名「${d.before?.displayName}」→「${d.after?.displayName}」`;
    case 'collection.create':
      return `发布「${d.title}」，每人 ${money(d.amountCents)}`;
    case 'collection.pay':
      return `提交「${d.title}」缴纳凭证 ${d.count || 1} 张`;
    case 'collection.review':
      return d.result === 'approve'
        ? `审核通过${d.createTransaction ? '，已计入班费收入' : '，未计入收入'}`
        : `驳回缴纳：${d.reason || ''}`;
    case 'collection.review_all':
      return `全部通过 ${d.count || 0} 笔缴纳${d.createTransaction ? '，已计入班费收入' : '，未计入收入'}`;
    case 'user.reset_password':
      return `重置账号 ${d.username} 的登录密码`;
    case 'category.create':
    case 'category.delete':
      return `${TYPE_LABEL[d.type] || ''}分类「${d.name || ''}」`;
    case 'category.update':
      return d.before?.name === d.after?.name
        ? `分类「${d.after?.name}」${d.after?.archived ? '停用' : '启用'}`
        : `分类「${d.before?.name}」→「${d.after?.name}」`;
    case 'export.excel':
    case 'export.zip':
      return `${d.range || ''} · ${d.count || 0} 条${d.vouchers != null ? ` · ${d.vouchers} 张凭证` : ''}`;
    case 'settings.update':
      return `班级「${d.className}」${d.term ? ` · ${d.term}` : ''}`;
    case 'backup.create':
    case 'backup.download':
      return d.file || '';
    case 'auth.login':
      return `账号 ${d.username || log.actorName} 登录`;
    default:
      return '';
  }
}

export default function Logs() {
  const toast = useToast();
  const [filters, setFilters] = useState({ action: '', q: '', from: '', to: '' });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput ? prev : { ...prev, q: searchInput }));
      setPage(1);
    }, 320);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.action) params.set('action', filters.action);
    if (filters.q) params.set('q', filters.q);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    params.set('page', String(page));
    params.set('pageSize', '30');
    return params.toString();
  }, [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/logs?${queryString}`);
      setData(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [queryString, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  return (
    <div className="page">
      <PageHeader title="操作日志" description="记录登录、记账、修改、删除、导出、备份等全部敏感操作" />

      <div className="card filter-card">
        <div className="filter-row">
          <div className="input-with-icon search">
            <Icon name="search" size={17} />
            <input
              type="search"
              placeholder="搜索操作人、动作或详情"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select value={filters.action} onChange={(e) => update({ action: e.target.value })}>
            <option value="">全部操作</option>
            {Object.entries(ACTION_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
          <label className="date-field">
            <span>从</span>
            <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="date-field">
            <span>至</span>
            <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <Skeleton lines={8} height={16} />
        ) : data.items.length === 0 ? (
          <EmptyState icon="shield" title="暂无日志" description="筛选范围内没有匹配的操作记录" />
        ) : (
          <>
            <ul className="log-list">
              {data.items.map((log) => {
                const meta = ACTION_META[log.action] || { label: log.action, icon: 'shield', tone: 'teal' };
                return (
                  <li key={log.id} className="log-item">
                    <span className={`log-icon ${meta.tone}`}>
                      <Icon name={meta.icon} size={15} />
                    </span>
                    <div className="log-main">
                      <div className="log-line">
                        <strong>{log.actorName}</strong>
                        <span className="log-action">{meta.label}</span>
                        <time title={formatDateTime(log.createdAt)}>{formatRelative(log.createdAt)}</time>
                      </div>
                      {describe(log) ? <p className="log-desc">{describe(log)}</p> : null}
                      <details className="log-raw">
                        <summary>查看原始记录</summary>
                        <pre>{JSON.stringify(log.detail, null, 2)}</pre>
                        <p className="log-meta">
                          {formatDateTime(log.createdAt)}
                          {log.ip ? ` · IP ${log.ip}` : ''}
                          {log.entityType ? ` · ${log.entityType}#${log.entityId ?? ''}` : ''}
                        </p>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="pagination">
              <span className="muted">
                第 {data.page} / {data.totalPages} 页 · 共 {data.total} 条
              </span>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <Icon name="chevronLeft" size={15} />
                  上一页
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                  <Icon name="chevronRight" size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
