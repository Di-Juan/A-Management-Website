import { useCallback, useEffect, useState } from 'react';
import { api, canUse, downloadFile, formatDateTime, formatSize } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge } from '../components/UI.jsx';

const CATEGORIES = ['制度文件', '会议记录', '项目资料', '培训材料', '表单模板', '其他'];

export default function Documents() {
  const { user } = useAuth();
  const toast = useToast();
  const manage = canUse(user, 'doc');

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [uploadForm, setUploadForm] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('q', keyword);
      if (category) params.set('category', category);
      const res = await api.get(`/documents${params.toString() ? `?${params}` : ''}`);
      setItems(res.items);
      setCategories(res.categories);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [keyword, category, toast]);

  useEffect(() => {
    const timer = setTimeout(load, keyword ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, keyword]);

  const submitUpload = async (event) => {
    event.preventDefault();
    const form = uploadForm;
    if (!form?.files?.length) {
      toast.error('请选择要归档的文件');
      return;
    }
    setSaving(true);
    try {
      await api.upload('/documents', Array.from(form.files), {
        title: form.title || undefined,
        category: form.category,
        description: form.description,
        tags: form.tags,
        visibility: form.visibility,
      });
      toast.success(`已归档 ${form.files.length} 个文件`);
      setUploadForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!editForm) return;
    setSaving(true);
    try {
      await api.patch(`/documents/${editForm.id}`, {
        title: editForm.title,
        category: editForm.category,
        description: editForm.description,
        tags: editForm.tags,
        visibility: editForm.visibility,
      });
      toast.success('资料信息已更新');
      setEditForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`确定删除资料「${item.title}」吗？`)) return;
    try {
      await api.del(`/documents/${item.id}`);
      toast.success('资料已删除');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const download = async (item) => {
    try {
      await downloadFile(`/documents/${item.id}/download?download=1`, item.originalName);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="资料归档"
        description="制度、会议记录与项目资料的统一归档，支持全文检索、分类与下载权限。"
        actions={
          manage ? (
            <button type="button" className="btn btn-primary" onClick={() => setUploadForm({ files: [] })}>
              <Icon name="plus" size={16} />
              上传资料
            </button>
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: '资料总数', value: items.length, hint: '份' },
          { label: '分类数量', value: categories.length, hint: '类' },
          { label: '仅管理员可见', value: items.filter((item) => item.visibility === 'admin').length, tone: 'warn', hint: '份' },
        ]}
      />

      <div className="table-card">
        <div className="table-toolbar">
          <div className="filter-row">
            <input
              className="input"
              placeholder="搜索标题 / 说明 / 标签"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <div className="chips">
              <button type="button" className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>
                全部
              </button>
              {CATEGORIES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`chip ${category === name ? 'active' : ''}`}
                  onClick={() => setCategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? <Skeleton lines={6} /> : null}

        {!loading && items.length === 0 ? (
          <EmptyState icon="folder" title="还没有资料" description="上传制度文件、会议记录或项目资料，成员可随时查阅。" />
        ) : null}

        {!loading && items.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>资料</th>
                <th>分类</th>
                <th>大小</th>
                <th>上传人</th>
                <th>时间</th>
                <th>可见范围</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <div className="muted small">{item.originalName}</div>
                    {item.description ? <div className="muted small wrap">{item.description}</div> : null}
                    {item.tags ? <div className="small text-muted">#{item.tags}</div> : null}
                  </td>
                  <td>{item.category}</td>
                  <td className="nowrap">{formatSize(item.size)}</td>
                  <td>{item.uploaderName}</td>
                  <td className="nowrap">{formatDateTime(item.createdAt)}</td>
                  <td>
                    <StatusBadge
                      value={item.visibility === 'admin' ? 'maintenance' : 'approved'}
                      label={item.visibility === 'admin' ? '仅管理员' : '全员可见'}
                    />
                  </td>
                  <td className="col-actions">
                    <button type="button" className="link-btn" onClick={() => download(item)}>
                      下载
                    </button>
                    {manage ? (
                      <>
                        <button type="button" className="link-btn" onClick={() => setEditForm({ ...item })}>
                          编辑
                        </button>
                        <button type="button" className="link-btn danger" onClick={() => remove(item)}>
                          删除
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <Modal
        open={!!uploadForm}
        title="上传资料"
        subtitle="单个文件不超过 20MB，一次最多 5 个文件"
        onClose={() => setUploadForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setUploadForm(null)}>
              取消
            </button>
            <button type="submit" form="upload-form" className="btn btn-primary" disabled={saving}>
              {saving ? '上传中…' : '开始归档'}
            </button>
          </div>
        }
      >
        <form id="upload-form" className="form" onSubmit={submitUpload}>
          <label className="field">
            <span>选择文件</span>
            <input
              type="file"
              multiple
              onChange={(event) => setUploadForm({ ...uploadForm, files: event.target.files })}
            />
          </label>
          <label className="field">
            <span>资料标题（留空则用文件名）</span>
            <input
              value={uploadForm?.title || ''}
              onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>分类</span>
              <select
                value={uploadForm?.category || '其他'}
                onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
              >
                {CATEGORIES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>可见范围</span>
              <select
                value={uploadForm?.visibility || 'all'}
                onChange={(e) => setUploadForm({ ...uploadForm, visibility: e.target.value })}
              >
                <option value="all">全员可见</option>
                <option value="admin">仅资料管理员</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>标签</span>
            <input
              placeholder="用逗号分隔，例如：章程,2026"
              value={uploadForm?.tags || ''}
              onChange={(e) => setUploadForm({ ...uploadForm, tags: e.target.value })}
            />
          </label>
          <label className="field">
            <span>资料说明</span>
            <textarea
              rows={3}
              value={uploadForm?.description || ''}
              onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!editForm}
        title="编辑资料信息"
        onClose={() => setEditForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditForm(null)}>
              取消
            </button>
            <button type="submit" form="edit-doc-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="edit-doc-form" className="form" onSubmit={submitEdit}>
          <label className="field">
            <span>资料标题</span>
            <input
              required
              value={editForm?.title || ''}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>分类</span>
              <select
                value={editForm?.category || '其他'}
                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              >
                {CATEGORIES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>可见范围</span>
              <select
                value={editForm?.visibility || 'all'}
                onChange={(e) => setEditForm({ ...editForm, visibility: e.target.value })}
              >
                <option value="all">全员可见</option>
                <option value="admin">仅资料管理员</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>标签</span>
            <input
              value={editForm?.tags || ''}
              onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
            />
          </label>
          <label className="field">
            <span>资料说明</span>
            <textarea
              rows={3}
              value={editForm?.description || ''}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
