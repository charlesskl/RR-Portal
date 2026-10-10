using System.Reflection;
using IndoShipping.Api.Controllers;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace IndoShipping.Api.Tests;

public class CustomerRoutesTests
{
    [Fact]
    public void Customer_names_are_query_parameters_not_route_segments()
    {
        var delete = typeof(CustomersController).GetMethod(nameof(CustomersController.DeleteByName))!;
        var restore = typeof(CustomersController).GetMethod(nameof(CustomersController.RestoreByName))!;
        Assert.Null(delete.GetCustomAttribute<HttpDeleteAttribute>()!.Template);
        Assert.Equal("restore", restore.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.NotNull(delete.GetParameters()[0].GetCustomAttribute<FromQueryAttribute>());
        Assert.NotNull(restore.GetParameters()[0].GetCustomAttribute<FromQueryAttribute>());
        Assert.False((bool)delete.GetParameters()[1].DefaultValue!);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Empty_names_are_rejected_before_accessing_database(string name)
    {
        var controller = new CustomersController(null!);
        Assert.IsType<BadRequestObjectResult>(await controller.DeleteByName(name));
        Assert.IsType<BadRequestObjectResult>(await controller.DeleteByName(name, true));
        Assert.IsType<BadRequestObjectResult>(await controller.RestoreByName(name));
    }
}
