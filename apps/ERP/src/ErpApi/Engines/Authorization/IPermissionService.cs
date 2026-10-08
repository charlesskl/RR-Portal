namespace ErpApi.Engines.Authorization;
public interface IPermissionService
{
    Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName);
    Task<bool> HasAsync(string userName, string menu, PermissionAction action);
}
