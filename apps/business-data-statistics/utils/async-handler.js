// 异步路由包装器：自动捕获异常并返回统一的 500 错误响应
// 适用于不需要特殊错误处理的路由，有特殊 catch 逻辑的路由（如唯一约束冲突）请继续使用手动 try/catch
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err =>
    res.status(500).json({ success: false, message: err.message })
  );

module.exports = asyncHandler;
