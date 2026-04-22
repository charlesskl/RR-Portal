const axios = require('axios');

const BASE_URL = 'https://api.kdocs.cn/api/v3';

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.KINGSOFT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

// Get list of sheets in the target file
async function getSheets() {
  const fileId = process.env.KINGSOFT_FILE_ID;
  if (!fileId) throw new Error('KINGSOFT_FILE_ID not configured in .env');
  const res = await axios.get(`${BASE_URL}/files/${fileId}/sheets`, {
    headers: getHeaders()
  });
  return res.data;
}

// Append rows to a sheet
// rows: array of arrays (each inner array = one row's cell values in order)
async function appendRows(sheetId, rows) {
  const fileId = process.env.KINGSOFT_FILE_ID;
  if (!fileId) throw new Error('KINGSOFT_FILE_ID not configured in .env');
  const res = await axios.post(
    `${BASE_URL}/files/${fileId}/sheets/${sheetId}/rows`,
    { rows },
    { headers: getHeaders() }
  );
  return res.data;
}

// Map order data object to row array based on column order
// columnOrder: array of field names matching the sheet's columns
function orderToRow(orderData, columnOrder) {
  return columnOrder.map(col => {
    const val = orderData[col];
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().split('T')[0];
    return String(val);
  });
}

module.exports = { getSheets, appendRows, orderToRow };
