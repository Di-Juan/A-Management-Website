import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, canUse, downloadFile, formatDateTime } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import Icon from '../icons.jsx';
import { EmptyState, Modal, PageHeader, Skeleton, StatStrip, StatusBadge, Tabs } from '../components/UI.jsx';

const emptyActivity = {
  title: '',
  description: '',
  location: '',
  startAt: '',
  endAt: '',
  signupDeadline: '',
  capacity: '',
  feeYuan: '',
  status: 'open',
};
const emptyShift = { date: '', startTime: '18:00', endTime: '20:00', location: '主实验室', capacity: 2, note: '' };

export default function Activities() {
  const { user } = useAuth();
  const toast = useToast();
  const canActivity = canUse(user, 'activity');
  const canDuty = canUse(user, 'duty');

  const [tab, setTab] = useState(canActivity || !canDuty ? 'activities' : 'duty');
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [members, setMembers] = useState([]);
  const [activityForm, setActivityForm] = useState(null);
  const [signupForm, setSignupForm] = useState(null);
  const [roster, setRoster] = useState(null);
  const [shiftForm, setShiftForm] = useState(null);
  const [assignForm, setAssignForm] = useState(null);
  const [importing, setImporting] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [activityRes, dutyRes, memberRes] = await Promise.all([
        api.get('/activities'),
        api.get('/duty/shifts'),
        api.get('/users/options'),
      ]);
      setActivities(activityRes.items);
      setShifts(dutyRes.items);
      setMembers(memberRes.items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openActivities = activities.filter((item) => item.status === 'open').length;
  const mySignups = activities.filter((item) => item.mySignupStatus === 'confirmed').length;
  const myShifts = useMemo(
    () =>
      shifts.reduce(
        (sum, shift) => sum + shift.assignments.filter((assignment) => assignment.userId === user.id).length,
        0,
      ),
    [shifts, user.id],
  );
  const today = new Date().toISOString().slice(0, 10);
  const upcomingShifts = shifts.filter((shift) => shift.date >= today).length;

  const importExcel = async (kind, file) => {
    if (!file) return;
    setImporting(kind);
    try {
      const result = await api.upload(`/imports/${kind}`, [file], {}, 'file');
      setImportResult({ kind, ...result });
      toast.success(
        kind === 'activities'
          ? `已导入 ${result.created} 个活动`
          : `已导入 ${result.createdShifts} 个班次、${result.createdAssignments} 人次`,
      );
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting('');
    }
  };

  const submitActivity = async (event) => {
    event.preventDefault();
    const form = activityForm;
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        location: form.location,
        startAt: form.startAt,
        endAt: form.endAt || undefined,
        signupDeadline: form.signupDeadline || undefined,
        capacity: form.capacity || undefined,
        feeCents: Math.round(Number(form.feeYuan || 0) * 100),
        status: form.status,
      };
      if (form.id) await api.patch(`/activities/${form.id}`, payload);
      else await api.post('/activities', { ...payload, status: form.status || 'open' });
      toast.success(form.id ? '活动已更新' : '活动已发布');
      setActivityForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const signup = async (activity) => {
    setSignupForm({ activity, note: '' });
  };

  const submitSignup = async (event) => {
    event.preventDefault();
    if (!signupForm) return;
    setSaving(true);
    try {
      await api.post(`/activities/${signupForm.activity.id}/signup`, { note: signupForm.note });
      toast.success('报名成功');
      setSignupForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cancelSignup = async (activity) => {
    if (!window.confirm(`确定取消报名「${activity.title}」吗？`)) return;
    try {
      await api.post(`/activities/${activity.id}/signup/cancel`, {});
      toast.success('已取消报名');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openRoster = async (activity) => {
    try {
      const res = await api.get(`/activities/${activity.id}/signups`);
      setRoster({ activity, items: res.items });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const checkIn = async (item) => {
    try {
      await api.post(`/activities/${roster.activity.id}/signups/${item.id}/checkin`, {});
      toast.success('已签到');
      await openRoster(roster.activity);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateActivityStatus = async (activity, status) => {
    try {
      await api.patch(`/activities/${activity.id}`, { status });
      toast.success('活动状态已更新');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submitShift = async (event) => {
    event.preventDefault();
    if (!shiftForm) return;
    setSaving(true);
    try {
      if (shiftForm.id) await api.patch(`/duty/shifts/${shiftForm.id}`, shiftForm);
      else await api.post('/duty/shifts', shiftForm);
      toast.success(shiftForm.id ? '班次已更新' : '班次已创建');
      setShiftForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAssign = async (event) => {
    event.preventDefault();
    if (!assignForm) return;
    setSaving(true);
    try {
      await api.post(`/duty/shifts/${assignForm.shiftId}/assign`, {
        userId: Number(assignForm.userId),
        note: assignForm.note,
      });
      toast.success('排班成功');
      setAssignForm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const removeShift = async (shift) => {
    if (!window.confirm('删除班次会同时移除该班次的排班，确定继续吗？')) return;
    try {
      await api.del(`/duty/shifts/${shift.id}`);
      toast.success('班次已删除');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const checkInDuty = async (assignment) => {
    try {
      await api.post(`/duty/assignments/${assignment.id}/checkin`, {});
      toast.success('值班签到成功');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const unassign = async (shift, assignment) => {
    if (!window.confirm(`确定移除「${assignment.userName}」的值班安排吗？`)) return;
    try {
      await api.del(`/duty/shifts/${shift.id}/assignments/${assignment.id}`);
      toast.success('已移除排班');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tabs = [];
  if (canActivity) tabs.push({ value: 'activities', label: '活动报名', count: openActivities });
  if (canDuty) tabs.push({ value: 'duty', label: '值班安排', count: upcomingShifts });

  return (
    <div className="page">
      <PageHeader
        title="活动与值班"
        description="活动发布、在线报名与签到，以及日常值班排班与到岗记录。"
        actions={
          tab === 'activities' && canActivity ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setActivityForm({
                  ...emptyActivity,
                  startAt: '',
                  signupDeadline: '',
                })
              }
            >
              <Icon name="plus" size={16} />
              发布活动
            </button>
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: '报名中活动', value: openActivities, tone: 'ok', hint: '个' },
          { label: '我的报名', value: mySignups, hint: '个' },
          { label: '待执行班次', value: upcomingShifts, tone: 'pending', hint: '个' },
          { label: '我的值班', value: myShifts, hint: '次' },
        ]}
      />

      {tabs.length > 1 ? <Tabs value={tab} onChange={setTab} tabs={tabs} /> : null}

      {loading ? (
        <div className="table-card">
          <Skeleton lines={6} />
        </div>
      ) : null}

      {!loading && tab === 'activities' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {activities.length} 个活动</span>
            {canActivity ? (
              <div className="row-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => downloadFile('/imports/activities/template', '活动导入模板.xlsx')}
                >
                  下载模板
                </button>
                <label className="btn btn-ghost btn-sm">
                  <Icon name="download" size={14} />
                  {importing === 'activities' ? '解析中…' : '导入 Excel'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    hidden
                    onChange={(e) => {
                      importExcel('activities', e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
          {activities.length === 0 ? (
            <EmptyState icon="calendar" title="还没有活动" description="发布活动后成员可以在线报名并签到。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>活动</th>
                  <th>时间</th>
                  <th>地点</th>
                  <th>报名</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      {item.description ? <div className="muted small wrap">{item.description}</div> : null}
                      {item.feeCents ? <div className="small">报名费 {(item.feeCents / 100).toFixed(2)} 元</div> : null}
                    </td>
                    <td className="nowrap">
                      {formatDateTime(item.startAt)}
                      {item.endAt ? <div className="muted small">至 {formatDateTime(item.endAt)}</div> : null}
                    </td>
                    <td>{item.location || '-'}</td>
                    <td>
                      {item.signupCount}
                      {item.capacity ? ` / ${item.capacity}` : ''}
                      {item.checkedInCount ? <div className="muted small">已签到 {item.checkedInCount}</div> : null}
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                      {item.mySignupStatus === 'confirmed' ? <div className="small text-ok">我已报名</div> : null}
                    </td>
                    <td className="col-actions">
                      {item.status === 'open' && item.mySignupStatus !== 'confirmed' ? (
                        <button type="button" className="link-btn" onClick={() => signup(item)}>
                          报名
                        </button>
                      ) : null}
                      {item.mySignupStatus === 'confirmed' ? (
                        <button type="button" className="link-btn danger" onClick={() => cancelSignup(item)}>
                          取消报名
                        </button>
                      ) : null}
                      {canActivity ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => openRoster(item)}>
                            名单
                          </button>
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() =>
                              setActivityForm({
                                ...item,
                                feeYuan: (item.feeCents / 100).toFixed(2),
                              })
                            }
                          >
                            编辑
                          </button>
                          {item.status === 'open' ? (
                            <button type="button" className="link-btn" onClick={() => updateActivityStatus(item, 'closed')}>
                              截止
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {!loading && tab === 'duty' ? (
        <div className="table-card">
          <div className="table-toolbar">
            <span className="muted">共 {shifts.length} 个班次</span>
            {canDuty ? (
              <div className="row-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => downloadFile('/imports/duty/template', '值班表导入模板.xlsx')}
                >
                  下载模板
                </button>
                <label className="btn btn-ghost btn-sm">
                  <Icon name="download" size={14} />
                  {importing === 'duty' ? '解析中…' : '导入 Excel'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    hidden
                    onChange={(e) => {
                      importExcel('duty', e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            ) : null}
            {canDuty ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShiftForm({ ...emptyShift, date: today })}
              >
                <Icon name="plus" size={16} />
                新建班次
              </button>
            ) : null}
          </div>
          {shifts.length === 0 ? (
            <EmptyState icon="clock" title="还没有值班班次" description="创建班次后，成员可自行报名或由管理员排班。" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>时段</th>
                  <th>地点</th>
                  <th>值班人员</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id}>
                    <td className="nowrap">{shift.date}</td>
                    <td className="nowrap">
                      {shift.startTime} - {shift.endTime}
                    </td>
                    <td>{shift.location || '-'}</td>
                    <td>
                      {shift.assignments.length === 0 ? (
                        <span className="muted">未排班</span>
                      ) : (
                        <div className="tag-list">
                          {shift.assignments.map((assignment) => (
                            <span key={assignment.id} className="tag">
                              {assignment.userName}
                              {assignment.status === 'checked_in' ? ' · 已签到' : ''}
                              {(canDuty || assignment.userId === user.id) && assignment.status !== 'checked_in' ? (
                                <button type="button" className="tag-x" onClick={() => checkInDuty(assignment)} title="签到">
                                  ✓
                                </button>
                              ) : null}
                              {canDuty ? (
                                <button
                                  type="button"
                                  className="tag-x"
                                  onClick={() => unassign(shift, assignment)}
                                  title="移除"
                                >
                                  ×
                                </button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="muted small">
                        {shift.assignments.length} / {shift.capacity} 人
                      </div>
                    </td>
                    <td className="col-actions">
                      {canDuty || shift.assignments.length < shift.capacity ? (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() =>
                            setAssignForm({ shiftId: shift.id, userId: user.id, note: '' })
                          }
                        >
                          {canDuty ? '排班' : '报名'}
                        </button>
                      ) : null}
                      {canDuty ? (
                        <>
                          <button type="button" className="link-btn" onClick={() => setShiftForm({ ...shift })}>
                            编辑
                          </button>
                          <button type="button" className="link-btn danger" onClick={() => removeShift(shift)}>
                            删除
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <Modal
        open={!!activityForm}
        title={activityForm?.id ? '编辑活动' : '发布活动'}
        onClose={() => setActivityForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setActivityForm(null)}>
              取消
            </button>
            <button type="submit" form="activity-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="activity-form" className="form" onSubmit={submitActivity}>
          <label className="field">
            <span>活动名称</span>
            <input
              required
              value={activityForm?.title || ''}
              onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>活动介绍</span>
            <textarea
              rows={3}
              value={activityForm?.description || ''}
              onChange={(e) => setActivityForm({ ...activityForm, description: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>开始时间</span>
              <input
                type="datetime-local"
                required
                value={activityForm?.startAt || ''}
                onChange={(e) => setActivityForm({ ...activityForm, startAt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>结束时间</span>
              <input
                type="datetime-local"
                value={activityForm?.endAt || ''}
                onChange={(e) => setActivityForm({ ...activityForm, endAt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>报名截止</span>
              <input
                type="datetime-local"
                value={activityForm?.signupDeadline || ''}
                onChange={(e) => setActivityForm({ ...activityForm, signupDeadline: e.target.value })}
              />
            </label>
            <label className="field">
              <span>地点</span>
              <input
                value={activityForm?.location || ''}
                onChange={(e) => setActivityForm({ ...activityForm, location: e.target.value })}
              />
            </label>
            <label className="field">
              <span>人数上限</span>
              <input
                type="number"
                min="1"
                value={activityForm?.capacity || ''}
                onChange={(e) => setActivityForm({ ...activityForm, capacity: e.target.value })}
              />
            </label>
            <label className="field">
              <span>报名费（元）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={activityForm?.feeYuan || ''}
                onChange={(e) => setActivityForm({ ...activityForm, feeYuan: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>状态</span>
            <select
              value={activityForm?.status || 'open'}
              onChange={(e) => setActivityForm({ ...activityForm, status: e.target.value })}
            >
              <option value="draft">草稿</option>
              <option value="open">开放报名</option>
              <option value="closed">已截止</option>
              <option value="finished">已结束</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
        </form>
      </Modal>

      <Modal
        open={!!signupForm}
        title={`报名 · ${signupForm?.activity?.title || ''}`}
        onClose={() => setSignupForm(null)}
        width={420}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setSignupForm(null)}>
              取消
            </button>
            <button type="submit" form="signup-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认报名'}
            </button>
          </div>
        }
      >
        <form id="signup-form" className="form" onSubmit={submitSignup}>
          <label className="field">
            <span>备注</span>
            <input
              placeholder="例如：需要借用工具一套"
              value={signupForm?.note || ''}
              onChange={(e) => setSignupForm({ ...signupForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!roster}
        title={`报名名单 · ${roster?.activity?.title || ''}`}
        onClose={() => setRoster(null)}
      >
        {roster?.items?.length ? (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>姓名</th>
                <th>部门</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {roster.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.userName}
                    {item.note ? <div className="muted small">{item.note}</div> : null}
                  </td>
                  <td>{item.department || '-'}</td>
                  <td>
                    <StatusBadge value={item.status === 'confirmed' ? 'approved' : item.status === 'cancelled' ? 'cancelled' : 'pending'} />
                  </td>
                  <td className="col-actions">
                    {item.status === 'confirmed' && !item.checkedInAt ? (
                      <button type="button" className="link-btn" onClick={() => checkIn(item)}>
                        签到
                      </button>
                    ) : null}
                    {item.checkedInAt ? <span className="small muted">已签到</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon="users" title="暂无报名" description="活动开放报名后，成员可自行报名。" />
        )}
      </Modal>

      <Modal
        open={!!shiftForm}
        title={shiftForm?.id ? '编辑班次' : '新建值班班次'}
        onClose={() => setShiftForm(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShiftForm(null)}>
              取消
            </button>
            <button type="submit" form="shift-form" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      >
        <form id="shift-form" className="form" onSubmit={submitShift}>
          <div className="form-grid">
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                required
                value={shiftForm?.date || ''}
                onChange={(e) => setShiftForm({ ...shiftForm, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>地点</span>
              <input
                value={shiftForm?.location || ''}
                onChange={(e) => setShiftForm({ ...shiftForm, location: e.target.value })}
              />
            </label>
            <label className="field">
              <span>开始时间</span>
              <input
                type="time"
                required
                value={shiftForm?.startTime || ''}
                onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
              />
            </label>
            <label className="field">
              <span>结束时间</span>
              <input
                type="time"
                required
                value={shiftForm?.endTime || ''}
                onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>需要人数</span>
            <input
              type="number"
              min="1"
              max="20"
              value={shiftForm?.capacity || 1}
              onChange={(e) => setShiftForm({ ...shiftForm, capacity: e.target.value })}
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input
              value={shiftForm?.note || ''}
              onChange={(e) => setShiftForm({ ...shiftForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!assignForm}
        title="安排值班"
        onClose={() => setAssignForm(null)}
        width={420}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setAssignForm(null)}>
              取消
            </button>
            <button type="submit" form="assign-form" className="btn btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认'}
            </button>
          </div>
        }
      >
        <form id="assign-form" className="form" onSubmit={submitAssign}>
          <label className="field">
            <span>值班人员</span>
            <select
              required
              value={assignForm?.userId || ''}
              onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}
            >
              <option value="">请选择成员</option>
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>备注</span>
            <input
              value={assignForm?.note || ''}
              onChange={(e) => setAssignForm({ ...assignForm, note: e.target.value })}
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={!!importResult}
        title="Excel 导入结果"
        subtitle={
          importResult
            ? importResult.kind === 'activities'
              ? `成功 ${importResult.created} 条 / 共 ${importResult.total} 行`
              : `班次 ${importResult.createdShifts} 个、排班 ${importResult.createdAssignments} 人次 / 共 ${importResult.total} 行`
            : ''
        }
        onClose={() => setImportResult(null)}
        footer={
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => setImportResult(null)}>
              知道了
            </button>
          </div>
        }
      >
        {importResult?.skipped?.length ? (
          <>
            <p className="hint">以下行未能导入，请修正后重新上传：</p>
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>行号</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {importResult.skipped.map((item, index) => (
                  <tr key={`${item.row}-${index}`}>
                    <td>第 {item.row} 行</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="hint">全部数据已成功导入。</p>
        )}
      </Modal>
    </div>
  );
}
