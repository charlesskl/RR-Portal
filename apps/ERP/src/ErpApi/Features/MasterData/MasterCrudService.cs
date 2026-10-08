using System.Linq.Expressions;
using ErpApi.Data;
using ErpApi.Data.Entities;
using Microsoft.EntityFrameworkCore;
namespace ErpApi.Features.MasterData;

public sealed class MasterCrudService<T>(ErpDbContext db) where T : MasterEntity
{
    public async Task<PagedResult<T>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var q = db.Set<T>().AsQueryable();
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(KeywordPredicate(keyword.Trim()));
        var total = await q.CountAsync();
        var items = await q.OrderBy(e => e.ID).Skip((page - 1) * size).Take(size).ToListAsync();
        return new PagedResult<T>(items, total);
    }

    public Task<T?> GetAsync(long id) => db.Set<T>().FirstOrDefaultAsync(e => e.ID == id);

    public async Task<T> CreateAsync(T entity)
    {
        entity.ID = 0;
        db.Set<T>().Add(entity);
        await db.SaveChangesAsync();
        return entity;
    }

    public async Task<bool> UpdateAsync(long id, T entity)
    {
        // 加载被跟踪实体后用 SetValues 覆盖映射字段:避免"附加第二个同主键实例"的跟踪冲突，
        // 且只动模型内的列(未映射列不受影响)。
        var existing = await db.Set<T>().FirstOrDefaultAsync(e => e.ID == id);
        if (existing is null) return false;
        entity.ID = id;
        db.Entry(existing).CurrentValues.SetValues(entity);
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteAsync(long id)
    {
        var e = await db.Set<T>().FirstOrDefaultAsync(x => x.ID == id);
        if (e is null) return false;
        db.Set<T>().Remove(e);
        await db.SaveChangesAsync();
        return true;
    }

    private static Expression<Func<T, bool>> KeywordPredicate(string kw)
    {
        var p = Expression.Parameter(typeof(T), "e");
        var like = typeof(DbFunctionsExtensions).GetMethod(
            nameof(DbFunctionsExtensions.Like),
            new[] { typeof(DbFunctions), typeof(string), typeof(string) })!;
        var ef = Expression.Constant(EF.Functions);
        var pattern = Expression.Constant($"%{kw}%");
        Expression? body = null;
        foreach (var prop in typeof(T).GetProperties()
                     .Where(x => x.PropertyType == typeof(string)))
        {
            var call = Expression.Call(like, ef, Expression.Property(p, prop), pattern);
            body = body is null ? call : Expression.OrElse(body, call);
        }
        body ??= Expression.Constant(false);
        return Expression.Lambda<Func<T, bool>>(body, p);
    }
}
