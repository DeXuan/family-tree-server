/**
 * 演示家族数据（纯数据，无数据库依赖，可被 seed 与迁移脚本共用）。
 * 设定为“五世同堂”：五代人全部在世，年龄链约 1926 → 1949 → 1972 → 1997 → 2021。
 */

const P = (family_name, given_name, opts) => ({
  family_name, given_name,
  ...opts,
});

export const PEOPLE = [
  // ---- 一世：1926 年生，五世同堂的最高辈 ----
  P('王', '守仁', { courtesy_name: '静山', generation_name: '守', generation_no: 1, branch: '长房', gender: 'male',
    birth_date: '1926-03-12', birth_precision: 'exact', birth_place: '河北保定',
    is_deceased: false, occupation: '乡村教师', education: '私塾',
    bio: '执教四十余年，主持续修族谱，现居保定老宅。' }),
  P('李', '淑贞', { generation_no: 1, branch: '长房', gender: 'female',
    birth_date: '1928-06-20', birth_precision: 'exact', birth_place: '河北正定',
    is_deceased: false, bio: '守仁之妻，善织绣，耳聪目明。' }),

  // ---- 二世：1949–1956 ----
  P('王', '德昌', { courtesy_name: '伯元', generation_name: '德', generation_no: 2, branch: '长房', gender: 'male',
    birth_date: '1949-01-08', birth_precision: 'exact', birth_place: '河北保定',
    is_deceased: false, occupation: '铁路工程师', education: '北洋大学',
    bio: '1972 年入职铁路局，参与线路勘测，现退休居北京。' }),
  P('张', '桂芳', { generation_no: 2, branch: '长房', gender: 'female',
    birth_date: '1951-04-02', birth_precision: 'exact', is_deceased: false, bio: '德昌之妻。' }),
  P('王', '德明', { courtesy_name: '仲光', generation_name: '德', generation_no: 2, branch: '二房', gender: 'male',
    birth_date: '1952-10-17', birth_precision: 'exact', birth_place: '河北保定',
    is_deceased: false, occupation: '中医', education: '师承',
    bio: '1978 年迁居石家庄行医，至今仍出诊。' }),
  P('陈', '玉兰', { generation_no: 2, branch: '二房', gender: 'female',
    birth_date: '1954-12-01', birth_precision: 'exact', is_deceased: false }),
  P('王', '秀英', { generation_name: '德', generation_no: 2, branch: '长房', gender: 'female',
    birth_date: '1956-02-28', birth_precision: 'exact', is_deceased: false, bio: '守仁之女。' }),

  // ---- 三世：1972–1980 ----
  P('王', '建国', { generation_name: '建', generation_no: 3, branch: '长房', gender: 'male',
    birth_date: '1972-07-04', birth_precision: 'exact', birth_place: '北京',
    is_deceased: false, occupation: '中学教师', education: '北京师范大学' }),
  P('刘', '芳', { generation_no: 3, branch: '长房', gender: 'female',
    birth_date: '1974-09-12', birth_precision: 'exact', is_deceased: false }),
  P('王', '建华', { generation_name: '建', generation_no: 3, branch: '长房', gender: 'male',
    birth_date: '1976-11-23', birth_precision: 'exact', is_deceased: false, occupation: '会计' }),
  P('王', '志强', { generation_name: '建', generation_no: 3, branch: '二房', gender: 'male',
    birth_date: '1977-03-15', birth_precision: 'exact', birth_place: '石家庄',
    is_deceased: false, occupation: '医生', education: '河北医学院' }),
  P('赵', '敏', { generation_no: 3, branch: '二房', gender: 'female',
    birth_date: '1979-06-30', birth_precision: 'exact', is_deceased: false }),
  P('王', '志刚', { generation_name: '建', generation_no: 3, branch: '二房', gender: 'male',
    birth_date: '1980-12-08', birth_precision: 'exact', is_deceased: false, occupation: '司机' }),

  // ---- 四世：1997–2004 ----
  P('王', '小明', { generation_name: '明', generation_no: 4, branch: '长房', gender: 'male',
    birth_date: '1997-05-20', birth_precision: 'exact', birth_place: '北京',
    is_deceased: false, occupation: '软件工程师', education: '清华大学' }),
  P('周', '静', { generation_no: 4, branch: '长房', gender: 'female',
    birth_date: '1999-08-14', birth_precision: 'exact', is_deceased: false }),
  P('王', '小红', { generation_name: '明', generation_no: 4, branch: '长房', gender: 'female',
    birth_date: '2000-10-01', birth_precision: 'exact', is_deceased: false, occupation: '护士' }),
  P('王', '磊', { generation_name: '明', generation_no: 4, branch: '二房', gender: 'male',
    birth_date: '2002-01-19', birth_precision: 'exact', is_deceased: false, occupation: '建筑师' }),
  P('王', '婷', { generation_name: '明', generation_no: 4, branch: '二房', gender: 'female',
    birth_date: '2004-04-27', birth_precision: 'exact', is_deceased: false, occupation: '设计师' }),

  // ---- 五世：2021/2023，五代同堂的最小辈 ----
  P('王', '一诺', { generation_name: '一', generation_no: 5, branch: '长房', gender: 'male',
    birth_date: '2021-11-11', birth_precision: 'exact', is_deceased: false, occupation: '幼儿园' }),
  P('王', '一凡', { generation_name: '一', generation_no: 5, branch: '长房', gender: 'female',
    birth_date: '2023-02-28', birth_precision: 'exact', is_deceased: false, occupation: '幼儿' }),
];

// 亲子关系（父, 母, 子女）——母可为 null
export const FAMILIES = [
  ['王守仁', '李淑贞', ['王德昌', '王德明', '王秀英']],
  ['王德昌', '张桂芳', ['王建国', '王建华']],
  ['王德明', '陈玉兰', ['王志强', '王志刚']],
  ['王建国', '刘芳', ['王小明', '王小红']],
  ['王志强', '赵敏', ['王磊', '王婷']],
  ['王小明', '周静', ['王一诺', '王一凡']],
];

