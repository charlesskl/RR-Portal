$(function () {
  $('.dt').DataTable({
    language: {
      processing: "处理中...",
      lengthMenu: "显示 _MENU_ 条",
      zeroRecords: "没有匹配结果",
      info: "显示第 _START_ 至 _END_ 条,共 _TOTAL_ 条",
      infoEmpty: "显示第 0 至 0 条,共 0 条",
      infoFiltered: "(由 _MAX_ 条过滤)",
      search: "搜索:",
      emptyTable: "暂无数据",
      loadingRecords: "载入中...",
      paginate: { first: "首页", previous: "上一页", next: "下一页", last: "末页" },
      aria: { sortAscending: ": 升序", sortDescending: ": 降序" }
    }
  });
});
