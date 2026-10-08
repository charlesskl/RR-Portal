-- 在线状态心跳:sysfileuser 加 最后心跳时间/最后活动时间。幂等。
-- 前端每 60s 打 POST /auth/heartbeat(带"10 分钟内有无操作"标记),退出登录调 /auth/logout 立即置离线。
-- 状态判定在 AccountService.ListAsync:最后心跳时间 为空或断 >3 分钟=离线;否则 最后活动时间 在 10 分钟内=在线,超出=忙线。
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[sysfileuser]') AND name=N'最后心跳时间')
BEGIN
    ALTER TABLE [sysfileuser] ADD [最后心跳时间] datetime NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'[sysfileuser]') AND name=N'最后活动时间')
BEGIN
    ALTER TABLE [sysfileuser] ADD [最后活动时间] datetime NULL;
END;
GO
