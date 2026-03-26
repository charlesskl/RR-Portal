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

module.exports = router;
