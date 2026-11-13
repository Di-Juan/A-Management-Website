import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db, audit, nowIso, tx } from '../db.js';
import { PERM_KEYS, hashPassword, requireAuth, requirePerm, requireRole } from '../auth.js';
import { HttpError, ah, clientIp, parseDateTime, text } from '../helpers.js';

export const importRouter = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const pad = (num) => String(num).padStart(2, '0');

function cellDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = String(value ?? '').trim().replace(/[/.]/g, '-');
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
}

function cellClock(value) {
  if (value instanceof Date) return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  const raw = String(value ?? '').trim();
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${pad(match[1])}:${match[2]}`;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 0 && num < 1) {
    const minutes = Math.round(num * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  return '';
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return cellDate(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.text) return String(value.text);
    return '';
  }
  return String(value).trim();
}

/** 读取首个工作表，返回 [{ row: 行号, data: { 表头: 值 } }] */
async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'Excel 中没有工作表');
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col] = cellText(cell.value).replace(/\s+/g, '');
  });
  if (headers.filter(Boolean).length === 0) throw new HttpError(400, '未识别到表头，请使用模板填写');

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = {};
    for (let col = 1; col < headers.length + 1; col += 1) {
      const key = headers[col];
      if (!key) continue;
      data[key] = row.getCell(col).value;
    }
    const hasValue = Object.values(data).some((value) => cellText(value) !== '');
    if (hasValue) rows.push({ row: rowNumber, data });
  });
  return rows;
}

const pick = (data, keys) => {
  for (const key of keys) {
    if (data[key] !== undefined && cellText(data[key]) !== '') return data[key];
  }
  return '';
};

async function parseWorkbook(req) {
  if (!req.file) throw new HttpError(400, '请选择要导入的 Excel 文件');
  if (!/\.xlsx?$/i.test(req.file.originalname || '')) {
    throw new HttpError(400, '仅支持 .xlsx / .xls 格式，可先下载模板填写');
  }
  try {
    return await readSheet(req.file.buffer);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Excel 解析失败，请确认文件未损坏且为 .xlsx 格式');
  }
}

/* ------------------------------ 活动导入 ------------------------------ */

importRouter.get(
  '/activities/template',
  requireAuth,
  requirePerm('activity'),
  ah(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('活动');
    sheet.columns = [
      { header: '活动名称', key: 'title', width: 28 },
      { header: '地点', key: 'location', width: 18 },
      { header: '开始时间', key: 'start', width: 20 },
      { header: '结束时间', key: 'end', width: 20 },
      { header: '报名截止', key: 'deadline', width: 20 },
      { header: '人数上限', key: 'capacity', width: 12 },
      { header: '报名费(元)', key: 'fee', width: 12 },
      { header: '活动说明', key: 'description', width: 36 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      title: 'STM32 嵌入式入门工作坊',
      location: '电子实验室 B 区',
      start: '2026-12-10 19:00',
      end: '2026-12-10 21:00',
      deadline: '2026-12-09 23:59',
      capacity: 30,
      fee: 0,
      description: '面向零基础成员，自带电脑',
    });
    sheet.getRow(2).font = { color: { argb: 'FF9CA3AF' } };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-import-template.xlsx"');
    const buffer = await workbook.xlsx.writeBuffer();
    res.end(Buffer.from(buffer));
  }),
);

importRouter.post(
  '/activities',
  requireAuth,
  requirePerm('activity'),
  upload.single('file'),
  ah(async (req, res) => {
    const rows = await parseWorkbook(req);
    const skipped = [];
    let created = 0;
    const now = nowIso();

    tx(() => {
      const insert = db.prepare(
        `INSERT INTO activities (title, description, location, start_at, end_at, signup_deadline, capacity,
                                 fee_cents, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      );
      for (const { row, data } of rows) {
        try {
          const title = text(cellText(pick(data, ['活动名称', '标题', '活动'])), {
            field: '活动名称',
            required: true,
            max: 80,
          });
          const date = cellDate(pick(data, ['开始时间', '活动时间', '日期']));
          const clock = cellClock(pick(data, ['开始时间', '活动时间']));
          if (!date) throw new HttpError(400, '开始时间无法识别，请使用 2026-12-10 19:00 格式');
          const startAt = parseDateTime(`${date}T${clock || '09:00'}`, '开始时间');
          const endDate = cellDate(pick(data, ['结束时间']));
          const endClock = cellClock(pick(data, ['结束时间']));
          const endAt = endDate ? parseDateTime(`${endDate}T${endClock || '21:00'}`, '结束时间') : null;
          if (endAt && new Date(endAt) <= new Date(startAt)) throw new HttpError(400, '结束时间需晚于开始时间');
          const deadlineDate = cellDate(pick(data, ['报名截止', '报名截止时间']));
          const deadlineClock = cellClock(pick(data, ['报名截止', '报名截止时间']));
          const signupDeadline = deadlineDate
            ? parseDateTime(`${deadlineDate}T${deadlineClock || '23:59'}`, '报名截止')
            : null;
          const capacityRaw = Number(cellText(pick(data, ['人数上限', '人数'])));
          const capacity = Number.isFinite(capacityRaw) && capacityRaw > 0 ? Math.round(capacityRaw) : null;
          const feeRaw = Number(cellText(pick(data, ['报名费(元)', '报名费', '费用(元)', '费用'])));
          const feeCents = Number.isFinite(feeRaw) && feeRaw > 0 ? Math.round(feeRaw * 100) : 0;
          const description = text(cellText(pick(data, ['活动说明', '说明', '介绍'])), { field: '活动说明', max: 1000 });
          const location = text(cellText(pick(data, ['地点', '活动地点'])), { field: '地点', max: 60 });

          insert.run(title, description, location, startAt, endAt, signupDeadline, capacity, feeCents, req.user.id, now, now);
          created += 1;
        } catch (err) {
          skipped.push({ row, reason: err.message });
        }
      }
    });

    audit({
      actor: req.user,
      action: 'activity.import',
      entityType: 'activity',
      detail: { created, skipped: skipped.length },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.json({ created, skipped, total: rows.length });
  }),
);

/* ------------------------------ 值班导入 ------------------------------ */

const DUTY_TEMPLATE_HEADERS = ['日期', '开始时间', '结束时间', '地点', '需要人数', '值班人', '备注'];

importRouter.get(
  '/duty/template',
  requireAuth,
  requirePerm('duty'),
  ah(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('值班表');
    sheet.columns = DUTY_TEMPLATE_HEADERS.map((header) => ({
      header,
      key: header,
      width: header === '备注' ? 30 : header === '值班人' ? 24 : 14,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      日期: '2026-12-05',
      开始时间: '18:00',
      结束时间: '20:00',
      地点: '创客空间 A 区',
      需要人数: 2,
      值班人: '王梓涵、陈可欣',
      备注: '日常值守，处理预约与借还',
    });
    sheet.getRow(2).font = { color: { argb: 'FF9CA3AF' } };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="duty-import-template.xlsx"');
    const buffer = await workbook.xlsx.writeBuffer();
    res.end(Buffer.from(buffer));
  }),
);

importRouter.post(
  '/duty',
  requireAuth,
  requirePerm('duty'),
  upload.single('file'),
  ah(async (req, res) => {
    const rows = await parseWorkbook(req);
    const skipped = [];
    let createdShifts = 0;
    let createdAssignments = 0;
    const now = nowIso();

    const findUser = (keyword) =>
      db
        .prepare(
          `SELECT id, display_name FROM users
           WHERE status = 'active' AND (username = ? OR display_name = ?)`,
        )
        .get(keyword, keyword);

    tx(() => {
      for (const { row, data } of rows) {
        try {
          const date = cellDate(pick(data, ['日期', '值班日期']));
          if (!date) throw new HttpError(400, '日期无法识别，请使用 2026-12-05 格式');
          const startTime = cellClock(pick(data, ['开始时间', '开始']));
          const endTime = cellClock(pick(data, ['结束时间', '结束']));
          if (!startTime || !endTime) throw new HttpError(400, '开始/结束时间无法识别');
          if (endTime <= startTime) throw new HttpError(400, '结束时间需晚于开始时间');
          const location = text(cellText(pick(data, ['地点', '值班地点'])), { field: '值班地点', max: 60 });
          const capacityRaw = Number(cellText(pick(data, ['需要人数', '人数'])));
          const capacity = Number.isFinite(capacityRaw) && capacityRaw > 0 ? Math.min(20, Math.round(capacityRaw)) : 1;
          const note = text(cellText(pick(data, ['备注'])), { field: '备注', max: 200 });

          const names = cellText(pick(data, ['值班人', '值班成员', '值班人员']))
            .split(/[、,，;；/\s]+/)
            .map((item) => item.trim())
            .filter(Boolean);
          const resolved = names.map((name) => ({ name, user: findUser(name) }));
          if (resolved.length > 0 && resolved.every((item) => !item.user)) {
            throw new HttpError(400, `未找到成员「${names.join('、')}」`);
          }

          const existing = db
            .prepare('SELECT id FROM duty_shifts WHERE date = ? AND start_time = ? AND location IS ?')
            .get(date, startTime, location || null);
          let shiftId = existing?.id;
          if (!shiftId) {
            shiftId = Number(
              db
                .prepare(
                  `INSERT INTO duty_shifts (date, start_time, end_time, location, capacity, note, created_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(date, startTime, endTime, location, capacity, note, req.user.id, now).lastInsertRowid,
            );
            createdShifts += 1;
          }

          for (const { name, user } of resolved) {
            if (!user) {
              skipped.push({ row, reason: `未找到成员「${name}」` });
              continue;
            }
            const dup = db
              .prepare('SELECT 1 FROM duty_assignments WHERE shift_id = ? AND user_id = ?')
              .get(shiftId, user.id);
            if (dup) continue;
            const count = db.prepare('SELECT COUNT(*) AS c FROM duty_assignments WHERE shift_id = ?').get(shiftId).c;
            if (count >= capacity) {
              skipped.push({ row, reason: `「${name}」超出该班次人数上限 ${capacity}` });
              continue;
            }
            db.prepare(
              'INSERT INTO duty_assignments (shift_id, user_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)',
            ).run(shiftId, user.id, 'assigned', '', now);
            createdAssignments += 1;
          }
        } catch (err) {
          skipped.push({ row, reason: err.message });
        }
      }
    });

    audit({
      actor: req.user,
      action: 'duty.import',
      entityType: 'duty_shift',
      detail: { createdShifts, createdAssignments, skipped: skipped.length },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.json({ createdShifts, createdAssignments, skipped, total: rows.length });
  }),
);

/* ------------------------------ 成员名单导入 ------------------------------ */

const PERM_ALIAS = {
  finance: ['finance', '经费', '财务', '经费台账'],
  equipment: ['equipment', '设备', '设备预约', '打印'],
  inventory: ['inventory', '库存', '耗材', '元器件', '借还'],
  access: ['access', '门禁'],
  activity: ['activity', '活动'],
  duty: ['duty', '值班'],
  doc: ['doc', '资料', '文档', '资料归档'],
  api: ['api', 'API', '接口', 'API调用'],
};

function parsePermCell(raw) {
  const tokens = String(raw || '')
    .split(/[,，、;；/\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const perms = [];
  const unknown = [];
  for (const token of tokens) {
    const hit = PERM_KEYS.find((key) =>
      PERM_ALIAS[key].some((alias) => alias.toLowerCase() === token.toLowerCase()),
    );
    if (hit) {
      if (!perms.includes(hit)) perms.push(hit);
    } else {
      unknown.push(token);
    }
  }
  return { perms, unknown };
}

const yesNo = (raw, fallback) => {
  const value = String(raw || '').trim();
  if (!value) return fallback;
  if (['是', 'Y', 'y', '1', 'true', '允许', '可'].includes(value)) return true;
  if (['否', 'N', 'n', '0', 'false', '不允许'].includes(value)) return false;
  return fallback;
};

/** 生成符合密码规则的初始密码：字母 + 数字，长度 10 */
function generatePassword() {
  return `Kx${crypto.randomBytes(3).toString('hex')}${crypto.randomInt(10, 99)}`;
}

/** 未提供账号时自动分配 kx0001、kx0002…，避开已存在账号 */
function nextAutoUsername(taken) {
  const max = db
    .prepare("SELECT username FROM users WHERE username GLOB 'kx[0-9][0-9][0-9][0-9]'")
    .all()
    .reduce((acc, row) => Math.max(acc, Number(row.username.slice(2)) || 0), 0);
  let seq = max;
  let candidate;
  do {
    seq += 1;
    candidate = `kx${String(seq).padStart(4, '0')}`;
  } while (taken.has(candidate));
  return candidate;
}

importRouter.get(
  '/members/template',
  requireAuth,
  requireRole('admin'),
  ah(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('成员名单');
    sheet.columns = [
      { header: '姓名', key: 'name', width: 16 },
      { header: '学号', key: 'studentNo', width: 18 },
      { header: '部门', key: 'department', width: 16 },
      { header: '手机', key: 'phone', width: 16 },
      { header: '登录账号', key: 'username', width: 18 },
      { header: '角色', key: 'role', width: 12 },
      { header: '权限', key: 'perms', width: 30 },
      { header: '可收入', key: 'canIncome', width: 10 },
      { header: '可支出', key: 'canExpense', width: 10 },
      { header: '加入时间', key: 'joinedAt', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      name: '张三',
      studentNo: '2023010001',
      department: '技术部',
      phone: '13800000000',
      username: '',
      role: '成员',
      perms: '设备、库存、值班',
      canIncome: '',
      canExpense: '',
      joinedAt: '2026-09-01',
    });
    sheet.addRow({
      name: '李四',
      studentNo: '2023010002',
      department: '财务组',
      phone: '',
      username: 'finance02',
      role: '成员',
      perms: '经费',
      canIncome: '是',
      canExpense: '是',
      joinedAt: '2026-09-01',
    });
    for (const index of [2, 3]) sheet.getRow(index).font = { color: { argb: 'FF9CA3AF' } };

    const guide = workbook.addWorksheet('填写说明');
    guide.columns = [{ width: 100 }];
    [
      '1. 姓名为必填项，其余列可留空。',
      '2. 登录账号：留空时优先使用学号；学号也为空则自动分配 kx0001 起的账号。账号需为 3-40 位字母/数字/._-。',
      '3. 角色：填「成员」或「管理员」，留空默认为成员；管理员自动拥有全部权限。',
      '4. 权限：多个权限用逗号、顿号或空格分隔，可选：经费、设备、库存、门禁、活动、值班、资料、API（也支持英文 finance/equipment/inventory/access/activity/duty/doc/api）。',
      '5. 可收入/可支出：仅当权限包含「经费」时生效，填「是」或「否」，默认都是「是」，至少保留一项。',
      '6. 初始密码由系统自动生成并在导入结果中返回，请下载账号表分发给成员；成员首次登录需修改密码。',
      '7. 已存在的账号会跳过并在结果中列出，不会覆盖原账号。',
    ].forEach((line) => guide.addRow([line]));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="member-import-template.xlsx"');
    const buffer = await workbook.xlsx.writeBuffer();
    res.end(Buffer.from(buffer));
  }),
);

importRouter.post(
  '/members',
  requireAuth,
  requireRole('admin'),
  upload.single('file'),
  ah(async (req, res) => {
    const rows = await parseWorkbook(req);
    if (rows.length === 0) throw new HttpError(400, '未读取到有效数据行，请使用模板填写');
    if (rows.length > 200) throw new HttpError(400, '单次最多导入 200 名成员，请分批导入');

    const skipped = [];
    const accounts = [];
    const now = nowIso();
    const taken = new Set(db.prepare('SELECT username FROM users').all().map((row) => row.username));
    const autoSeqTaken = new Set(taken);

    tx(() => {
      const insert = db.prepare(
        `INSERT INTO users (username, password_hash, display_name, role, status, must_change_password,
                            can_income, can_expense, perms, student_no, department, phone, joined_at,
                            created_at, created_by)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { row, data } of rows) {
        try {
          const displayName = cellText(pick(data, ['姓名', '名称', '成员姓名']));
          if (!displayName) throw new Error('缺少姓名');
          if (displayName.length > 30) throw new Error('姓名过长（最多 30 字）');
          const studentNo = cellText(pick(data, ['学号', '学工号']));
          const department = cellText(pick(data, ['部门', '组别']));
          const phone = cellText(pick(data, ['手机', '联系方式', '电话']));
          const joinedAt = cellText(pick(data, ['加入时间', '加入日期']));

          const roleRaw = cellText(pick(data, ['角色']));
          const role = ['管理员', 'admin'].includes(roleRaw) ? 'admin' : 'member';

          let username = cellText(pick(data, ['登录账号', '账号', '用户名'])) || studentNo;
          if (!username) username = nextAutoUsername(autoSeqTaken);
          if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
            throw new Error(`账号「${username}」需为 3-40 位字母/数字/._-`);
          }
          if (taken.has(username)) throw new Error(`账号 ${username} 已存在`);

          let perms = PERM_KEYS;
          let canIncome = true;
          let canExpense = true;
          if (role !== 'admin') {
            const parsed = parsePermCell(cellText(pick(data, ['权限', '权限列表'])));
            if (parsed.unknown.length > 0) {
              throw new Error(`权限无法识别：${parsed.unknown.join('、')}`);
            }
            perms = parsed.perms;
            if (perms.includes('finance')) {
              canIncome = yesNo(cellText(pick(data, ['可收入'])), true);
              canExpense = yesNo(cellText(pick(data, ['可支出'])), true);
              if (!canIncome && !canExpense) throw new Error('经费权限需至少允许收入或支出');
            } else {
              canIncome = false;
              canExpense = false;
            }
          }

          const password = generatePassword();
          const id = Number(
            insert.run(
              username,
              hashPassword(password),
              displayName,
              role,
              canIncome ? 1 : 0,
              canExpense ? 1 : 0,
              JSON.stringify(perms),
              studentNo || null,
              department || null,
              phone || null,
              joinedAt || null,
              now,
              req.user.id,
            ).lastInsertRowid,
          );
          taken.add(username);
          autoSeqTaken.add(username);
          accounts.push({ id, username, password, displayName, role, studentNo, department, perms });
        } catch (err) {
          skipped.push({ row, name: cellText(pick(data, ['姓名', '名称', '成员姓名'])), reason: err.message });
        }
      }
    });

    audit({
      actor: req.user,
      action: 'user.import',
      entityType: 'user',
      detail: {
        created: accounts.length,
        skipped: skipped.length,
        usernames: accounts.map((item) => item.username),
      },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    res.status(accounts.length > 0 ? 201 : 200).json({
      created: accounts.length,
      total: rows.length,
      skipped,
      accounts,
    });
  }),
);
