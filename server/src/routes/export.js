import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import { db, audit, getSetting } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';
import { HttpError, ah, clientIp, optionalDate } from '../helpers.js';
import { buildFilters, balanceSummary } from '../ledger.js';

export const exportRouter = express.Router();

const TYPE_LABEL = { income: '收入', expense: '支出' };
const ROLE_LABEL = { admin: '管理员', member: '成员' };

function exportWhere(query) {
  const cleaned = {
    from: optionalDate(query.from, '开始日期') || null,
    to: optionalDate(query.to, '结束日期') || null,
    type: query.type === 'income' || query.type === 'expense' ? query.type : null,
    categoryId: query.categoryId || null,
    q: query.q || null,
  };
  if (cleaned.from && cleaned.to && cleaned.from > cleaned.to) {
    throw new HttpError(400, '开始日期不能晚于结束日期');
  }
  return { ...buildFilters(cleaned), cleaned };
}

function loadTransactions(whereSql, params) {
  return db
    .prepare(
      `SELECT t.*, c.name AS category_name, u.display_name AS operator_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.operator_id
       WHERE ${whereSql}
       ORDER BY t.occurred_at ASC, t.id ASC`,
    )
    .all(...params);
}

function fmtLocalTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeName(name, fallback = '文件') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .trim();
  return (cleaned || fallback).slice(0, 60);
}

async function buildWorkbook(rows, meta) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '科协运营管理平台';
  workbook.created = new Date();

  /* ---- 汇总 sheet ---- */
  const summary = workbook.addWorksheet('账单汇总', {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: 'FF0F766E' } },
  });
  summary.columns = [{ width: 22 }, { width: 34 }, { width: 22 }, { width: 22 }];

  summary.mergeCells('A1:D1');
  const title = summary.getCell('A1');
  title.value = `${meta.className} 经费账单`;
  title.font = { size: 20, bold: true, color: { argb: 'FF0F172A' } };
  title.alignment = { vertical: 'middle', horizontal: 'center' };
  summary.getRow(1).height = 36;

  summary.mergeCells('A2:D2');
  const subtitle = summary.getCell('A2');
  subtitle.value = `${meta.term} · 导出时间 ${fmtLocalTime(new Date().toISOString())} · 导出人 ${meta.operator}`;
  subtitle.font = { size: 10, color: { argb: 'FF64748B' } };
  subtitle.alignment = { horizontal: 'center' };

  const summaryRows = [
    ['统计范围', meta.rangeLabel, '记录条数', `${rows.length} 条`],
    ['总收入', money(meta.incomeCents), '总支出', money(meta.expenseCents)],
    ['期间结余', money(meta.incomeCents - meta.expenseCents), '账户总余额', money(meta.balanceCents)],
  ];
  let r = 4;
  for (const line of summaryRows) {
    const row = summary.getRow(r);
    line.forEach((value, idx) => {
      const cell = row.getCell(idx + 1);
      cell.value = value;
      cell.alignment = { vertical: 'middle' };
      if (idx % 2 === 0) {
        cell.font = { bold: true, color: { argb: 'FF475569' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      } else {
        cell.font = { bold: true, size: idx === 1 || idx === 3 ? 12 : 11 };
      }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
    row.height = 24;
    r += 1;
  }

  r += 1;
  const catTitle = summary.getCell(`A${r}`);
  catTitle.value = '分类统计';
  catTitle.font = { bold: true, size: 12 };
  r += 1;
  summary.getRow(r).values = ['类型', '分类', '金额', '占总收支'];
  for (let c = 1; c <= 4; c += 1) {
    const cell = summary.getRow(r).getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { horizontal: 'center' };
  }
  r += 1;

  const totalFlow = meta.incomeCents + meta.expenseCents || 1;
  const catMap = new Map();
  for (const row of rows) {
    const key = `${row.type}|${row.category_name || '未分类'}`;
    catMap.set(key, (catMap.get(key) || 0) + row.amount_cents);
  }
  const catRows = [...catMap.entries()]
    .map(([key, cents]) => {
      const [type, name] = key.split('|');
      return { type, name, cents };
    })
    .sort((a, b) => b.cents - a.cents);
  for (const item of catRows) {
    const row = summary.getRow(r);
    row.values = [TYPE_LABEL[item.type], item.name, item.cents / 100, item.cents / totalFlow];
    row.getCell(3).numFmt = '"¥"#,##0.00';
    row.getCell(4).numFmt = '0.0%';
    if (item.type === 'income') row.getCell(1).font = { color: { argb: 'FF15803D' } };
    else row.getCell(1).font = { color: { argb: 'FFB91C1C' } };
    r += 1;
  }
  if (catRows.length === 0) {
    summary.getCell(`A${r}`).value = '所选范围内暂无数据';
    summary.getCell(`A${r}`).font = { italic: true, color: { argb: 'FF94A3B8' } };
  }

  /* ---- 明细 sheet ---- */
  const detail = workbook.addWorksheet('收支明细', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
  });
  detail.columns = [
    { header: '序号', key: 'no', width: 7 },
    { header: '收支日期', key: 'date', width: 13 },
    { header: '类型', key: 'type', width: 7 },
    { header: '分类', key: 'category', width: 12 },
    { header: '金额(元)', key: 'amount', width: 14 },
    { header: '收支原因', key: 'reason', width: 30 },
    { header: '对方', key: 'counterparty', width: 16 },
    { header: '备注', key: 'note', width: 26 },
    { header: '经办人', key: 'operator', width: 12 },
    { header: '凭证', key: 'vouchers', width: 8 },
    { header: '录入时间', key: 'createdAt', width: 18 },
  ];

  const headerRow = detail.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF0F766E' } },
      left: { style: 'thin', color: { argb: 'FF0F766E' } },
      bottom: { style: 'thin', color: { argb: 'FF0F766E' } },
      right: { style: 'thin', color: { argb: 'FF0F766E' } },
    };
  });

  const voucherCounts = new Map(
    db
      .prepare(
        `SELECT transaction_id, COUNT(*) AS c FROM attachments
         WHERE deleted_at IS NULL GROUP BY transaction_id`,
      )
      .all()
      .map((r) => [r.transaction_id, r.c]),
  );

  rows.forEach((row, index) => {
    const excelRow = detail.addRow({
      no: index + 1,
      date: row.occurred_at,
      type: TYPE_LABEL[row.type],
      category: row.category_name || '未分类',
      amount: row.amount_cents / 100,
      reason: row.reason,
      counterparty: row.counterparty || '',
      note: row.note || '',
      operator: row.operator_name || '',
      vouchers: voucherCounts.get(row.id) || 0,
      createdAt: fmtLocalTime(row.created_at),
    });
    excelRow.height = 22;
    excelRow.getCell('amount').numFmt = '"¥"#,##0.00';
    excelRow.getCell('amount').font = {
      bold: true,
      color: { argb: row.type === 'income' ? 'FF15803D' : 'FFB91C1C' },
    };
    excelRow.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
    });
    if (index % 2 === 1) {
      excelRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });

  if (rows.length > 0) {
    const totalRow = detail.addRow({
      no: '',
      date: '',
      type: '',
      category: '',
      amount: null,
      reason: `合计：收入 ${money(meta.incomeCents)}，支出 ${money(meta.expenseCents)}，结余 ${money(meta.incomeCents - meta.expenseCents)}`,
      counterparty: '',
      note: '',
      operator: '',
      vouchers: rows.reduce((sum, row) => sum + (voucherCounts.get(row.id) || 0), 0),
      createdAt: '',
    });
    totalRow.height = 26;
    totalRow.getCell('reason').font = { bold: true };
    totalRow.getCell('vouchers').font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FF0F766E' } } };
    });
    detail.autoFilter = { from: 'A1', to: 'K1' };
  }

  return { workbook, detail };
}

function money(cents) {
  return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rangeLabel(from, to) {
  if (from && to) return `${from} 至 ${to}`;
  if (from) return `${from} 起`;
  if (to) return `截至 ${to}`;
  return '全部时间';
}

function baseMeta(req, cleaned) {
  const className = getSetting('class_name', '科协');
  return {
    className,
    term: getSetting('term', ''),
    operator: `${req.user.display_name}（${ROLE_LABEL[req.user.role] || req.user.role}）`,
    rangeLabel: rangeLabel(cleaned.from, cleaned.to),
  };
}

function fileNameFor(className, from, to) {
  const suffix = from || to ? `${from || 'start'}_${to || 'end'}` : new Date().toISOString().slice(0, 10);
  return safeName(`科协账单_${className}_${suffix}`, '科协账单') + '.xlsx';
}

function contentDisposition(filename) {
  return `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

exportRouter.get(
  '/excel',
  requireAuth,
  requirePerm('finance'),
  ah(async (req, res) => {
    const { whereSql, params, cleaned } = exportWhere(req.query);
    const rows = loadTransactions(whereSql, params);
    const bal = balanceSummary();
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount_cents, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount_cents, 0);

    const meta = {
      ...baseMeta(req, cleaned),
      incomeCents: income,
      expenseCents: expense,
      balanceCents: bal.balanceCents,
    };
    const { workbook } = await buildWorkbook(rows, meta);
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = fileNameFor(meta.className, cleaned.from, cleaned.to);

    audit({
      actor: req.user,
      action: 'export.excel',
      entityType: 'export',
      detail: { range: meta.rangeLabel, count: rows.length },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(Buffer.from(buffer));
  }),
);

exportRouter.get(
  '/zip',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const { whereSql, params, cleaned } = exportWhere(req.query);
    const rows = loadTransactions(whereSql, params);
    const bal = balanceSummary();
    const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount_cents, 0);
    const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount_cents, 0);
    const meta = {
      ...baseMeta(req, cleaned),
      incomeCents: income,
      expenseCents: expense,
      balanceCents: bal.balanceCents,
    };

    const attachments = db
      .prepare(
        `SELECT a.*, t.occurred_at, t.reason FROM attachments a
         JOIN transactions t ON t.id = a.transaction_id
         WHERE a.deleted_at IS NULL AND ${whereSql}
         ORDER BY t.occurred_at, t.id, a.id`,
      )
      .all(...params);

    const zipName = safeName(
      `科协账单_${meta.className}_${cleaned.from || 'start'}_${cleaned.to || 'end'}`,
      '科协账单',
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(`${zipName}.zip`));

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => res.destroy(err));
    archive.pipe(res);

    buildWorkbook(rows, meta)
      .then(({ workbook }) => workbook.xlsx.writeBuffer())
      .then((buffer) => {
        archive.append(Buffer.from(buffer), { name: `${meta.className}_收支明细.xlsx` });
        for (const att of attachments) {
          const filePath = path.join(UPLOAD_DIR, att.stored_name);
          if (!fs.existsSync(filePath)) continue;
          const folder = `凭证/${att.occurred_at}_${safeName(att.reason, '记录')}`;
          archive.file(filePath, { name: `${folder}/${att.id}_${safeName(att.original_name, '凭证')}` });
        }
        archive.append(
          [
            `组织：${meta.className}`,
            `学期：${meta.term}`,
            `统计范围：${meta.rangeLabel}`,
            `导出时间：${fmtLocalTime(new Date().toISOString())}`,
            `导出人：${meta.operator}`,
            `记录条数：${rows.length}`,
            `凭证数量：${attachments.length}`,
            '说明：凭证文件按收支日期与原因归档，文件名前缀为凭证编号。',
          ].join('\r\n'),
          { name: '导出说明.txt' },
        );
        audit({
          actor: req.user,
          action: 'export.zip',
          entityType: 'export',
          detail: { range: meta.rangeLabel, count: rows.length, vouchers: attachments.length },
          ip: clientIp(req),
          userAgent: req.headers['user-agent'],
        });
        archive.finalize();
      })
      .catch((err) => res.destroy(err));
  }),
);

/* ------------------------------ 设备日志导出 ------------------------------ */

const EQUIPMENT_CATEGORY_LABEL = { printer: '3D 打印机', instrument: '仪器设备', other: '其他设备' };
const EQUIPMENT_STATUS_LABEL = { available: '可用', maintenance: '维护中', retired: '已停用' };
const BOOKING_STATUS_LABEL = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  completed: '已完成',
  cancelled: '已取消',
};
const PRINT_STATUS_LABEL = {
  queued: '排队中',
  printing: '打印中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
const MAINTENANCE_TYPE_LABEL = { routine: '保养', repair: '维修', inspection: '巡检' };
const BORROW_STATUS_LABEL = { borrowed: '借用中', returned: '已归还' };

function addLogSheet(workbook, name, tabColor, columns, rows) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: tabColor } },
  });
  sheet.columns = columns.map(([header, width]) => ({ header, width }));
  for (const row of rows) sheet.addRow(row);
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
}

const timeCell = (value) => (value ? fmtLocalTime(value) : '');

exportRouter.get(
  '/equipment-logs',
  requireAuth,
  requirePerm('equipment'),
  ah(async (req, res) => {
    const type = String(req.query.type || '').trim();
    const equipmentRows = type
      ? db.prepare('SELECT * FROM equipment WHERE type_name = ? ORDER BY code').all(type)
      : db.prepare('SELECT * FROM equipment ORDER BY code').all();
    const ids = equipmentRows.map((row) => row.id);
    const marks = ids.map(() => '?').join(',');

    const bookings = ids.length
      ? db
          .prepare(
            `SELECT b.*, e.code AS equipment_code, e.name AS equipment_name, e.type_name,
                    u.display_name AS user_name, r.display_name AS reviewer_name
             FROM equipment_bookings b
             JOIN equipment e ON e.id = b.equipment_id
             JOIN users u ON u.id = b.user_id
             LEFT JOIN users r ON r.id = b.reviewed_by
             WHERE b.equipment_id IN (${marks})
             ORDER BY b.start_at DESC`,
          )
          .all(...ids)
      : [];
    const printJobs = ids.length
      ? db
          .prepare(
            `SELECT j.*, e.code AS equipment_code, e.name AS equipment_name, e.type_name,
                    u.display_name AS user_name, c.name AS material_name, c.unit AS material_unit
             FROM print_jobs j
             JOIN equipment e ON e.id = j.equipment_id
             JOIN users u ON u.id = j.user_id
             LEFT JOIN consumables c ON c.id = j.material_id
             WHERE j.equipment_id IN (${marks})
             ORDER BY j.created_at DESC`,
          )
          .all(...ids)
      : [];
    const maintenance = ids.length
      ? db
          .prepare(
            `SELECT m.*, e.code AS equipment_code, e.name AS equipment_name, e.type_name,
                    u.display_name AS operator_name
             FROM maintenance_logs m
             JOIN equipment e ON e.id = m.equipment_id
             JOIN users u ON u.id = m.operator_id
             WHERE m.equipment_id IN (${marks})
             ORDER BY m.performed_at DESC`,
          )
          .all(...ids)
      : [];
    const borrows = ids.length
      ? db
          .prepare(
            `SELECT b.*, e.code AS equipment_code, e.name AS equipment_name, e.type_name,
                    u.display_name AS user_name, r.display_name AS reviewer_name
             FROM borrow_records b
             JOIN equipment e ON e.id = b.equipment_id
             JOIN users u ON u.id = b.user_id
             LEFT JOIN users r ON r.id = b.reviewer_id
             WHERE b.equipment_id IN (${marks})
             ORDER BY b.borrowed_at DESC`,
          )
          .all(...ids)
      : [];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '科协运营管理平台';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('导出说明', {
      views: [{ showGridLines: false }],
      properties: { tabColor: { argb: 'FF0F766E' } },
    });
    summary.columns = [{ width: 18 }, { width: 40 }];
    summary.mergeCells('A1:B1');
    const title = summary.getCell('A1');
    title.value = '设备日志';
    title.font = { size: 20, bold: true };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    summary.getRow(1).height = 34;
    summary.mergeCells('A2:B2');
    summary.getCell('A2').value = `导出时间 ${fmtLocalTime(new Date().toISOString())} · 导出人 ${req.user.display_name}`;
    summary.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } };
    summary.getCell('A2').alignment = { horizontal: 'center' };
    const summaryLines = [
      ['设备类型', type || '全部'],
      ['设备数量', `${equipmentRows.length} 台`],
      ['预约记录', `${bookings.length} 条`],
      ['打印任务', `${printJobs.length} 条`],
      ['维护记录', `${maintenance.length} 条`],
      ['借还记录', `${borrows.length} 条`],
    ];
    summaryLines.forEach((line, index) => {
      const row = summary.getRow(index + 4);
      row.getCell(1).value = line[0];
      row.getCell(1).font = { bold: true, color: { argb: 'FF475569' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      row.getCell(2).value = line[1];
      row.height = 22;
    });

    addLogSheet(
      workbook,
      '设备台账',
      'FF0F766E',
      [
        ['设备编号', 16],
        ['设备名称', 32],
        ['板块', 14],
        ['设备类型', 18],
        ['存放位置', 18],
        ['状态', 10],
        ['预约规则', 10],
        ['备注', 30],
      ],
      equipmentRows.map((row) => [
        row.code,
        row.name,
        EQUIPMENT_CATEGORY_LABEL[row.category] || row.category,
        row.type_name || '',
        row.location || '',
        EQUIPMENT_STATUS_LABEL[row.status] || row.status,
        row.requires_approval ? '需审核' : '免审核',
        row.note || '',
      ]),
    );

    addLogSheet(
      workbook,
      '预约记录',
      'FF0EA5E9',
      [
        ['设备编号', 16],
        ['设备名称', 30],
        ['设备类型', 18],
        ['申请人', 12],
        ['开始时间', 18],
        ['结束时间', 18],
        ['用途', 30],
        ['状态', 10],
        ['审核人', 12],
        ['审核时间', 18],
        ['驳回原因', 24],
      ],
      bookings.map((row) => [
        row.equipment_code,
        row.equipment_name,
        row.type_name || '',
        row.user_name,
        timeCell(row.start_at),
        timeCell(row.end_at),
        row.purpose || '',
        BOOKING_STATUS_LABEL[row.status] || row.status,
        row.reviewer_name || '',
        timeCell(row.reviewed_at),
        row.reject_reason || '',
      ]),
    );

    addLogSheet(
      workbook,
      '打印任务',
      'FFF59E0B',
      [
        ['设备编号', 16],
        ['设备名称', 30],
        ['设备类型', 18],
        ['申请人', 12],
        ['任务名称', 26],
        ['模型文件', 24],
        ['耗材', 18],
        ['用量', 12],
        ['预计时长(分钟)', 14],
        ['状态', 10],
        ['开始时间', 18],
        ['完成时间', 18],
        ['备注', 24],
      ],
      printJobs.map((row) => [
        row.equipment_code,
        row.equipment_name,
        row.type_name || '',
        row.user_name,
        row.title,
        row.file_name || '',
        row.material_name || '',
        row.weight_grams ? `${row.weight_grams}${row.material_unit || 'g'}` : '',
        row.est_minutes ?? '',
        PRINT_STATUS_LABEL[row.status] || row.status,
        timeCell(row.started_at),
        timeCell(row.finished_at),
        row.note || '',
      ]),
    );

    addLogSheet(
      workbook,
      '维护记录',
      'FF8B5CF6',
      [
        ['设备编号', 16],
        ['设备名称', 30],
        ['设备类型', 18],
        ['维护类型', 12],
        ['维护内容', 36],
        ['费用(元)', 12],
        ['执行人', 14],
        ['维护时间', 18],
        ['下次维护', 18],
        ['登记人', 12],
      ],
      maintenance.map((row) => [
        row.equipment_code,
        row.equipment_name,
        row.type_name || '',
        MAINTENANCE_TYPE_LABEL[row.type] || row.type,
        row.content,
        (Number(row.cost_cents || 0) / 100).toFixed(2),
        row.performed_by || row.operator_name,
        timeCell(row.performed_at),
        timeCell(row.next_due_at),
        row.operator_name,
      ]),
    );

    addLogSheet(
      workbook,
      '借还记录',
      'FF10B981',
      [
        ['设备编号', 16],
        ['设备名称', 30],
        ['设备类型', 18],
        ['借用人', 12],
        ['借出时间', 18],
        ['应还时间', 18],
        ['归还时间', 18],
        ['状态', 10],
        ['说明', 30],
        ['经办人', 12],
      ],
      borrows.map((row) => [
        row.equipment_code,
        row.equipment_name,
        row.type_name || '',
        row.user_name,
        timeCell(row.borrowed_at),
        timeCell(row.due_at),
        timeCell(row.returned_at),
        BORROW_STATUS_LABEL[row.status] || row.status,
        row.condition_note || '',
        row.reviewer_name || '',
      ]),
    );

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${safeName(`设备日志_${type || '全部'}_${new Date().toISOString().slice(0, 10)}`, '设备日志')}.xlsx`;

    audit({
      actor: req.user,
      action: 'export.equipment_logs',
      entityType: 'export',
      detail: {
        type: type || '全部',
        equipment: equipmentRows.length,
        records: bookings.length + printJobs.length + maintenance.length + borrows.length,
      },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(Buffer.from(buffer));
  }),
);
