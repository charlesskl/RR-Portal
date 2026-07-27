import { SettingOutlined } from '@ant-design/icons';
import { App, Button, Form, InputNumber, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { loadSystemRates, rateConfigApi } from '../api/rateConfigs';

interface Props {
  deptId: number;
  visible: boolean;
  onChanged: (rates: { exchangeRate: number; taxRate: number }) => void;
}

export default function RateSettingsButton({ deptId, visible, onChanged }: Props) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ exchangeRate: number; taxPercent: number }>();

  useEffect(() => {
    if (!open) return;
    loadSystemRates(deptId).then((r) => form.setFieldsValue({ exchangeRate: r.exchangeRate, taxPercent: r.taxRate * 100 }));
  }, [deptId, form, open]);

  if (!visible) return null;

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await rateConfigApi.create({ rateType: 'exchange', rateValue: v.exchangeRate, effectiveDate: today, deptId, remark: '页面配置' });
      await rateConfigApi.create({ rateType: 'tax', rateValue: v.taxPercent / 100, effectiveDate: today, deptId, remark: '页面配置' });
      const rates = { exchangeRate: v.exchangeRate, taxRate: v.taxPercent / 100 };
      onChanged(rates);
      setOpen(false);
      message.success('汇率和税率已生效，并保留历史版本');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button icon={<SettingOutlined />} onClick={() => setOpen(true)}>汇率/税率</Button>
      <Modal title="汇率与税率配置" open={open} onCancel={() => setOpen(false)} onOk={save} confirmLoading={saving} okText="保存并生效">
        <Form form={form} layout="vertical" style={{ marginTop: 18 }}>
          <Form.Item name="exchangeRate" label="港币兑人民币（1 HK$ = ? ¥）" rules={[{ required: true }]}>
            <InputNumber min={0.0001} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="taxPercent" label="税率（%）" rules={[{ required: true }]}>
            <InputNumber min={0.01} max={100} precision={2} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
