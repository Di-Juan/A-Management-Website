import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 必须在导入应用前指向临时数据目录，避免污染 server/data
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classfund-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-jwt-secret';

const { createApp } = await import('../server/src/app.js');
const app = createApp();
const api = request(app);

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function login(username, password) {
  return api.post('/api/v1/auth/login').send({ username, password });
}

function txPayload(overrides = {}) {
  return {
    type: 'income',
    amount: 100,
    reason: '测试收入',
    occurredAt: '2026-11-11',
    clientRequestId: randomUUID(),
    ...overrides,
  };
}

describe('班费管理系统 API', () => {
  let adminToken;
  let financeToken;
  let memberToken;
  let financeUserId;

  it('健康检查可用', async () => {
    const res = await api.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('管理员使用初始密码登录且被要求改密', async () => {
    const res = await login('admin', 'Admin@123456');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.mustChangePassword).toBe(true);
    adminToken = res.body.token;
  });

  it('批量创建数字递增的财务员账号', async () => {
    const res = await api.post('/api/v1/users/batch').set(bearer(adminToken)).send({
      startUsername: '9001',
      count: 3,
      role: 'finance',
      namePrefix: '财务',
      password: 'Test12345',
      canIncome: true,
      canExpense: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.usernames).toEqual(['9001', '9002', '9003']);
    expect(res.body.endUsername).toBe('9003');

    const users = await api.get('/api/v1/users').set(bearer(adminToken));
    financeUserId = users.body.items.find((item) => item.username === '9001').id;
  });

  it('批量创建与已有账号冲突时整体失败', async () => {
    const res = await api.post('/api/v1/users/batch').set(bearer(adminToken)).send({
      startUsername: '9002',
      count: 2,
      role: 'member',
      namePrefix: '成员',
      password: 'Test12345',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('已存在');
  });

  it('财务员的收入/支出权限相互独立', async () => {
    const res = await login('9001', 'Test12345');
    expect(res.status).toBe(200);
    expect(res.body.user.canIncome).toBe(true);
    expect(res.body.user.canExpense).toBe(false);
    financeToken = res.body.token;

    const income = await api
      .post('/api/v1/transactions')
      .set(bearer(financeToken))
      .send(txPayload({ type: 'income', reason: '班费收入' }));
    expect(income.status).toBe(201);

    const expense = await api
      .post('/api/v1/transactions')
      .set(bearer(financeToken))
      .send(txPayload({ type: 'expense', reason: '无权限支出' }));
    expect(expense.status).toBe(403);

    const excel = await api.get('/api/v1/export/excel').set(bearer(financeToken));
    expect(excel.status).toBe(200);
  });

  it('管理员开启支出权限后立即生效', async () => {
    const patched = await api
      .patch(`/api/v1/users/${financeUserId}`)
      .set(bearer(adminToken))
      .send({ canExpense: true });
    expect(patched.status).toBe(200);
    expect(patched.body.user.canExpense).toBe(true);

    const expense = await api
      .post('/api/v1/transactions')
      .set(bearer(financeToken))
      .send(txPayload({ type: 'expense', reason: '授权后支出' }));
    expect(expense.status).toBe(201);
  });

  it('普通成员可查看但不能导出或记账', async () => {
    const created = await api
      .post('/api/v1/users')
      .set(bearer(adminToken))
      .send({ username: '9101', displayName: '测试成员', role: 'member', password: 'Test12345' });
    expect(created.status).toBe(201);

    const res = await login('9101', 'Test12345');
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    memberToken = res.body.token;

    const summary = await api.get('/api/v1/summary').set(bearer(memberToken));
    expect(summary.status).toBe(200);

    const excel = await api.get('/api/v1/export/excel').set(bearer(memberToken));
    expect(excel.status).toBe(403);

    const zip = await api.get('/api/v1/export/zip').set(bearer(memberToken));
    expect(zip.status).toBe(403);

    const create = await api
      .post('/api/v1/transactions')
      .set(bearer(memberToken))
      .send(txPayload({ reason: '成员尝试记账' }));
    expect(create.status).toBe(403);
  });

  it('同一请求标识重复提交只入账一次', async () => {
    const payload = txPayload({ reason: '幂等测试' });
    const first = await api.post('/api/v1/transactions').set(bearer(adminToken)).send(payload);
    expect(first.status).toBe(201);
    const second = await api.post('/api/v1/transactions').set(bearer(adminToken)).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.transaction.id).toBe(first.body.transaction.id);
  });

  it('版本号过期时返回 409，避免并发覆盖', async () => {
    const created = await api
      .post('/api/v1/transactions')
      .set(bearer(adminToken))
      .send(txPayload({ reason: '并发测试' }));
    expect(created.status).toBe(201);
    const record = created.body.transaction;

    const body = {
      type: 'income',
      amount: 120,
      reason: '并发测试-已修改',
      occurredAt: record.occurredAt,
      version: record.version,
    };
    const updated = await api.patch(`/api/v1/transactions/${record.id}`).set(bearer(adminToken)).send(body);
    expect(updated.status).toBe(200);

    const stale = await api.patch(`/api/v1/transactions/${record.id}`).set(bearer(adminToken)).send(body);
    expect(stale.status).toBe(409);
  });

  it('审计日志记录批量建号和权限变更', async () => {
    const res = await api.get('/api/v1/logs?limit=100').set(bearer(adminToken));
    expect(res.status).toBe(200);
    const actions = res.body.items.map((item) => item.action);
    expect(actions).toContain('user.batch_create');
    expect(actions).toContain('user.update');
  });

  it('成员可修改自己的姓名，管理员可修改任意成员姓名', async () => {
    const self = await api
      .patch('/api/v1/auth/profile')
      .set(bearer(memberToken))
      .send({ displayName: '张小明' });
    expect(self.status).toBe(200);
    expect(self.body.user.displayName).toBe('张小明');

    const other = await api
      .patch(`/api/v1/users/${financeUserId}`)
      .set(bearer(adminToken))
      .send({ displayName: '财务小李' });
    expect(other.status).toBe(200);
    expect(other.body.user.displayName).toBe('财务小李');
  });

  it('发布收款后成员缴纳、管理员审核通过并计入收入', async () => {
    const before = await api.get('/api/v1/summary').set(bearer(adminToken));
    const balanceBefore = before.body.balance.balanceCents;

    const created = await api.post('/api/v1/collections').set(bearer(adminToken)).send({
      title: '秋游费用',
      amount: '50.00',
      dueDate: '2026-12-01',
      note: '含车费与门票',
    });
    expect(created.status).toBe(201);
    const collectionId = created.body.id;

    const list = await api.get('/api/v1/collections').set(bearer(memberToken));
    expect(list.status).toBe(200);
    const target = list.body.items.find((item) => item.id === collectionId);
    expect(target.myPayment).toBeNull();
    expect(target.stats.expectedCents).toBe(target.stats.memberCount * 5000);

    const submitted = await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(memberToken))
      .field('note', '已微信转账')
      .attach('files', Buffer.from('fake-png-content'), {
        filename: 'voucher.png',
        contentType: 'image/png',
      });
    expect(submitted.status).toBe(201);

    const duplicate = await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(memberToken))
      .attach('files', Buffer.from('another'), { filename: 'voucher2.png', contentType: 'image/png' });
    expect(duplicate.status).toBe(409);

    const payments = await api.get(`/api/v1/collections/${collectionId}/payments`).set(bearer(adminToken));
    expect(payments.status).toBe(200);
    const pending = payments.body.items.find((item) => item.status === 'pending');
    expect(pending.attachments.length).toBe(1);
    expect(pending.displayName).toBe('张小明');

    const approved = await api
      .post(`/api/v1/collections/payments/${pending.id}/review`)
      .set(bearer(adminToken))
      .send({ action: 'approve' });
    expect(approved.status).toBe(200);

    const after = await api.get('/api/v1/summary').set(bearer(adminToken));
    expect(after.body.balance.balanceCents).toBe(balanceBefore + 5000);

    const mine = await api.get('/api/v1/collections').set(bearer(memberToken));
    const updated = mine.body.items.find((item) => item.id === collectionId);
    expect(updated.myPayment.status).toBe('approved');
    expect(updated.stats.approvedCount).toBe(1);
  });

  it('缴纳被驳回后可重新提交，审核时可选择不计入收入', async () => {
    const created = await api
      .post('/api/v1/collections')
      .set(bearer(adminToken))
      .send({ title: '班级绿植', amount: '20.00', dueDate: '2026-12-15' });
    expect(created.status).toBe(201);
    const collectionId = created.body.id;

    await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(memberToken))
      .attach('files', Buffer.from('v1'), { filename: 'v1.png', contentType: 'image/png' });
    const payments = await api.get(`/api/v1/collections/${collectionId}/payments`).set(bearer(adminToken));
    const first = payments.body.items[0];

    const rejected = await api
      .post(`/api/v1/collections/payments/${first.id}/review`)
      .set(bearer(adminToken))
      .send({ action: 'reject', reason: '截图不清晰' });
    expect(rejected.status).toBe(200);

    const resubmitted = await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(memberToken))
      .attach('files', Buffer.from('v2'), { filename: 'v2.png', contentType: 'image/png' });
    expect(resubmitted.status).toBe(201);

    const before = await api.get('/api/v1/summary').set(bearer(adminToken));
    const second = await api.get(`/api/v1/collections/${collectionId}/payments`).set(bearer(adminToken));
    const pending = second.body.items.find((item) => item.status === 'pending');
    const approved = await api
      .post(`/api/v1/collections/payments/${pending.id}/review`)
      .set(bearer(adminToken))
      .send({ action: 'approve', createTransaction: false });
    expect(approved.status).toBe(200);

    const after = await api.get('/api/v1/summary').set(bearer(adminToken));
    expect(after.body.balance.balanceCents).toBe(before.body.balance.balanceCents);
  });

  it('台账可以全部通过审核，默认计入班费收入且不重复入账', async () => {
    const created = await api
      .post('/api/v1/collections')
      .set(bearer(adminToken))
      .send({ title: '运动会服装', amount: '30.00', dueDate: '2026-12-20' });
    expect(created.status).toBe(201);
    const collectionId = created.body.id;

    const first = await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(memberToken))
      .attach('files', Buffer.from('m1'), { filename: 'm1.png', contentType: 'image/png' });
    expect(first.status).toBe(201);
    const second = await api
      .post(`/api/v1/collections/${collectionId}/payments`)
      .set(bearer(financeToken))
      .attach('files', Buffer.from('f1'), { filename: 'f1.png', contentType: 'image/png' });
    expect(second.status).toBe(201);

    const before = await api.get('/api/v1/summary').set(bearer(adminToken));
    const approved = await api
      .post(`/api/v1/collections/${collectionId}/payments/approve-all`)
      .set(bearer(adminToken))
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.approved).toBe(2);

    const after = await api.get('/api/v1/summary').set(bearer(adminToken));
    expect(after.body.balance.balanceCents).toBe(before.body.balance.balanceCents + 6000);

    const payments = await api.get(`/api/v1/collections/${collectionId}/payments`).set(bearer(adminToken));
    expect(payments.body.items.every((item) => item.status === 'approved')).toBe(true);

    const repeat = await api
      .post(`/api/v1/collections/${collectionId}/payments/approve-all`)
      .set(bearer(adminToken))
      .send({});
    expect(repeat.status).toBe(200);
    expect(repeat.body.approved).toBe(0);
  });
});

describe('科协运营模块 API', () => {
  const ALL_PERMS = ['finance', 'equipment', 'inventory', 'access', 'activity', 'duty', 'doc'];
  let adminToken;
  let opsToken;
  let plainToken;
  let opsUserId;
  let plainUserId;

  it('管理员登录并分配运营模块权限', async () => {
    const admin = await login('admin', 'Admin@123456');
    expect(admin.status).toBe(200);
    adminToken = admin.body.token;

    const ops = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'ops01',
      displayName: '运营干事',
      role: 'member',
      password: 'Test12345',
      perms: ALL_PERMS,
      department: '技术部',
      studentNo: '2023999',
    });
    expect(ops.status).toBe(201);
    expect(ops.body.user.perms.sort()).toEqual([...ALL_PERMS].sort());
    opsUserId = ops.body.user.id;

    const plain = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'plain01',
      displayName: '普通成员',
      role: 'member',
      password: 'Test12345',
    });
    expect(plain.status).toBe(201);
    plainUserId = plain.body.user.id;

    opsToken = (await login('ops01', 'Test12345')).body.token;
    plainToken = (await login('plain01', 'Test12345')).body.token;
    expect(Boolean(opsToken && plainToken)).toBe(true);
  });

  it('未授权成员不能维护设备，拥有权限后可登记', async () => {
    const denied = await api
      .post('/api/v1/equipment')
      .set(bearer(plainToken))
      .send({ code: 'X-1', name: '越权设备', category: 'other' });
    expect(denied.status).toBe(403);

    const created = await api
      .post('/api/v1/equipment')
      .set(bearer(opsToken))
      .send({ code: 'P-3D-T1', name: '测试打印机', category: 'printer', location: '创客空间' });
    expect(created.status).toBe(201);
    expect(created.body.item.requiresApproval).toBe(true);
  });

  it('预约时间冲突被拒绝，免审核设备自动通过', async () => {
    const free = await api.get('/api/v1/equipment?status=available').set(bearer(opsToken));
    expect(free.status).toBe(200);
    const needApproval = free.body.items.find((item) => item.code === 'P-3D-T1');

    const auto = await api
      .post('/api/v1/equipment')
      .set(bearer(opsToken))
      .send({ code: 'I-AUTO-1', name: '免审核示波器', category: 'instrument', requiresApproval: false });
    expect(auto.status).toBe(201);

    const first = await api.post('/api/v1/equipment/bookings').set(bearer(plainToken)).send({
      equipmentId: needApproval.id,
      startAt: '2026-12-01T10:00',
      endAt: '2026-12-01T12:00',
      purpose: '打印作品外壳',
    });
    expect(first.status).toBe(201);
    expect(first.body.item.status).toBe('pending');

    const conflict = await api.post('/api/v1/equipment/bookings').set(bearer(plainToken)).send({
      equipmentId: needApproval.id,
      startAt: '2026-12-01T11:00',
      endAt: '2026-12-01T13:00',
      purpose: '重叠时段',
    });
    expect(conflict.status).toBe(409);

    const autoBook = await api.post('/api/v1/equipment/bookings').set(bearer(plainToken)).send({
      equipmentId: auto.body.item.id,
      startAt: '2026-12-01T10:00',
      endAt: '2026-12-01T12:00',
      purpose: '免审核预约',
    });
    expect(autoBook.status).toBe(201);
    expect(autoBook.body.item.status).toBe('approved');

    const reviewed = await api
      .post(`/api/v1/equipment/bookings/${first.body.item.id}/review`)
      .set(bearer(opsToken))
      .send({ result: 'approve' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe('approved');
  });

  it('打印任务完成时自动扣减耗材，库存不足拒绝结算', async () => {
    const material = await api
      .post('/api/v1/consumables')
      .set(bearer(opsToken))
      .send({ name: '测试 PLA', unit: 'g', stock: 100, warnThreshold: 30 });
    expect(material.status).toBe(201);

    const printer = (await api.get('/api/v1/equipment?status=available').set(bearer(opsToken))).body.items.find(
      (item) => item.code === 'P-3D-T1',
    );

    const job = await api.post('/api/v1/equipment/print-jobs').set(bearer(plainToken)).send({
      equipmentId: printer.id,
      title: '测试模型',
      materialId: material.body.item.id,
      weightGrams: 40,
    });
    expect(job.status).toBe(201);

    const started = await api
      .patch(`/api/v1/equipment/print-jobs/${job.body.item.id}`)
      .set(bearer(opsToken))
      .send({ status: 'printing' });
    expect(started.status).toBe(200);

    const done = await api
      .patch(`/api/v1/equipment/print-jobs/${job.body.item.id}`)
      .set(bearer(opsToken))
      .send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.item.status).toBe('done');

    const after = await api.get('/api/v1/consumables').set(bearer(opsToken));
    expect(after.body.items.find((item) => item.id === material.body.item.id).stock).toBe(60);

    const heavy = await api.post('/api/v1/equipment/print-jobs').set(bearer(plainToken)).send({
      equipmentId: printer.id,
      title: '超量任务',
      materialId: material.body.item.id,
      weightGrams: 500,
    });
    expect(heavy.status).toBe(201);
    const rejected = await api
      .patch(`/api/v1/equipment/print-jobs/${heavy.body.item.id}`)
      .set(bearer(opsToken))
      .send({ status: 'done' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toContain('库存不足');
  });

  it('打印任务支持上传并下载模型文件', async () => {
    const printers = await api.get('/api/v1/equipment?category=printer').set(bearer(opsToken));
    const printer = printers.body.items[0];

    const created = await api
      .post('/api/v1/equipment/print-jobs')
      .set(bearer(opsToken))
      .field('equipmentId', String(printer.id))
      .field('title', '带模型的打印任务')
      .attach('file', Buffer.from('solid test-model'), {
        filename: 'model.stl',
        contentType: 'application/octet-stream',
      });
    expect(created.status).toBe(201);
    expect(created.body.item.fileName).toBe('model.stl');
    expect(created.body.item.hasFile).toBe(true);

    const download = await api
      .get(`/api/v1/equipment/print-jobs/${created.body.item.id}/file`)
      .set(bearer(opsToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.body.toString()).toBe('solid test-model');
  });

  it('门禁申请通过自动生成授权，取消申请后授权撤销', async () => {
    const created = await api.post('/api/v1/access/requests').set(bearer(plainToken)).send({
      purpose: '夜间调试作品',
      location: '创客空间 A 区',
      startAt: '2026-12-02T19:00',
      endAt: '2026-12-02T22:00',
    });
    expect(created.status).toBe(201);
    const requestId = created.body.item.id;

    const denied = await api
      .post(`/api/v1/access/requests/${requestId}/review`)
      .set(bearer(plainToken))
      .send({ result: 'approve' });
    expect(denied.status).toBe(403);

    const approved = await api
      .post(`/api/v1/access/requests/${requestId}/review`)
      .set(bearer(opsToken))
      .send({ result: 'approve' });
    expect(approved.status).toBe(200);
    expect(approved.body.item.status).toBe('approved');

    let grants = await api.get('/api/v1/access/grants').set(bearer(opsToken));
    const activeGrant = grants.body.items.find((item) => item.userId === plainUserId && item.status === 'active');
    expect(activeGrant).toBeTruthy();
    expect(activeGrant.scope).toBe('创客空间 A 区');

    const cancelled = await api
      .post(`/api/v1/access/requests/${requestId}/cancel`)
      .set(bearer(plainToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.item.status).toBe('cancelled');

    grants = await api.get('/api/v1/access/grants').set(bearer(opsToken));
    expect(grants.body.items.find((item) => item.id === activeGrant.id).status).toBe('revoked');

    const again = await api
      .post(`/api/v1/access/requests/${requestId}/review`)
      .set(bearer(opsToken))
      .send({ result: 'approve' });
    expect(again.status).toBe(409);
  });

  it('元器件出入库校验库存并支持低库存筛选', async () => {
    const created = await api
      .post('/api/v1/inventory')
      .set(bearer(opsToken))
      .send({ name: '测试电阻包', quantity: 5, unit: '盒', warnThreshold: 3 });
    expect(created.status).toBe(201);
    const itemId = created.body.item.id;

    const denied = await api
      .post('/api/v1/inventory')
      .set(bearer(plainToken))
      .send({ name: '越权物料', quantity: 1 });
    expect(denied.status).toBe(403);

    const issued = await api
      .post(`/api/v1/inventory/${itemId}/stock`)
      .set(bearer(opsToken))
      .send({ delta: -3, reason: 'issue', note: '工作坊领用' });
    expect(issued.status).toBe(200);
    expect(issued.body.item.quantity).toBe(2);
    expect(issued.body.item.lowStock).toBe(true);

    const low = await api.get('/api/v1/inventory?low=1').set(bearer(opsToken));
    expect(low.body.items.some((item) => item.id === itemId)).toBe(true);

    const tooMuch = await api
      .post(`/api/v1/inventory/${itemId}/stock`)
      .set(bearer(opsToken))
      .send({ delta: -10, reason: 'issue' });
    expect(tooMuch.status).toBe(409);

    const logs = await api.get(`/api/v1/inventory/${itemId}/logs`).set(bearer(opsToken));
    expect(logs.status).toBe(200);
    expect(logs.body.items.length).toBe(2);
  });

  it('活动报名防重复，签到后不可重复签到', async () => {
    const created = await api.post('/api/v1/activities').set(bearer(opsToken)).send({
      title: '测试工作坊',
      location: '电子实验室',
      startAt: '2026-12-10T19:00',
      endAt: '2026-12-10T21:00',
      signupDeadline: '2026-12-09T23:59',
      capacity: 2,
      status: 'open',
    });
    expect(created.status).toBe(201);
    const activityId = created.body.item.id;

    const denied = await api.post('/api/v1/activities').set(bearer(plainToken)).send({
      title: '越权活动',
      startAt: '2026-12-11T19:00',
    });
    expect(denied.status).toBe(403);

    const signup = await api.post(`/api/v1/activities/${activityId}/signup`).set(bearer(plainToken)).send({});
    expect(signup.status).toBe(200);
    expect(signup.body.item.mySignupStatus).toBe('confirmed');

    const duplicate = await api.post(`/api/v1/activities/${activityId}/signup`).set(bearer(plainToken)).send({});
    expect(duplicate.status).toBe(409);

    const list = await api.get(`/api/v1/activities/${activityId}/signups`).set(bearer(opsToken));
    expect(list.status).toBe(200);
    const signupId = list.body.items[0].id;

    const checkin = await api
      .post(`/api/v1/activities/${activityId}/signups/${signupId}/checkin`)
      .set(bearer(opsToken));
    expect(checkin.status).toBe(200);

    const repeat = await api
      .post(`/api/v1/activities/${activityId}/signups/${signupId}/checkin`)
      .set(bearer(opsToken));
    expect(repeat.status).toBe(409);
  });

  it('值班排班受人数上限约束，成员可自助签到', async () => {
    const created = await api.post('/api/v1/duty/shifts').set(bearer(opsToken)).send({
      date: '2026-12-05',
      startTime: '18:00',
      endTime: '20:00',
      location: '创客空间 A 区',
      capacity: 1,
    });
    expect(created.status).toBe(201);
    const shift = created.body.items[0];

    const denied = await api.post('/api/v1/duty/shifts').set(bearer(plainToken)).send({
      date: '2026-12-06',
      startTime: '18:00',
      endTime: '20:00',
    });
    expect(denied.status).toBe(403);

    const assigned = await api
      .post(`/api/v1/duty/shifts/${shift.id}/assign`)
      .set(bearer(opsToken))
      .send({ userId: plainUserId });
    expect(assigned.status).toBe(200);
    const assignment = assigned.body.items[0].assignments[0];

    const full = await api
      .post(`/api/v1/duty/shifts/${shift.id}/assign`)
      .set(bearer(opsToken))
      .send({ userId: opsUserId });
    expect(full.status).toBe(409);

    const checkin = await api
      .post(`/api/v1/duty/assignments/${assignment.id}/checkin`)
      .set(bearer(plainToken));
    expect(checkin.status).toBe(200);
  });

  it('资料归档按权限控制可见范围并支持下载', async () => {
    const uploaded = await api
      .post('/api/v1/documents')
      .set(bearer(opsToken))
      .field('title', '内部测试资料')
      .field('category', '内部资料')
      .field('visibility', 'admin')
      .attach('files', Buffer.from('internal-content'), {
        filename: 'internal.txt',
        contentType: 'text/plain',
      });
    expect(uploaded.status).toBe(201);
    const doc = uploaded.body.items[0];
    expect(doc.visibility).toBe('admin');

    const denied = await api
      .post('/api/v1/documents')
      .set(bearer(plainToken))
      .attach('files', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(denied.status).toBe(403);

    const opsList = await api.get('/api/v1/documents').set(bearer(opsToken));
    expect(opsList.body.items.some((item) => item.id === doc.id)).toBe(true);

    const plainList = await api.get('/api/v1/documents').set(bearer(plainToken));
    expect(plainList.body.items.some((item) => item.id === doc.id)).toBe(false);

    const download = await api
      .get(`/api/v1/documents/${doc.id}/download?download=1`)
      .set(bearer(opsToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.body.toString()).toBe('internal-content');

    const updated = await api
      .patch(`/api/v1/documents/${doc.id}`)
      .set(bearer(opsToken))
      .send({ visibility: 'all', title: '公开测试资料' });
    expect(updated.status).toBe(200);

    const plainAgain = await api.get('/api/v1/documents').set(bearer(plainToken));
    expect(plainAgain.body.items.some((item) => item.id === doc.id)).toBe(true);
  });

  it('Excel 导入活动与值班表', async () => {
    const activityBook = new ExcelJS.Workbook();
    const activitySheet = activityBook.addWorksheet('活动');
    activitySheet.addRow(['活动名称', '地点', '开始时间', '结束时间', '报名截止', '人数上限', '报名费(元)', '活动说明']);
    activitySheet.addRow([
      'Excel 导入工作坊',
      '电子实验室 B 区',
      '2026-12-20 19:00',
      '2026-12-20 21:00',
      '2026-12-19 23:59',
      20,
      5,
      '自动化导入测试',
    ]);
    activitySheet.addRow(['缺开始时间', '某地', '', '', '', 10, 0, '']);
    const activityBuffer = Buffer.from(await activityBook.xlsx.writeBuffer());

    const deniedImport = await api
      .post('/api/v1/imports/activities')
      .set(bearer(plainToken))
      .attach('file', activityBuffer, { filename: 'activities.xlsx' });
    expect(deniedImport.status).toBe(403);

    const activityImport = await api
      .post('/api/v1/imports/activities')
      .set(bearer(opsToken))
      .attach('file', activityBuffer, { filename: 'activities.xlsx' });
    expect(activityImport.status).toBe(200);
    expect(activityImport.body.created).toBe(1);
    expect(activityImport.body.skipped.length).toBe(1);

    const activities = await api.get('/api/v1/activities').set(bearer(opsToken));
    const imported = activities.body.items.find((item) => item.title === 'Excel 导入工作坊');
    expect(imported).toBeTruthy();
    expect(imported.feeCents).toBe(500);
    expect(imported.capacity).toBe(20);

    const dutyBook = new ExcelJS.Workbook();
    const dutySheet = dutyBook.addWorksheet('值班表');
    dutySheet.addRow(['日期', '开始时间', '结束时间', '地点', '需要人数', '值班人', '备注']);
    dutySheet.addRow(['2026-12-21', '18:00', '20:00', '创客空间 A 区', 2, '普通成员、查无此人', '导入测试']);
    const dutyBuffer = Buffer.from(await dutyBook.xlsx.writeBuffer());

    const dutyImport = await api
      .post('/api/v1/imports/duty')
      .set(bearer(opsToken))
      .attach('file', dutyBuffer, { filename: 'duty.xlsx' });
    expect(dutyImport.status).toBe(200);
    expect(dutyImport.body.createdShifts).toBe(1);
    expect(dutyImport.body.createdAssignments).toBe(1);
    expect(dutyImport.body.skipped[0].reason).toContain('查无此人');

    const shifts = await api.get('/api/v1/duty/shifts?from=2026-12-21&to=2026-12-21').set(bearer(opsToken));
    expect(shifts.body.items.length).toBe(1);
    expect(shifts.body.items[0].assignments.length).toBe(1);
  });

  it('设备类型可自定义并按板块查询', async () => {
    const created = await api
      .post('/api/v1/equipment')
      .set(bearer(opsToken))
      .send({ code: 'I-CUSTOM-1', name: '自定义类型仪器', category: 'instrument', typeName: '频谱分析仪' });
    expect(created.status).toBe(201);
    expect(created.body.item.typeName).toBe('频谱分析仪');

    const types = await api.get('/api/v1/equipment/types').set(bearer(opsToken));
    expect(types.status).toBe(200);
    expect(types.body.items.some((item) => item.name === '频谱分析仪')).toBe(true);

    const updated = await api
      .patch(`/api/v1/equipment/${created.body.item.id}`)
      .set(bearer(opsToken))
      .send({ typeName: '矢量网络分析仪' });
    expect(updated.status).toBe(200);
    expect(updated.body.item.typeName).toBe('矢量网络分析仪');
  });

  it('首页运营概览返回待办与库存预警', async () => {
    const res = await api.get('/api/v1/summary/operations').set(bearer(opsToken));
    expect(res.status).toBe(200);
    for (const key of ['pendingBookings', 'pendingAccess', 'openActivities', 'lowStock', 'myBorrowed']) {
      expect(typeof res.body[key]).toBe('number');
    }
    expect(res.body.todayDuty.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.lowStockPreview)).toBe(true);
  });

  it('设备日志支持全部或按设备类型导出', async () => {
    const binary = (res, cb) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    const all = await api
      .get('/api/v1/export/equipment-logs')
      .set(bearer(opsToken))
      .buffer(true)
      .parse(binary);
    expect(all.status).toBe(200);
    expect(all.headers['content-type']).toContain('spreadsheetml');

    const denied = await api.get('/api/v1/export/equipment-logs').set(bearer(plainToken));
    expect(denied.status).toBe(403);

    const typed = await api
      .get('/api/v1/export/equipment-logs')
      .query({ type: '矢量网络分析仪' })
      .set(bearer(opsToken))
      .buffer(true)
      .parse(binary);
    expect(typed.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(typed.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '导出说明',
      '设备台账',
      '预约记录',
      '打印任务',
      '维护记录',
      '借还记录',
    ]);
    const sheet = workbook.getWorksheet('设备台账');
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('D2').value).toBe('矢量网络分析仪');
  });

  it('改密或重置密码后旧 token 立即失效', async () => {
    const created = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'revoke01',
      displayName: '吊销测试',
      role: 'member',
      password: 'Test12345',
    });
    expect(created.status).toBe(201);

    const tokenA = (await login('revoke01', 'Test12345')).body.token;
    expect((await api.get('/api/v1/auth/me').set(bearer(tokenA))).status).toBe(200);

    const changed = await api
      .post('/api/v1/auth/change-password')
      .set(bearer(tokenA))
      .send({ oldPassword: 'Test12345', newPassword: 'Test54321' });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.token).toBe('string');

    expect((await api.get('/api/v1/auth/me').set(bearer(tokenA))).status).toBe(401);
    const tokenB = changed.body.token;
    expect((await api.get('/api/v1/auth/me').set(bearer(tokenB))).status).toBe(200);

    const reset = await api
      .post(`/api/v1/users/${created.body.user.id}/reset-password`)
      .set(bearer(adminToken))
      .send({ password: 'Test99999' });
    expect(reset.status).toBe(200);
    expect((await api.get('/api/v1/auth/me').set(bearer(tokenB))).status).toBe(401);
    expect((await login('revoke01', 'Test99999')).status).toBe(200);
  });

  it('登录失败次数落库限流，超过 5 次返回 429', async () => {
    for (let i = 0; i < 5; i += 1) {
      const failed = await login('nobody01', 'WrongPass123');
      expect(failed.status).toBe(401);
    }
    const blocked = await login('nobody01', 'WrongPass123');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('15 分钟');
  });

  it('未开启 API 权限的成员不能管理密钥', async () => {
    const listed = await api.get('/api/v1/api-keys').set(bearer(plainToken));
    expect(listed.status).toBe(403);

    const denied = await api.post('/api/v1/api-keys').set(bearer(plainToken)).send({ name: '越权密钥' });
    expect(denied.status).toBe(403);
  });

  it('API Key 继承成员权限，撤销后立即失效', async () => {
    const patched = await api
      .patch(`/api/v1/users/${opsUserId}`)
      .set(bearer(adminToken))
      .send({ perms: [...ALL_PERMS, 'api'] });
    expect(patched.status).toBe(200);
    expect(patched.body.user.perms).toContain('api');

    // 自己签发：只能看到自己的密钥
    const created = await api.post('/api/v1/api-keys').set(bearer(opsToken)).send({
      name: '自动化测试密钥',
      expiresInDays: 30,
    });
    expect(created.status).toBe(201);
    expect(created.body.key.startsWith('cfk_')).toBe(true);
    expect(created.body.prefix).toBe(created.body.key.slice(0, 12));
    expect(created.body.userId).toBe(opsUserId);

    const mine = await api.get('/api/v1/api-keys').set(bearer(opsToken));
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((item) => item.userId === opsUserId)).toBe(true);

    // X-API-Key 认证，并以成员身份继承模块权限
    const me = await api.get('/api/v1/auth/me').set('X-API-Key', created.body.key);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('ops01');
    expect(me.body.user.role).toBe('member');
    expect((await api.get('/api/v1/equipment').set('X-API-Key', created.body.key)).status).toBe(200);

    // 也支持 Authorization: ApiKey <key>
    const alt = await api.get('/api/v1/summary').set('Authorization', `ApiKey ${created.body.key}`);
    expect(alt.status).toBe(200);

    const revoked = await api
      .post(`/api/v1/api-keys/${created.body.id}/revoke`)
      .set(bearer(adminToken));
    expect(revoked.status).toBe(200);
    expect((await api.get('/api/v1/auth/me').set('X-API-Key', created.body.key)).status).toBe(401);
  });

  it('管理员可为他人签发密钥，无效密钥视为未登录', async () => {
    const created = await api.post('/api/v1/api-keys').set(bearer(adminToken)).send({
      name: '管理员代签',
      userId: plainUserId,
    });
    // plain01 没有 API 权限，应被拒绝
    expect(created.status).toBe(400);
    expect(created.body.error).toContain('API');

    expect((await api.get('/api/v1/auth/me').set('X-API-Key', 'cfk_not_exists')).status).toBe(401);
  });

  it('旧接口传入 finance 角色时自动并入党费台账权限', async () => {
    const created = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'legacy01',
      displayName: '旧财务员',
      role: 'finance',
      password: 'Test12345',
      canIncome: true,
      canExpense: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.user.role).toBe('member');
    expect(created.body.user.perms).toContain('finance');
    expect(created.body.user.canIncome).toBe(true);
    expect(created.body.user.canExpense).toBe(false);
  });

  it('CORS 仅对白名单来源回写跨域头', async () => {
    const res = await api.options('/api/v1/auth/login').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('管理员可查看运行状态，成员无权访问', async () => {
    expect((await api.get('/api/v1/system/status').set(bearer(plainToken))).status).toBe(403);

    const res = await api.get('/api/v1/system/status').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.app.version).toBe('1.0.0');
    expect(typeof res.body.app.uptimeSeconds).toBe('number');
    expect(res.body.app.dbSize).toBeGreaterThan(0);
    expect(res.body.worker).toHaveProperty('online');
    expect(res.body.backup).toHaveProperty('count');
  });
});

describe('微信小程序免密登录', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WX_APPID;
    delete process.env.WX_SECRET;
  });

  it('未配置 AppID/Secret 时微信登录直接返回 503', async () => {
    const res = await api.post('/api/v1/auth/wechat/login').send({ code: 'any' });
    expect(res.status).toBe(503);
  });

  it('绑定后可用 code 免密登录，同一微信不能绑定两个账号', async () => {
    process.env.WX_APPID = 'wx_test_appid';
    process.env.WX_SECRET = 'wx_test_secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ openid: 'openid_demo', session_key: 'sk' }) })),
    );

    const admin = await login('admin', 'Admin@123456');
    const adminToken = admin.body.token;
    const created = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'wxuser01',
      displayName: '微信用户',
      role: 'member',
      password: 'Test12345',
    });
    expect(created.status).toBe(201);
    const token = (await login('wxuser01', 'Test12345')).body.token;

    const before = await api.get('/api/v1/auth/wechat/status').set(bearer(token));
    expect(before.body).toEqual({ configured: true, bound: false });

    const bound = await api.post('/api/v1/auth/wechat/bind').set(bearer(token)).send({ code: 'code_1' });
    expect(bound.status).toBe(200);
    expect(bound.body.user.wxBound).toBe(true);

    const auto = await api.post('/api/v1/auth/wechat/login').send({ code: 'code_2' });
    expect(auto.status).toBe(200);
    const me = await api.get('/api/v1/auth/me').set(bearer(auto.body.token));
    expect(me.body.user.username).toBe('wxuser01');
    expect(me.body.user.wxBound).toBe(true);

    // 另一个账号试图绑定同一微信
    const other = await api.post('/api/v1/users').set(bearer(adminToken)).send({
      username: 'wxuser02',
      displayName: '另一个用户',
      role: 'member',
      password: 'Test12345',
    });
    expect(other.status).toBe(201);
    const otherToken = (await login('wxuser02', 'Test12345')).body.token;
    const conflict = await api.post('/api/v1/auth/wechat/bind').set(bearer(otherToken)).send({ code: 'code_3' });
    expect(conflict.status).toBe(409);

    const unbound = await api.delete('/api/v1/auth/wechat/bind').set(bearer(token));
    expect(unbound.status).toBe(200);
    expect(unbound.body.user.wxBound).toBe(false);

    // 解绑后微信免密登录不再可用
    const afterUnbind = await api.post('/api/v1/auth/wechat/login').send({ code: 'code_2' });
    expect(afterUnbind.status).toBe(404);
  });
});
