import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { db, audit, nowIso, tx } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
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
