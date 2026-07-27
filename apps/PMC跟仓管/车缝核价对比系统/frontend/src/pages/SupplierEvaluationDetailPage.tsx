import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Row, Space, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { evaluationApi, type EvaluationDetail } from '../api/supplierEvaluation';
import { palette } from '../theme';

const dash = '—';
const money = (v: number) => `¥${v.toFixed(2)}`;
const pct = (v?: number | null) => v == null ? dash : `${(v * 100).toFixed(1)}%`;
const gradeColor = (g: string) => g === '未评级' ? 'default' : g === '观察中' ? 'processing' : g.startsWith('A') ? 'success' : g.startsWith('B') ? 'blue' : g.startsWith('C') ? 'orange' : 'error';
const value = (v?: string | number | null) => v == null || v === '' ? dash : v;

const cardStyle = { height: '100%', borderColor: palette.line };
const compactCardStyles = {
  header: { minHeight: 42, padding: '0 20px', fontSize: 17, fontWeight: 700 },
  body: { padding: '14px 20px' },
};
const metricStyle = { display: 'flex', flexDirection: 'column' as const, gap: 8 };
const metric = (label: string, content: React.ReactNode) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 24 }}>
    <div style={{ color: palette.ink, fontSize: 14 }}>{label}</div>
    <div style={{ fontSize: 15, lineHeight: 1.35, textAlign: 'right' }}>{content}</div>
  </div>
);
const scoreItem = (label: string, content: React.ReactNode) => (
  <div>
    <div style={{ color: palette.inkSoft, fontSize: 12, marginBottom: 5 }}>{label}</div>
    <div style={{ fontSize: 22, lineHeight: 1.1 }}>{content}</div>
  </div>
);

export default function SupplierEvaluationDetailPage() {
  const navigate = useNavigate();
  const { supplierId } = useParams();
  const [data, setData] = useState<EvaluationDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = Number(supplierId);
    if (!id) {
      navigate('/dashboard', { replace: true });
      return;
    }
    evaluationApi.detail(id).then(setData).finally(() => setLoading(false));
  }, [supplierId, navigate]);

  return (
    <Spin spinning={loading}>
      <div style={{ minHeight: 300 }}>
        <Space style={{ marginBottom: 12 }}>
          <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/dashboard')} style={{ paddingInline: 0 }}>返回综合评价</Button>
          <div style={{ fontSize: 22, fontWeight: 700, marginLeft: 12 }}>{data?.profile.supplierName ?? '加工厂详情'}</div>
          <Tag style={{ marginLeft: 2 }}>只读</Tag>
        </Space>

        {data && (
          <>
            <Card
              size="small"
              title={<span style={{ color: palette.blueDark }}>加工厂资料</span>}
              style={{ marginBottom: 12, borderColor: palette.line }}
              styles={{ ...compactCardStyles, body: { padding: '12px 26px' } }}
            >
              <Descriptions column={2} size="small" colon={false} styles={{ label: { color: palette.inkSoft, width: 110 }, content: { color: palette.ink } }}>
                <Descriptions.Item label="加工厂名称">{data.profile.supplierName}</Descriptions.Item>
                <Descriptions.Item label="联系人">{value(data.profile.contact)}</Descriptions.Item>
                <Descriptions.Item label="电话">{value(data.profile.phone)}</Descriptions.Item>
                <Descriptions.Item label="地址">{value(data.profile.address)}</Descriptions.Item>
                <Descriptions.Item label="月产能">{value(data.profile.monthlyCapacity)}</Descriptions.Item>
                <Descriptions.Item label="设备/生产线">{value(data.profile.equipmentCount)}</Descriptions.Item>
                <Descriptions.Item label="为我司生产机台">{value(data.profile.machinesForUs)}</Descriptions.Item>
                <Descriptions.Item label="员工人数">{value(data.profile.employeeCount)}</Descriptions.Item>
                <Descriptions.Item label="资质">{value(data.profile.qualification)}</Descriptions.Item>
                <Descriptions.Item label="备注">{value(data.profile.remark)}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" style={{ marginBottom: 12, borderColor: palette.line }} styles={{ body: { padding: '14px 26px' } }}>
              <Row gutter={24} align="middle">
                <Col span={5}>{scoreItem('综合得分', data.evaluation.totalScore ?? dash)}</Col>
                <Col span={4}>{scoreItem('质量分', data.evaluation.qualityScore ?? dash)}</Col>
                <Col span={4}>{scoreItem('价格分', data.evaluation.priceScore ?? dash)}</Col>
                <Col span={4}>{scoreItem('交付分', data.evaluation.deliveryScore ?? dash)}</Col>
                <Col span={3}>
                  <div style={{ color: palette.inkSoft, fontSize: 12, marginBottom: 6 }}>评级</div>
                  <Tag color={gradeColor(data.evaluation.grade)} style={{ fontSize: 15, padding: '2px 8px' }}>{data.evaluation.grade}</Tag>
                </Col>
                <Col span={4}>
                  <div style={{ color: palette.inkSoft, fontSize: 12, marginBottom: 5 }}>处理建议</div>
                  <div style={{ fontSize: 15 }}>{data.evaluation.advice}</div>
                </Col>
              </Row>
            </Card>

            <Row gutter={14}>
              <Col xs={24} xl={8}>
                <Card size="small" title="价格表现" style={{ ...cardStyle, borderTop: `4px solid ${palette.violet}` }} styles={compactCardStyles}>
                  <div style={metricStyle}>
                    {metric('本厂核价总额', <span style={{ color: palette.blueDark }}>{money(data.price.internalAmount)}</span>)}
                    {metric('外发总额', <span style={{ color: palette.amber }}>{money(data.price.outsourceAmount)}</span>)}
                    {metric('节约率', <span style={{ color: palette.ok }}>{pct(data.price.savingRate)}</span>)}
                  </div>
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Card size="small" title="交付表现" style={{ ...cardStyle, borderTop: `4px solid ${palette.amber}` }} styles={compactCardStyles}>
                  <div style={metricStyle}>
                    {metric('订单总数', data.price.orderCount)}
                    {metric('延期订单', data.delivery.delayedCount)}
                    {metric('延期占比', <span style={{ color: data.delivery.delayedCount > 0 ? palette.bad : palette.ok }}>{data.delivery.deliveredCount > 0 ? pct(data.delivery.delayedCount / data.delivery.deliveredCount) : dash}</span>)}
                    {metric('平均延期天数', data.delivery.averageDelayDays == null ? dash : `${data.delivery.averageDelayDays} 天`)}
                  </div>
                </Card>
              </Col>
              <Col xs={24} xl={8}>
                <Card size="small" title="品质表现" style={{ ...cardStyle, borderTop: `4px solid ${palette.cyan}` }} styles={compactCardStyles}>
                  <div style={metricStyle}>
                    {metric('验货记录', data.quality.inspectionCount)}
                    {metric('不良数量', data.quality.defectQty)}
                    {metric('不良占比', <span style={{ color: (data.quality.defectRate ?? 0) > 0 ? palette.bad : palette.ok }}>{pct(data.quality.defectRate)}</span>)}
                  </div>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </div>
    </Spin>
  );
}
