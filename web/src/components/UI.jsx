import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../icons.jsx';

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Modal({ open, title, subtitle, onClose, children, footer, width = 560 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'receipt', title, description, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3, height = 14 }) {
  return (
    <div className="skeleton">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="skeleton-line" style={{ height, width: `${100 - (index % 3) * 12}%` }} />
      ))}
    </div>
  );
}

const STATUS_MAP = {
  pending: { label: '待审核', className: 'badge-pending' },
  approved: { label: '已通过', className: 'badge-ok' },
  rejected: { label: '已驳回', className: 'badge-danger' },
  cancelled: { label: '已取消', className: 'badge-muted' },
  completed: { label: '已完成', className: 'badge-ok' },
  queued: { label: '排队中', className: 'badge-pending' },
  printing: { label: '打印中', className: 'badge-info' },
  done: { label: '已完成', className: 'badge-ok' },
  failed: { label: '已失败', className: 'badge-danger' },
  borrowed: { label: '借出中', className: 'badge-info' },
  returned: { label: '已归还', className: 'badge-ok' },
  overdue: { label: '已逾期', className: 'badge-danger' },
  active: { label: '生效中', className: 'badge-ok' },
  revoked: { label: '已撤销', className: 'badge-muted' },
  expired: { label: '已过期', className: 'badge-muted' },
  draft: { label: '草稿', className: 'badge-muted' },
  open: { label: '报名中', className: 'badge-ok' },
  closed: { label: '已截止', className: 'badge-muted' },
  finished: { label: '已结束', className: 'badge-muted' },
  assigned: { label: '待值班', className: 'badge-pending' },
  checked_in: { label: '已签到', className: 'badge-ok' },
  absent: { label: '未到岗', className: 'badge-danger' },
  available: { label: '可预约', className: 'badge-ok' },
  maintenance: { label: '维护中', className: 'badge-warn' },
  retired: { label: '已停用', className: 'badge-muted' },
};

export function StatusBadge({ value, label }) {
  const config = STATUS_MAP[value] || { label: value || '-', className: 'badge-muted' };
  return <span className={`badge ${config.className}`}>{label || config.label}</span>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`tab ${value === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function StatStrip({ items }) {
  return (
    <div className="stat-strip">
      {items.map((item) => {
        const className = `stat-mini ${item.tone ? `stat-${item.tone}` : ''}${item.to ? ' stat-link' : ''}`;
        const content = (
          <>
            <span>
              {item.label}
              {item.to ? <Icon name="chevronRight" size={12} /> : null}
            </span>
            <strong>{item.value}</strong>
            {item.hint ? <small>{item.hint}</small> : null}
          </>
        );
        return item.to ? (
          <Link key={item.label} to={item.to} className={className} title={`查看${item.label}`}>
            {content}
          </Link>
        ) : (
          <div key={item.label} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

const TYPE_BADGE = {
  income: { label: '收入', className: 'badge-income' },
  expense: { label: '支出', className: 'badge-expense' },
};

export function TypeBadge({ type }) {
  const config = TYPE_BADGE[type] || { label: type, className: '' };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

export function RoleBadge({ role }) {
  const map = {
    admin: { label: '管理员', className: 'badge-role-admin' },
    finance: { label: '财务员', className: 'badge-role-finance' },
    member: { label: '普通成员', className: 'badge-role-member' },
  };
  const config = map[role] || { label: role, className: '' };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

const defaultFileUrl = (item) => `/api/v1/attachments/${item.id}/file`;

export function Lightbox({ item, onClose, fileUrl = defaultFileUrl }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const src = fileUrl(item);
  const isPdf = item.mime === 'application/pdf';

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-bar">
          <span>{item.originalName}</span>
          <div className="lightbox-actions">
            <a className="icon-btn" href={`${src}?download=1`} download aria-label="下载凭证">
              <Icon name="download" size={18} />
            </a>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
        {isPdf ? (
          <iframe title={item.originalName} src={src} className="lightbox-pdf" />
        ) : (
          <img src={src} alt={item.originalName} className="lightbox-image" />
        )}
      </div>
    </div>
  );
}

export function AttachmentGallery({ items = [], onDelete, className = '', fileUrl = defaultFileUrl }) {
  const [preview, setPreview] = useState(null);
  if (!items.length) return null;

  return (
    <>
      <div className={`gallery ${className}`}>
        {items.map((item) => {
          const isPdf = item.mime === 'application/pdf';
          return (
            <figure key={item.id} className="gallery-item">
              <button type="button" className="gallery-thumb" onClick={() => setPreview(item)}>
                {isPdf ? (
                  <span className="gallery-pdf">
                    <Icon name="receipt" size={22} />
                    PDF
                  </span>
                ) : (
                  <img src={fileUrl(item)} alt={item.originalName} loading="lazy" />
                )}
              </button>
              <figcaption title={item.originalName}>{item.originalName}</figcaption>
              {onDelete ? (
                <button
                  type="button"
                  className="gallery-remove"
                  title="删除凭证"
                  onClick={() => onDelete(item)}
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </figure>
          );
        })}
      </div>
      <Lightbox item={preview} onClose={() => setPreview(null)} fileUrl={fileUrl} />
    </>
  );
}

export function FilePicker({ files, onChange, max = 6 }) {
  const previews = useMemo(
    () =>
      files.map((file) => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' })),
    [files],
  );

  useEffect(() => () => previews.forEach((item) => item.url && URL.revokeObjectURL(item.url)), [previews]);

  const add = (fileList) => {
    const incoming = Array.from(fileList || []);
    const merged = [...files, ...incoming].slice(0, max);
    onChange(merged);
  };

  return (
    <div className="file-picker">
      <label className="upload-drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          multiple
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
        <Icon name="camera" size={22} />
        <span>添加凭证截图</span>
        <small>支持 JPG / PNG / WEBP / PDF，单张不超过 10MB</small>
      </label>
      {previews.length > 0 ? (
        <div className="file-previews">
          {previews.map(({ file, url }, index) => (
            <div key={`${file.name}-${index}`} className="file-preview">
              {url ? <img src={url} alt={file.name} /> : <span className="file-preview-pdf">PDF</span>}
              <button
                type="button"
                className="gallery-remove"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label="移除文件"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
