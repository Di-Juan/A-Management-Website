import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons.jsx';
import { api, canExport, downloadFile, money, monthStartString, todayString } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { PageHeader, Skeleton } from '../components/UI.jsx';

const PRESETS = [
  { value: 'all', label: '全部时间' },
  { value: 'month', label: '本月' },
  { value: 'quarter', label: '近三个月' },
  { value: 'custom', label: '自定义' },
];

function shiftMonthsStart(months) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export default function Export() {
  const { user, meta } = useAuth();
  const toast = useToast();
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (preset === 'all') {
      setFrom('');
      setTo('');
    } else if (preset === 'month') {
      setFrom(monthStartString());
      setTo(todayString());
    } else if (preset === 'quarter') {
      setFrom(shiftMonthsStart(2));
      setTo(todayString());
    }
  }, [preset]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, to]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/summary?${query}`)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [query]);

  const run = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'excel') {
        await downloadFile(`/export/excel?${query}`, `科协账单_${meta.className || '运营'}.xlsx`);
        toast.success('Excel 账单已导出');
      } else {
        await downloadFile(`/export/zip?${query}`, `科协账单_${meta.className || '运营'}_凭证.zip`);
        toast.success('账单与凭证压缩包已导出');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const rangeText = from || to ? `${from || '最早'} 至 ${to || '今天'}` : '全部时间';

  return (
    <div className="page">
      <PageHeader title="导出账单" description="生成可用于公示、存档和对账的账单文件" />

      <div className="export-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h3>选择导出范围</h3>
              <p className="card-desc">导出内容会经过权限校验并记录操作日志</p>
            </div>
          </div>

          <div className="chips">
            {PRESETS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`chip ${preset === item.value ? 'active' : ''}`}
                onClick={() => setPreset(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {preset === 'custom' ? (
            <div className="form-grid" style={{ marginTop: 16 }}>
              <label className="field">
                <span>开始日期</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>结束日期</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          ) : null}

          <div className="export-summary">
            <div className="export-summary-range">
              <Icon name="calendar" size={16} />
              <span>{rangeText}</span>
            </div>
            {loading || !preview ? (
              <Skeleton lines={3} />
            ) : (
              <div className="export-stats">
                <div>
                  <span>期间收入</span>
                  <strong className="income">{money(preview.range.incomeCents)}</strong>
                </div>
                <div>
                  <span>期间支出</span>
                  <strong className="expense">{money(preview.range.expenseCents)}</strong>
                </div>
                <div>
                  <span>期间结余</span>
                  <strong>{money(preview.range.netCents)}</strong>
                </div>
                <div>
                  <span>记录 / 凭证</span>
                  <strong>
                    {preview.range.count} 笔 / {preview.range.voucherCount} 张
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="export-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => run('excel')}
              disabled={!!busy}
            >
              <Icon name="download" size={17} />
              {busy === 'excel' ? '生成中…' : '下载 Excel 明细'}
            </button>
            {canExport(user) ? (
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => run('zip')}
                disabled={!!busy}
              >
                <Icon name="image" size={17} />
                {busy === 'zip' ? '打包中…' : '下载完整凭证包'}
              </button>
            ) : null}
          </div>
        </section>

        <aside className="card export-info">
          <h3>导出内容说明</h3>
          <ul className="info-list">
            <li>
              <span className="info-icon">
                <Icon name="ledger" size={16} />
              </span>
              <div>
                <strong>Excel 明细</strong>
                <p>包含账单汇总、分类统计与逐条收支明细，附带经办人、凭证数量和录入时间。</p>
              </div>
            </li>
            <li>
              <span className="info-icon">
                <Icon name="image" size={16} />
              </span>
              <div>
                <strong>完整凭证包</strong>
                <p>ZIP 中包含 Excel 明细与全部原始凭证截图，按收支日期自动归档，便于打印留存。</p>
              </div>
            </li>
            <li>
              <span className="info-icon">
                <Icon name="shield" size={16} />
              </span>
              <div>
                <strong>可追溯</strong>
                <p>每次导出都会记录导出人、时间范围与记录条数，出现在操作日志中。</p>
              </div>
            </li>
          </ul>
          <div className="callout">
            <Icon name="alert" size={16} />
            <p>建议每月或每次大型活动后导出一份留档；凭证包较大时请使用电脑下载。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
