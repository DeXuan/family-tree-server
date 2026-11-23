@echo off
REM 一键部署（Windows CMD）
cd /d %~dp0

if not exist .env (
  copy .env.example .env >nul
  echo [deploy] 已生成 .env —— 请先修改 JWT_SECRET 后再对外提供服务
)

echo [deploy] 安装生产依赖...
call npm ci --omit=dev
if errorlevel 1 goto :error

where pm2 >nul 2>nul
if %errorlevel%==0 (
  echo [deploy] 使用 PM2 启动（单实例，PGlite 单写者）
  call pm2 startOrReload ecosystem.config.cjs --update-env
  call pm2 save
  call pm2 status family-tree
) else (
  echo [deploy] 未检测到 PM2，前台启动（生产建议 npm i -g pm2）
  call npm start
)
goto :eof

:error
echo [deploy] 依赖安装失败，请检查网络或 npm 镜像配置
exit /b 1
