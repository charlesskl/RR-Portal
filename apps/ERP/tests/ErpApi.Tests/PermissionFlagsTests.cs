using ErpApi.Engines.Authorization;
using Xunit;

public class PermissionFlagsTests
{
    [Fact]
    public void Maps_nine_bits()
    {
        var p = new PermissionFlags { 打开=true, 单价=false, 金额=true, 审核=true };
        Assert.True(p.Has(PermissionAction.打开));
        Assert.False(p.Has(PermissionAction.单价)); // 看不到单价 => 前端隐藏价格列
        Assert.True(p.Has(PermissionAction.金额));
        Assert.True(p.Has(PermissionAction.审核));
        Assert.False(p.Has(PermissionAction.删除));
    }
}
