import { money, plainMoney } from '../api.js';

function axisLabel(yuan) {
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(yuan % 10000 === 0 ? 0 : 1)}万`;
  if (yuan >= 1000) return `${(yuan / 1000).toFixed(yuan % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(yuan));
}

const NICE_STEPS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000,
];

export function MonthlyChart({ data = [] }) {
  const width = 760;
  const height = 250;
  const padding = { top: 14, right: 8, bottom: 28, left: 44 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const maxYuan = Math.max(1, ...data.map((d) => Math.max(d.incomeCents, d.expenseCents) / 100));
  const niceMax = NICE_STEPS.find((u) => u >= maxYuan) || Math.ceil(maxYuan / 1e6) * 1e6;
  const gridCount = 3;
  const groupWidth = innerWidth / (data.length || 1);
  const barWidth = Math.min(11, groupWidth * 0.28);

  const empty = data.every((d) => d.incomeCents === 0 && d.expenseCents === 0);

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span className="legend-item">
          <i className="legend-dot income" /> 收入
        </span>
        <span className="legend-item">
          <i className="legend-dot expense" /> 支出
        </span>
      </div>
      {empty ? (
        <div className="chart-empty">近 12 个月暂无收支数据</div>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="chart-svg"
          role="img"
          aria-label="近12个月收支趋势"
        >
          {Array.from({ length: gridCount + 1 }).map((_, index) => {
            const y = padding.top + (innerHeight / gridCount) * index;
            const value = (niceMax / gridCount) * (gridCount - index);
            return (
              <g key={index}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeDasharray={index === gridCount ? '0' : '3 5'}
                />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                  {axisLabel(value)}
                </text>
              </g>
            );
          })}

          {data.map((item, index) => {
            const groupX = padding.left + groupWidth * index + groupWidth / 2;
            const incomeHeight = Math.max(
              item.incomeCents > 0 ? 3 : 0,
              (item.incomeCents / 100 / niceMax) * innerHeight,
            );
            const expenseHeight = Math.max(
              item.expenseCents > 0 ? 3 : 0,
              (item.expenseCents / 100 / niceMax) * innerHeight,
            );
            const monthLabel = `${Number(item.month.slice(5))}月`;
            return (
              <g key={item.month}>
                <rect
                  x={groupX - barWidth - 2}
                  y={padding.top + innerHeight - incomeHeight}
                  width={barWidth}
                  height={incomeHeight}
                  rx={barWidth / 2}
                  fill="var(--brand)"
                >
                  <title>{`${item.month} 收入 ${money(item.incomeCents)}`}</title>
                </rect>
                <rect
                  x={groupX + 2}
                  y={padding.top + innerHeight - expenseHeight}
                  width={barWidth}
                  height={expenseHeight}
                  rx={barWidth / 2}
                  fill="var(--expense)"
                  opacity={0.85}
                >
                  <title>{`${item.month} 支出 ${money(item.expenseCents)}`}</title>
                </rect>
                <text
                  x={groupX}
                  y={height - 8}
                  textAnchor="middle"
                  className="chart-axis-label chart-month-label"
                >
                  {monthLabel}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function CategoryBreakdown({ items = [], type = 'expense', emptyHint = '暂无数据' }) {
  const list = items.filter((item) => item.type === type).sort((a, b) => b.amountCents - a.amountCents);
  const total = list.reduce((sum, item) => sum + item.amountCents, 0);
  const top = list.slice(0, 6);

  if (!top.length) {
    return <div className="chart-empty chart-empty-sm">{emptyHint}</div>;
  }

  return (
    <div className="category-list">
      {top.map((item) => {
        const percent = total ? Math.round((item.amountCents / total) * 100) : 0;
        return (
          <div key={`${item.type}-${item.categoryId}-${item.name}`} className="category-row">
            <div className="category-row-head">
              <span className="category-name">{item.name}</span>
              <span className="category-amount">
                {money(item.amountCents)}
                <em>{percent}%</em>
              </span>
            </div>
            <div className="progress">
              <span
                className={`progress-bar ${type}`}
                style={{ width: `${Math.max(percent, list.length === 1 ? 100 : 3)}%` }}
              />
            </div>
          </div>
        );
      })}
      {list.length > 6 ? (
        <p className="category-more">
          另有 {list.length - 6} 个分类，合计 {money(total - top.reduce((s, i) => s + i.amountCents, 0))}
        </p>
      ) : (
        <p className="category-more">
          共 {list.length} 个分类，合计 {plainMoney(total)} 元
        </p>
      )}
    </div>
  );
}
