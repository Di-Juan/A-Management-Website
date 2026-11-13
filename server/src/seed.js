/**
 * 演示数据初始化：npm run seed:demo
 * 仅当数据库还没有设备记录时写入，重复执行不会产生重复数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { UPLOAD_DIR } from './config.js';
import { db, initData, nowIso, setSetting, tx } from './db.js';

const DEMO_PASSWORD = 'Kx@2026demo';
const DEMO_HASH = bcrypt.hashSync(DEMO_PASSWORD, 10);

const now = new Date();
const iso = (date) => date.toISOString();
/** 相对今天偏移若干天、指定钟点的时间 */
const at = (dayOffset, hour, minute = 0) => {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return iso(date);
};

/** 演示账号：已存在则跳过，保证重复执行时账号齐全 */
function ensureDemoUsers() {
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, status, must_change_password,
                        can_income, can_expense, perms, student_no, department, phone, joined_at,
                        created_at, created_by)
     VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const demoUsers = [
    ['finance01', '李思远', 'member', 1, 1, ['finance'], '2023010201', '财务组', '13800000001'],
    ['equip01', '王梓涵', 'member', 0, 0, ['equipment', 'inventory'], '2023010315', '技术部', '13800000002'],
    [
      'tech01',
      '技术员',
      'member',
      0,
      0,
      ['equipment', 'inventory', 'duty', 'api'],
      '2023010341',
      '技术部',
      '13800000006',
    ],
    ['access01', '陈可欣', 'member', 0, 0, ['access', 'duty'], '2023010422', '行政部', '13800000003'],
    ['media01', '赵一鸣', 'member', 0, 0, ['activity', 'doc'], '2023010533', '宣传部', '13800000004'],
  ];
  const userIds = {};
  tx(() => {
    for (const [username, name, role, canIncome, canExpense, perms, studentNo, dept, phone] of demoUsers) {
      const found = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (found) {
        userIds[username] = found.id;
        continue;
      }
      userIds[username] = Number(
        insertUser.run(
          username,
          DEMO_HASH,
          name,
          role,
          canIncome,
          canExpense,
          JSON.stringify(perms),
          studentNo,
          dept,
          phone,
          at(-120, 9),
          nowIso(),
        ).lastInsertRowid,
      );
    }
  });
  return userIds;
}

function main() {
  initData();

  const userIds = ensureDemoUsers();

  const existing = db.prepare('SELECT COUNT(*) AS c FROM equipment').get().c;
  if (existing > 0) {
    console.log('检测到已有设备数据，跳过演示数据写入（演示账号已补齐）。');
    return;
  }

  const settings = [
    ['class_name', '英才科协'],
    ['term', '2026 秋季学期'],
    ['org_name', '英才科协运营中心'],
  ];

  const docFiles = [];
  const writeDoc = (fileName, content) => {
    const storedName = `${Date.now()}-${fileName}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), content);
    docFiles.push({
      storedName,
      content,
      size: Buffer.byteLength(content),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
    return storedName;
  };
  const guideName = writeDoc(
    '3d-printer-guide.md',
    `# 3D 打印机操作规范\n\n1. 使用前在平台预约并等待审核通过。\n2. 打印完成 30 分钟内取件，清理热床。\n3. 耗材不足时联系技术部补货。\n`,
  );
  const planName = writeDoc(
    '2026-autumn-plan.md',
    `# 2026 秋季学期活动策划案（内部）\n\n- 嵌入式入门工作坊\n- 3D 打印创意大赛\n- 电子设计校赛选拔\n`,
  );

  tx(() => {
    for (const [key, value] of settings) setSetting(key, value);

    /* ---------- 设备台账 ---------- */
    const insertEquipment = db.prepare(
      `INSERT INTO equipment (code, name, category, type_name, location, status, requires_approval, note,
                              created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const equipment = {};
    for (const [code, name, category, typeName, location, status, requiresApproval, note] of [
      ['P-3D-01', '拓竹 X1 Carbon 3D 打印机', 'printer', 'FDM 3D 打印机', '创客空间 A 区', 'available', 1, '0.4mm 喷嘴，配 AMS'],
      ['P-3D-02', '创想三维 Ender-3 V3', 'printer', 'FDM 3D 打印机', '创客空间 A 区', 'available', 1, '适合小件快速验证'],
      ['I-OSC-01', 'RIGOL DS1102Z-E 示波器', 'instrument', '数字示波器', '电子实验室 B 区', 'available', 0, '100MHz 双通道'],
      ['I-SOL-01', '白光 T12 恒温焊台', 'instrument', '焊接工具', '电子实验室 B 区', 'available', 0, '含多种烙铁头'],
    ]) {
      equipment[code] = Number(
        insertEquipment.run(
          code,
          name,
          category,
          typeName,
          location,
          status,
          requiresApproval,
          note,
          nowIso(),
          nowIso(),
        ).lastInsertRowid,
      );
    }

    /* ---------- 耗材 ---------- */
    const insertConsumable = db.prepare(
      `INSERT INTO consumables (name, spec, unit, stock, warn_threshold, unit_price_cents, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const consumables = {};
    for (const [key, name, spec, unit, stock, warn, price, note] of [
      ['pla', 'PLA 白色耗材', '1.75mm / 1kg', 'g', 620, 200, 12, '通用打印'],
      ['petg', 'PETG 黑色耗材', '1.75mm / 1kg', 'g', 180, 200, 15, '库存偏低'],
      ['resin', '光敏树脂', '405nm / 1kg', 'ml', 900, 300, 20, '光固化打印机使用'],
    ]) {
      consumables[key] = Number(
        insertConsumable.run(name, spec, unit, stock, warn, price, note, nowIso(), nowIso()).lastInsertRowid,
      );
    }
    const insertConsumableLog = db.prepare(
      `INSERT INTO consumable_logs (consumable_id, delta, reason, ref_type, ref_id, note, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertConsumableLog.run(consumables.pla, 1000, 'restock', null, null, '学期初采购入库', userIds.equip01, at(-20, 10));
    insertConsumableLog.run(consumables.petg, 500, 'restock', null, null, '学期初采购入库', userIds.equip01, at(-20, 10));
    insertConsumableLog.run(consumables.resin, 1000, 'restock', null, null, '光固化打印配套采购', userIds.equip01, at(-20, 10));

    /* ---------- 设备预约 ---------- */
    const insertBooking = db.prepare(
      `INSERT INTO equipment_bookings (equipment_id, user_id, start_at, end_at, purpose, status,
                                       reviewed_by, reviewed_at, reject_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const approvedBooking = Number(
      insertBooking.run(
        equipment['P-3D-01'],
        userIds.equip01,
        at(1, 14),
        at(1, 16),
        '打印电子设计大赛外壳件',
        'approved',
        1,
        at(-1, 20),
        null,
        at(-1, 18),
        at(-1, 20),
      ).lastInsertRowid,
    );
    insertBooking.run(
      equipment['P-3D-02'],
      userIds.equip01,
      at(2, 9),
      at(2, 11),
      '打印社团招新小礼品样件',
      'pending',
      null,
      null,
      null,
      at(0, 21),
      at(0, 21),
    );
    insertBooking.run(
      equipment['I-OSC-01'],
      userIds.access01,
      at(-2, 19),
      at(-2, 21),
      '练习示波器测量 PWM 信号',
      'completed',
      null,
      null,
      null,
      at(-3, 15),
      at(-2, 21),
    );

    /* ---------- 打印任务 ---------- */
    const modelStored = `${Date.now()}-gripper-mount.3mf`;
    const modelContent = '3MF demo model - gripper mount';
    fs.writeFileSync(path.join(UPLOAD_DIR, modelStored), modelContent);

    const insertJob = db.prepare(
      `INSERT INTO print_jobs (equipment_id, user_id, booking_id, title, file_name, file_stored, file_size,
                               material_id, weight_grams, est_minutes, status, note, started_at, finished_at,
                               created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertJob.run(
      equipment['P-3D-01'],
      userIds.equip01,
      approvedBooking,
      '机械臂夹爪支架',
      'gripper-mount.3mf',
      modelStored,
      Buffer.byteLength(modelContent),
      consumables.pla,
      86,
      95,
      'done',
      '一次打印成功',
      at(-1, 14, 5),
      at(-1, 15, 40),
      at(-1, 13),
      at(-1, 15, 40),
    );
    insertJob.run(
      equipment['P-3D-02'],
      userIds.equip01,
      null,
      '招新徽章底板',
      'badge-base.stl',
      null,
      null,
      consumables.pla,
      45,
      70,
      'printing',
      '正在打印第二层',
      at(0, 9),
      null,
      at(0, 8, 40),
      at(0, 9),
    );
    const insertConsumableLog2 = db.prepare(
      `INSERT INTO consumable_logs (consumable_id, delta, reason, ref_type, ref_id, note, operator_id, created_at)
       VALUES (?, ?, 'print', 'equipment', ?, ?, ?, ?)`,
    );
    insertConsumableLog2.run(consumables.pla, -86, equipment['P-3D-01'], '打印机械臂夹爪支架', userIds.equip01, at(-1, 15, 40));

    /* ---------- 维护记录 ---------- */
    const insertMaintenance = db.prepare(
      `INSERT INTO maintenance_logs (equipment_id, type, content, cost_cents, performed_by, performed_at,
                                     next_due_at, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertMaintenance.run(
      equipment['P-3D-01'],
      'routine',
      '清洁热床、润滑导轨、校准首层',
      0,
      '王梓涵',
      at(-10, 16),
      at(80, 16),
      userIds.equip01,
      at(-10, 16),
    );
    insertMaintenance.run(
      equipment['P-3D-02'],
      'repair',
      '更换挤出机齿轮，排除堵料',
      6800,
      '外修：创想三维售后',
      at(-30, 11),
      null,
      userIds.equip01,
      at(-30, 11),
    );

    /* ---------- 设备借还 ---------- */
    const insertBorrow = db.prepare(
      `INSERT INTO borrow_records (equipment_id, user_id, borrowed_at, due_at, returned_at, status,
                                   condition_note, reviewer_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertBorrow.run(
      equipment['I-OSC-01'],
      userIds.equip01,
      at(-1, 10),
      at(3, 10),
      null,
      'borrowed',
      '外观完好，探头齐全',
      null,
      at(-1, 10),
      at(-1, 10),
    );
    insertBorrow.run(
      equipment['I-SOL-01'],
      userIds.access01,
      at(-6, 14),
      at(-3, 14),
      at(-4, 9),
      'returned',
      '归还时已更换新烙铁头',
      userIds.equip01,
      at(-6, 14),
      at(-4, 9),
    );

    /* ---------- 元器件库存 ---------- */
    const insertItem = db.prepare(
      `INSERT INTO inventory_items (name, spec, package, location, quantity, unit, warn_threshold, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const items = {};
    for (const [key, name, spec, pkg, location, quantity, unit, warn] of [
      ['res', '金属膜电阻包', '1/4W 1% 600 只装', '盒', '元件柜 A1', 12, '盒', 3],
      ['wire', '杜邦线', '公对母 20cm 40Pin', '排', '元件柜 A2', 26, '排', 5],
      ['uno', 'Arduino Uno R3 兼容板', 'CH340 芯片', '块', '元件柜 B1', 8, '块', 2],
      ['breadboard', '面包板', '830 孔', '块', '元件柜 B2', 15, '块', 4],
      ['led', 'LED 灯珠混装', '5mm 红绿蓝各 100', '包', '元件柜 A3', 2, '包', 3],
    ]) {
      items[key] = Number(
        insertItem.run(name, spec, pkg, location, quantity, unit, warn, null, nowIso(), nowIso()).lastInsertRowid,
      );
    }
    const insertInventoryLog = db.prepare(
      `INSERT INTO inventory_logs (item_id, delta, reason, ref, note, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertInventoryLog.run(items.res, 20, 'purchase', 'PO-2026-0912', '学期采购入库', userIds.equip01, at(-15, 10));
    insertInventoryLog.run(items.uno, 10, 'purchase', 'PO-2026-0912', '工作坊备料', userIds.equip01, at(-15, 10));
    insertInventoryLog.run(items.res, -8, 'issue', '工作坊', '嵌入式工作坊领用', userIds.equip01, at(-3, 14));
    insertInventoryLog.run(items.led, -5, 'issue', '招新展示', '灯带展板制作', userIds.media01, at(-2, 16));
    insertInventoryLog.run(items.uno, -2, 'issue', '工作坊', '课堂演示用板', userIds.equip01, at(-3, 14));

    /* ---------- 门禁 ---------- */
    const insertRequest = db.prepare(
      `INSERT INTO access_requests (user_id, purpose, location, start_at, end_at, status,
                                    reviewed_by, reviewed_at, reject_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertRequest.run(
      userIds.equip01,
      '晚上调试比赛作品',
      '创客空间 A 区',
      at(1, 19),
      at(1, 22),
      'approved',
      userIds.access01,
      at(0, 12),
      null,
      at(0, 9),
      at(0, 12),
    );
    insertRequest.run(
      userIds.media01,
      '拍摄社团宣传素材',
      '创客空间 A 区',
      at(2, 15),
      at(2, 17),
      'pending',
      null,
      null,
      null,
      at(0, 20),
      at(0, 20),
    );
    insertRequest.run(
      userIds.equip01,
      '凌晨取回遗落设备',
      '创客空间 A 区',
      at(-4, 2),
      at(-4, 3),
      'rejected',
      userIds.access01,
      at(-5, 10),
      '非开放时段，请联系值班同学',
      at(-5, 8),
      at(-5, 10),
    );
    const insertGrant = db.prepare(
      `INSERT INTO access_grants (user_id, scope, valid_from, valid_to, status, granted_by, granted_at, revoked_at, note)
       VALUES (?, ?, ?, ?, 'active', ?, ?, null, ?)`,
    );
    insertGrant.run(
      userIds.equip01,
      '创客空间 A 区',
      at(1, 19),
      at(1, 22),
      userIds.access01,
      at(0, 12),
      '夜间调试授权',
    );
    insertGrant.run(
      userIds.access01,
      '电子实验室 B 区',
      at(-30, 8),
      null,
      userIds.access01,
      at(-30, 8),
      '长期值班授权',
    );
    const insertAccessLog = db.prepare(
      `INSERT INTO access_logs (user_id, person_name, direction, location, occurred_at, source, operator_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
    );
    insertAccessLog.run(userIds.equip01, '王梓涵', 'in', '创客空间 A 区', at(0, 9, 2), userIds.access01, null, at(0, 9, 2));
    insertAccessLog.run(userIds.media01, '赵一鸣', 'in', '创客空间 A 区', at(0, 9, 20), userIds.access01, null, at(0, 9, 20));
    insertAccessLog.run(userIds.media01, '赵一鸣', 'out', '创客空间 A 区', at(0, 11, 35), userIds.access01, null, at(0, 11, 35));

    /* ---------- 活动 ---------- */
    const insertActivity = db.prepare(
      `INSERT INTO activities (title, description, location, start_at, end_at, signup_deadline, capacity,
                               fee_cents, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const workshopId = Number(
      insertActivity.run(
        'STM32 嵌入式入门工作坊',
        '从点亮 LED 到串口通信，面向零基础成员，自带电脑。',
        '电子实验室 B 区',
        at(5, 19),
        at(5, 21),
        at(4, 23, 59),
        30,
        0,
        'open',
        userIds.media01,
        at(-3, 10),
        at(-3, 10),
      ).lastInsertRowid,
    );
    insertActivity.run(
      '3D 打印创意大赛说明会',
      '介绍赛制、评分标准与设备使用规范。',
      '创客空间 A 区',
      at(-7, 19),
      at(-7, 20),
      at(-8, 20),
      60,
      0,
      'finished',
      userIds.media01,
      at(-14, 9),
      at(-7, 20),
    );
    const insertSignup = db.prepare(
      `INSERT INTO activity_signups (activity_id, user_id, status, note, checked_in_at, created_at, updated_at)
       VALUES (?, ?, 'confirmed', ?, ?, ?, ?)`,
    );
    insertSignup.run(workshopId, userIds.equip01, '自带笔记本', null, at(-2, 9), at(-2, 9));
    insertSignup.run(workshopId, userIds.access01, null, null, at(-2, 10), at(-2, 10));
    insertSignup.run(workshopId, userIds.finance01, '负责签到', null, at(-1, 8), at(-1, 8));

    /* ---------- 值班 ---------- */
    const insertShift = db.prepare(
      `INSERT INTO duty_shifts (date, start_time, end_time, location, capacity, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const todayShift = Number(
      insertShift.run(todayStr, '18:00', '20:00', '创客空间 A 区', 2, '日常值守，处理预约与借还', userIds.access01, nowIso())
        .lastInsertRowid,
    );
    const tomorrowShift = Number(
      insertShift.run(tomorrowStr, '19:00', '21:00', '电子实验室 B 区', 1, '工作坊设备准备', userIds.access01, nowIso())
        .lastInsertRowid,
    );
    const insertDuty = db.prepare(
      `INSERT INTO duty_assignments (shift_id, user_id, status, note, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    insertDuty.run(todayShift, userIds.access01, 'assigned', '主值班', nowIso());
    insertDuty.run(todayShift, userIds.equip01, 'assigned', '协助设备借还', nowIso());
    insertDuty.run(tomorrowShift, userIds.equip01, 'assigned', null, nowIso());

    /* ---------- 资料归档 ---------- */
    const insertDocument = db.prepare(
      `INSERT INTO documents (title, category, description, tags, original_name, stored_name, mime, size, sha256,
                              visibility, uploader_id, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
    );
    insertDocument.run(
      '3D 打印机操作规范',
      '设备手册',
      '预约、上机、取件与日常维护的完整流程说明。',
      JSON.stringify(['3D 打印', '操作规范']),
      '3d-printer-guide.md',
      guideName,
      'text/markdown',
      docFiles[0].size,
      docFiles[0].sha256,
      'all',
      userIds.media01,
      at(-12, 10),
    );
    insertDocument.run(
      '2026 秋季学期活动策划案',
      '活动策划',
      '内部策划文档，仅管理员可见。',
      JSON.stringify(['活动', '策划']),
      '2026-autumn-plan.md',
      planName,
      'text/markdown',
      docFiles[1].size,
      docFiles[1].sha256,
      'admin',
      userIds.media01,
      at(-9, 15),
    );

    /* ---------- 经费台账 ---------- */
    const categoryId = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name)?.id ?? null;
    const insertTx = db.prepare(
      `INSERT INTO transactions (type, amount_cents, category_id, reason, counterparty, note, occurred_at,
                                 operator_id, version, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, null)`,
    );
    const ledger = [
      ['income', 120000, '赞助', '学院创新基金支持', '学院团委', '2026 秋季科协活动经费', at(-40, 10)],
      ['income', 36000, '活动收入', '招新报名费', '新成员', '36 人 × 10 元', at(-25, 16)],
      ['expense', 24800, '学习用品', '采购 PLA / PETG 耗材', '耗材商城', '含运费 80 元', at(-20, 10)],
      ['expense', 6800, '其他支出', '3D 打印机挤出机维修', '创想三维售后', '更换齿轮组件', at(-30, 11)],
      ['expense', 15600, '活动支出', '嵌入式工作坊物料', '电子元件商城', '开发板与杜邦线', at(-15, 10)],
      ['expense', 3200, '活动支出', '招新展板制作', '校门口文印店', '含喷绘与支架', at(-2, 16)],
    ];
    for (const [type, amount, category, reason, counterparty, note, occurredAt] of ledger) {
      insertTx.run(
        type,
        amount,
        categoryId(category),
        reason,
        counterparty,
        note,
        occurredAt,
        userIds.finance01,
        occurredAt,
        occurredAt,
      );
    }
  });

  console.log('演示数据写入完成。');
  console.log(`演示账号：finance01 / equip01 / tech01 / access01 / media01，统一密码 ${DEMO_PASSWORD}`);
  console.log('其中 tech01 已开启「API 调用」权限，可在「API 管理」中签发密钥。');
  console.log('管理员账号：admin（首次登录需修改密码）。');
}

main();
