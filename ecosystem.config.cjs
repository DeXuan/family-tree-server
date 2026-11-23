// PM2 配置：PGlite 是嵌入式单写者数据库，必须单实例运行。
// 若切换为 PostgreSQL，可将 instances 调整为 max 并启用 exec_mode: 'cluster'。
module.exports = {
  apps: [
    {
      name: 'family-tree',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
