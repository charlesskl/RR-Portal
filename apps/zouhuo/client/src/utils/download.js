import axios from 'axios';
import { message } from 'antd';

export async function downloadBlob(url, filename, errorMsg = '下载失败') {
  try {
    const res = await axios.get(url, { responseType: 'blob' });
    const href = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(href);
  } catch {
    message.error(errorMsg);
  }
}
