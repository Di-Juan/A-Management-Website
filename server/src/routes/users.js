import express from 'express';
import { db, audit, nowIso, tx } from '../db.js';
import { PERM_KEYS, hashPassword, requireAuth, requirePerm, requireRole } from '../auth.js';
import { HttpError, ah, clientIp, publicUser, text } from '../helpers.js';

export const userRouter = express.Router();

const ROLES = ['admin', 'member'];
const PASSWORD_RULE = /^(?=.*[a-zA-Z])(?=.*\d).{8,64}$/;

/** 角色简化为管理员/成员；旧接口传入 finance 时按成员处理并自动补上经费台账权限 */
function resolveRole(raw, fallback = 'member') {
  if (raw === undefined || raw === null) return fallback;
  if (raw === 'finance') return 'member';
  return ROLES.includes(raw) ? raw : fallback;
}

function withLegacyFinancePerm(rawRole, perms) {
  const list = [...perms];
  if (rawRole === 'finance' && !list.includes('finance')) list.push('finance');
  return list;
}

function readPerms(body, role, fallback = []) {
  if (role === 'admin') return PERM_KEYS;
  if (body?.perms === undefined) return fallback;
  const list = Array.isArray(body.perms) ? body.perms : String(body.perms).split(',');
  return PERM_KEYS.filter((key) => list.includes(key));
}

function readProfile(body = {}, fallback = {}) {
  return {
    studentNo: text(body.studentNo ?? fallback.studentNo, { field: '学号', max: 30 }) || null,
    department: text(body.department ?? fallback.department, { field: '部门', max: 40 }) || null,
    phone: text(body.phone ?? fallback.phone, { field: '联系方式', max: 40 }) || null,
    joinedAt: text(body.joinedAt ?? fallback.joinedAt, { field: '加入时间', max: 40 }) || null,
  };
}

/** 收入/支出权限仅对拥有「经费台账」权限的成员生效；管理员两项全开 */
function readPermissions(body, role, perms, fallback = { canIncome: true, canExpense: false }) {
  if (role === 'admin') return { canIncome: true, canExpense: true };
  if (!perms.includes('finance')) return { canIncome: false, canExpense: false };
  const canIncome = body?.canIncome === undefined ? !!fallback.canIncome : !!body.canIncome;
  const canExpense = body?.canExpense === undefined ? !!fallback.canExpense : !!body.canExpense;
  if (!canIncome && !canExpense) {
    throw new HttpError(400, '开启经费台账权限时，至少需要开启收入或支出其中一项');
  }
  return { canIncome, canExpense };
}

function activeAdminCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get().c;
}

userRouter.get(
  '/options',
  requireAuth,
  ah((req, res) => {
    const items = db
      .prepare(
        "SELECT id, display_name, department, student_no FROM users WHERE status = 'active' ORDER BY display_name",
      )
      .all()
      .map((row) => ({
        id: row.id,
        displayName: row.display_name,
        department: row.department || '',
        studentNo: row.student_no || '',
      }));
    res.json({ items });
  }),
);

userRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
    const counts = db
      .prepare(
        `SELECT operator_id, COUNT(*) AS c FROM transactions
         WHERE deleted_at IS NULL GROUP BY operator_id`,
      )
      .all();
    const countMap = new Map(counts.map((r) => [r.operator_id, r.c]));
    res.json({
      items: rows.map((u) => ({ ...publicUser(u), transactionCount: countMap.get(u.id) || 0 })),
    });
  }),
);

userRouter.get(
  '/operators',
  requireAuth,
  requirePerm('finance'),
  ah((req, res) => {
    const rows = db.prepare("SELECT id, display_name FROM users WHERE status = 'active' ORDER BY id").all();
    res.json({ items: rows.map((r) => ({ id: r.id, displayName: r.display_name })) });
  }),
);

userRouter.post(
  '/',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const username = text(req.body?.username, { field: '登录账号', required: true, max: 40 });
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      throw new HttpError(400, '登录账号需为 3-40 位字母、数字、下划线、点或短横线');
    }
    const displayName = text(req.body?.displayName, { field: '姓名', required: true, max: 30 });
    const role = resolveRole(req.body?.role);
    const perms = withLegacyFinancePerm(req.body?.role, readPerms(req.body, role));
    const permissions = readPermissions(req.body, role, perms);
    const profile = readProfile(req.body);
    const password = String(req.body?.password ?? '');
    if (!PASSWORD_RULE.test(password)) {
      throw new HttpError(400, '初始密码需 8-64 位，且同时包含字母和数字');
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, '该登录账号已存在');
    }

    const id = tx(() => {
      const result = db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, status, must_change_password,
                              can_income, can_expense, perms, student_no, department, phone, joined_at,
                              created_at, created_by)
           VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          username,
          hashPassword(password),
          displayName,
          role,
          permissions.canIncome ? 1 : 0,
          permissions.canExpense ? 1 : 0,
          JSON.stringify(perms),
          profile.studentNo,
          profile.department,
          profile.phone,
          profile.joinedAt,
          nowIso(),
          req.user.id,
        );
      const newId = Number(result.lastInsertRowid);
      audit({
        actor: req.user,
        action: 'user.create',
        entityType: 'user',
        entityId: newId,
        detail: { username, displayName, role, ...permissions, perms },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return newId;
    });

    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  }),
);

userRouter.post(
  '/batch',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const startRaw = text(req.body?.startUsername, { field: '起始账号', required: true, max: 40 });
    if (!/^\d{2,40}$/.test(startRaw)) {
      throw new HttpError(400, '起始账号需为 2-40 位数字');
    }
    const count = Number.parseInt(req.body?.count, 10);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new HttpError(400, '批量数量需为 1-100 之间的整数');
    }
    const startNumber = Number(startRaw);
    const lastNumber = startNumber + count - 1;
    if (!Number.isSafeInteger(startNumber) || !Number.isSafeInteger(lastNumber)) {
      throw new HttpError(400, '起始账号数值过大');
    }
    const width = startRaw.length;
    const usernames = [];
    for (let i = 0; i < count; i += 1) {
      const name = String(startNumber + i);
      if (name.length > 40) throw new HttpError(400, '生成的账号长度超出限制');
      usernames.push(name.padStart(width, '0'));
    }

    const role = resolveRole(req.body?.role);
    const perms = withLegacyFinancePerm(req.body?.role, readPerms(req.body, role));
    const permissions = readPermissions(req.body, role, perms);
    const profile = readProfile(req.body);
    const password = String(req.body?.password ?? '');
    if (!PASSWORD_RULE.test(password)) {
      throw new HttpError(400, '初始密码需 8-64 位，且同时包含字母和数字');
    }
    const namePrefix = text(req.body?.namePrefix, { field: '姓名前缀', max: 20 }) || '成员';
    const displayNames = usernames.map((name) => `${namePrefix}${name}`.slice(0, 30));

    const placeholders = usernames.map(() => '?').join(',');
    const conflicts = db
      .prepare(`SELECT username FROM users WHERE username IN (${placeholders})`)
      .all(...usernames);
    if (conflicts.length > 0) {
      const sample = conflicts
        .slice(0, 5)
        .map((row) => row.username)
        .join('、');
      throw new HttpError(
        409,
        `以下账号已存在：${sample}${conflicts.length > 5 ? ' 等' : ''}，请调整起始账号或数量`,
      );
    }

    const passwordHash = hashPassword(password);
    const now = nowIso();
    tx(() => {
      const insert = db.prepare(
        `INSERT INTO users (username, password_hash, display_name, role, status, must_change_password,
                            can_income, can_expense, perms, student_no, department, phone, joined_at,
                            created_at, created_by)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      usernames.forEach((name, index) => {
        insert.run(
          name,
          passwordHash,
          displayNames[index],
          role,
          permissions.canIncome ? 1 : 0,
          permissions.canExpense ? 1 : 0,
          JSON.stringify(perms),
          profile.studentNo,
          profile.department,
          profile.phone,
          profile.joinedAt,
          now,
          req.user.id,
        );
      });
      audit({
        actor: req.user,
        action: 'user.batch_create',
        entityType: 'user',
        detail: {
          count,
          startUsername: usernames[0],
          endUsername: usernames[usernames.length - 1],
          usernames: count <= 50 ? usernames : undefined,
          role,
          ...permissions,
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });

    res.status(201).json({
      count,
      usernames,
      displayNames,
      startUsername: usernames[0],
      endUsername: usernames[usernames.length - 1],
    });
  }),
);

userRouter.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, '账号不存在');

    const displayName =
      req.body?.displayName === undefined
        ? target.display_name
        : text(req.body.displayName, { field: '姓名', required: true, max: 30 });
    const role = req.body?.role === undefined ? target.role : resolveRole(req.body.role, null);
    if (!role) throw new HttpError(400, '角色不正确');
    const status = req.body?.status === undefined ? target.status : req.body.status;
    if (!['active', 'disabled'].includes(status)) throw new HttpError(400, '状态不正确');
    const permissionFallback = { canIncome: !!target.can_income, canExpense: !!target.can_expense };
    const fallbackPerms = (() => {
      try {
        return JSON.parse(target.perms || '[]');
      } catch {
        return [];
      }
    })();
    const perms = withLegacyFinancePerm(req.body?.role, readPerms(req.body, role, fallbackPerms));
    const permissions = readPermissions(req.body, role, perms, permissionFallback);
    const profile = readProfile(req.body, {
      studentNo: target.student_no,
      department: target.department,
      phone: target.phone,
      joinedAt: target.joined_at,
    });

    if (id === req.user.id && (role !== 'admin' || status !== 'active')) {
      throw new HttpError(400, '不能降低或停用自己的账号');
    }
    const losingAdmin =
      target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active');
    if (losingAdmin && activeAdminCount() <= 1) {
      throw new HttpError(400, '至少需要保留一个启用中的管理员');
    }

    tx(() => {
      db.prepare(
        `UPDATE users SET display_name = ?, role = ?, status = ?, can_income = ?, can_expense = ?,
                          perms = ?, student_no = ?, department = ?, phone = ?, joined_at = ?
         WHERE id = ?`,
      ).run(
        displayName,
        role,
        status,
        permissions.canIncome ? 1 : 0,
        permissions.canExpense ? 1 : 0,
        JSON.stringify(perms),
        profile.studentNo,
        profile.department,
        profile.phone,
        profile.joinedAt,
        id,
      );
      audit({
        actor: req.user,
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        detail: {
          before: {
            displayName: target.display_name,
            role: target.role,
            status: target.status,
            canIncome: !!target.can_income,
            canExpense: !!target.can_expense,
            perms: fallbackPerms,
          },
          after: { displayName, role, status, ...permissions, perms, ...profile },
        },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });

    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  }),
);

userRouter.post(
  '/:id/reset-password',
  requireAuth,
  requireRole('admin'),
  ah((req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, '账号不存在');
    const password = String(req.body?.password ?? '');
    if (!PASSWORD_RULE.test(password)) {
      throw new HttpError(400, '新密码需 8-64 位，且同时包含字母和数字');
    }

    tx(() => {
      db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?',
      ).run(hashPassword(password), id);
      audit({
        actor: req.user,
        action: 'user.reset_password',
        entityType: 'user',
        entityId: id,
        detail: { username: target.username },
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
    });

    res.json({ ok: true });
  }),
);
