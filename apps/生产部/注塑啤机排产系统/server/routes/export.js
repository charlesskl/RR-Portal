const express = require('express');
const router = express.Router();

router.get('/:scheduleId', async (req, res) => {
  try {
    const { exportScheduleExcel } = require('../services/excelExporter');
    const { buffer, filename } = await exportScheduleExcel(req.params.scheduleId);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('导出失败:', err);
    res.status(500).json({ message: '导出失败: ' + err.message });
  }
});

// 日报表导出（同日的夜班 + 白班合并到 1 个 sheet，格式跟样表一致）
router.get('/daily-report/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const workshop = req.query.workshop || 'B';
    const { buildDailyReport } = require('../services/dailyReportExporter');
    const wb = await buildDailyReport({ date, workshop });
    const buf = await wb.xlsx.writeBuffer();
    const filename = `${workshop}车间日报表_${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('日报表导出失败:', err);
    res.status(500).json({ message: '日报表导出失败: ' + err.message });
  }
});

module.exports = router;
