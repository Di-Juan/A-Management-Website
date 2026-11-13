import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../icons.jsx';
import { api, canManage, formatDate, money } from '../api.js';
import { useAuth } from '../context.jsx';
import TransactionModal from '../components/TransactionModal.jsx';
import TransactionDetailModal from '../components/TransactionDetail.jsx';
import { EmptyState, PageHeader, Skeleton, TypeBadge } from '../components/UI.jsx';

const PAGE_SIZE = 20;

export default function Ledger() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({
    type: '',
    categoryId: '',
    from: '',
    to: '',
    q: '',
    hasVoucher: false,
  });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === searchInput ? prev : { ...prev, q: searchInput }));
      setPage(1);
    }, 320);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    api
      .get('/categories')
      .then((res) => setCategories(res.items))
      .catch(() => {});
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.q) params.set('q', filters.q);
    if (filters.hasVoucher) params.set('hasVoucher', '1');
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    return params.toString();
  }, [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/transactions?${queryString}`);
      setData(res);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({ type: '', categoryId: '', from: '', to: '', q: '', hasVoucher: false });
    setSearchInput('');
    setPage(1);
  };

  const visibleCategories = filters.type ? categories.filter((c) => c.type === filters.type) : categories;

  const hasFilters =
    filters.type || filters.categoryId || filters.from || filters.to || filters.q || filters.hasVoucher;

  return (
    <div className="page">
      <PageHeader
        title="账单明细"
        description={`共 ${data.total} 条记录，按收支日期倒序排列`}
        actions={
          canManage(user) ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={16} />
              记一笔
            </button>
          ) : null
        }
      />

      <div className="card filter-card">
        <div className="filter-row">
          <div className="input-with-icon search">
            <Icon name="search" size={17} />
            <input
              type="search"
              placeholder="搜索原因、对方或备注"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <select value={filters.type} onChange={(e) => update({ type: e.target.value, categoryId: '' })}>
            <option value="">全部类型</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
          <select value={filters.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
            <option value="">全部分类</option>
            {visibleCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === 'income' ? '收 · ' : '支 · '}
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-row second">
          <label className="date-field">
            <span>从</span>
            <input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="date-field">
            <span>至</span>
            <input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={filters.hasVoucher}
              onChange={(e) => update({ hasVoucher: e.target.checked })}
            />
            仅看有凭证
          </label>
          {hasFilters ? (
            <button type="button" className="link link-btn" onClick={resetFilters}>
              清除筛选
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="card table-card">
        {loading ? (
          <Skeleton lines={6} height={18} />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon="search"
            title={hasFilters ? '没有符合条件的记录' : '还没有账单'}
            description={hasFilters ? '试试调整筛选条件或关键词' : '点击右上角“记一笔”开始记录经费收支'}
            action={
              hasFilters ? (
                <button type="button" className="btn btn-ghost" onClick={resetFilters}>
                  清除筛选
                </button>
              ) : null
            }
          />
        ) : (
          <>
            <table className="table ledger-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>类型</th>
                  <th>收支原因</th>
                  <th>分类</th>
                  <th className="num">金额</th>
                  <th>经办人</th>
                  <th className="voucher-col">凭证</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} onClick={() => setDetailId(item.id)} className="clickable">
                    <td className="nowrap">{formatDate(item.occurredAt)}</td>
                    <td>
                      <TypeBadge type={item.type} />
                    </td>
                    <td>
                      <span className="cell-strong">{item.reason}</span>
                      {item.note ? <span className="cell-sub">{item.note}</span> : null}
                    </td>
                    <td className="nowrap muted">{item.categoryName}</td>
                    <td className={`num amount ${item.type}`}>
                      {item.type === 'income' ? '+' : '-'}
                      {money(item.amountCents)}
                    </td>
                    <td className="nowrap">{item.operatorName}</td>
                    <td className="voucher-col">
                      {item.attachmentCount > 0 ? (
                        <span className="voucher-pill">
                          <Icon name="image" size={13} />
                          {item.attachmentCount}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="row-arrow">
                      <Icon name="chevronRight" size={16} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="ledger-cards">
              {data.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="ledger-card" onClick={() => setDetailId(item.id)}>
                    <div className="ledger-card-top">
                      <TypeBadge type={item.type} />
                      <span className="ledger-card-date">{formatDate(item.occurredAt)}</span>
                      <span className={`amount ${item.type}`}>
                        {item.type === 'income' ? '+' : '-'}
                        {money(item.amountCents)}
                      </span>
                    </div>
                    <div className="ledger-card-reason">{item.reason}</div>
                    <div className="ledger-card-meta">
                      <span>{item.categoryName}</span>
                      <span>{item.operatorName}</span>
                      {item.attachmentCount > 0 ? (
                        <span className="voucher-pill">
                          <Icon name="image" size={12} />
                          {item.attachmentCount}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
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

      <TransactionModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={load} />
      <TransactionDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={load} />
    </div>
  );
}
