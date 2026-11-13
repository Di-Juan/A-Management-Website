import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 在所有测试文件加载前指向临时数据目录，避免污染 server/data
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'classfund-test-'));
process.env.JWT_SECRET = 'test-jwt-secret';
