import ExcelJS from 'exceljs';

/**
 * 将成员数组导出为 Excel 工作簿。
 * @param {Array} persons  成员行数组
 * @param {Array} [extraSheets] 可选附加 sheet，如 [{name, rows}]
 * @returns {Promise<Buffer>}
 */
export async function personsToExcel(persons, extraSheets = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'family-tree-server';
  wb.created = new Date();

  const ws = wb.addWorksheet('成员');
  ws.columns = [
    { header: '姓名', key: 'full_name', width: 24 },
    { header: '字辈', key: 'generation_name', width: 12 },
    { header: '世代', key: 'generation_no', width: 8 },
    { header: '支系', key: 'branch', width: 10 },
    { header: '性别', key: 'gender', width: 8 },
    { header: '出生日期', key: 'birth_date', width: 14 },
    { header: '出生精度', key: 'birth_precision', width: 10 },
    { header: '出生地', key: 'birth_place', width: 20 },
    { header: '去世日期', key: 'death_date', width: 14 },
    { header: '去世精度', key: 'death_precision', width: 10 },
    { header: '安葬地', key: 'burial_place', width: 20 },
    { header: '职业', key: 'occupation', width: 20 },
    { header: '简介', key: 'bio', width: 40 },
    { header: '自定义字段', key: 'extra', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const p of persons) {
    ws.addRow({
      full_name: `${p.family_name || ''}${p.given_name || ''}`,
      generation_name: p.generation_name,
      generation_no: p.generation_no,
      branch: p.branch,
      gender: p.gender,
      birth_date: p.birth_date,
      birth_precision: p.birth_precision,
      birth_place: p.birth_place,
      death_date: p.death_date,
      death_precision: p.death_precision,
      burial_place: p.burial_place,
      occupation: p.occupation,
      bio: p.bio,
      extra: p.extra ? JSON.stringify(p.extra) : '',
    });
  }

  for (const s of extraSheets) {
    const sheet = wb.addWorksheet(s.name);
    sheet.addRows(s.rows);
  }

  return wb.xlsx.writeBuffer();
}

/**
 * 从 Excel 工作簿解析成员行。
 * @param {Buffer} buffer
 * @returns {Promise<Array<{full_name, generation_name, generation_no, branch, gender, birth_date, birth_precision, birth_place, death_date, death_precision, death_place, burial_place, occupation, bio, extra}>>}
 */
export async function excelToPersons(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('成员') || wb.worksheets[0];
  if (!ws) throw new Error('Excel 中没有工作表');

  // 解析表头 → 列号；上传的模板由用户维护，不能依赖列顺序
  const col = new Map();
  ws.getRow(1).eachCell((cell, colNumber) => {
    const label = String(cell.value ?? '').trim();
    if (label) col.set(label, colNumber);
  });
  if (!col.size) throw new Error('Excel 表头为空，请使用导出模板填写');

  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 表头
    const v = (key) => {
      const c = col.get(key);
      return c ? row.getCell(c).value : null;
    };
    const full = v('姓名');
    if (!full) return;
    // 姓名拆姓/名：默认首字为姓，其余为名（中文两字名拆法）
    const family_name = String(full).trim().slice(0, 1);
    const given_name = String(full).trim().slice(1);
    let extra = {};
    const extraRaw = v('自定义字段');
    if (extraRaw) {
      try { extra = JSON.parse(extraRaw); } catch { /* 忽略非法 JSON */ }
    }
    const genderRaw = String(v('性别') || '').trim();
    const genderMap = { '男': 'male', '女': 'female', M: 'male', F: 'female', male: 'male', female: 'female' };
    const genRaw = v('世代');
    rows.push({
      full_name: String(full).trim(),
      family_name,
      given_name,
      generation_name: v('字辈') || '',
      generation_no: genRaw !== null && genRaw !== '' && !isNaN(Number(genRaw)) ? Number(genRaw) : null,
      branch: v('支系') || '',
      gender: genderMap[genderRaw] || 'unknown',
      birth_date: v('出生日期') ? toISO(v('出生日期')) : null,
      birth_precision: v('出生精度') || 'unknown',
      birth_place: v('出生地') || '',
      death_date: v('去世日期') ? toISO(v('去世日期')) : null,
      death_precision: v('去世精度') || 'unknown',
      death_place: v('去世地') || v('安葬地') || '',
      burial_place: v('安葬地') || '',
      occupation: v('职业') || '',
      bio: v('简介') || '',
      extra,
    });
  });
  return rows;
}

function toISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel 序列号 → 日期
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}
