@echo off
chcp 65001
echo ==================================
echo 开始从GitHub拉取main分支最新代码
echo ==================================
git pull origin main
echo.
echo 同步完成！按任意键关闭窗口
pause