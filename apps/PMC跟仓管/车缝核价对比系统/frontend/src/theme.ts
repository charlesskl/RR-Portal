import type { ThemeConfig } from 'antd';

/**
 * 设计系统 token —— 审定方向：柔和蓝 + 顶部横向导航（业务方截图同款风格，主题换蓝）。
 * 柔和圆角、蓝色主色、彩色辅助按钮；绿/红留给状态语义。
 */
export const FONT_UI =
  "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif";

export const palette = {
  ink: '#1f2937',
  inkSoft: '#6b7686',
  bg: '#f4f7fc',
  raised: '#ffffff',
  line: '#e9edf4',
  blue: '#2f7ff0',
  blueDark: '#1f63d8',
  blueSoft: '#e9f2fe',
  cyan: '#0bb5d4',
  amber: '#d6890c',
  violet: '#7c6df2',
  ok: '#16a34a',
  okSoft: '#e7f6ec',
  bad: '#e0394b',
};

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: palette.blue,
    colorInfo: palette.blue,
    colorLink: palette.blue,
    colorLinkHover: palette.blueDark,
    colorSuccess: palette.ok,
    colorError: palette.bad,
    colorWarning: palette.amber,
    colorText: palette.ink,
    colorTextSecondary: palette.inkSoft,
    colorBgLayout: palette.bg,
    colorBgContainer: palette.raised,
    colorBorder: palette.line,
    colorBorderSecondary: '#f0f3f8',
    fontFamily: FONT_UI,
    fontSize: 13,
    borderRadius: 10,
    controlHeight: 32,
    wireframe: false,
    boxShadow: '0 2px 8px rgba(31,99,216,0.06)',
    boxShadowSecondary: '0 8px 24px rgba(31,99,216,0.10)',
  },
  components: {
    Layout: {
      headerBg: palette.raised,
      headerHeight: 56,
      bodyBg: palette.bg,
    },
    Menu: {
      itemBg: 'transparent',
      horizontalItemSelectedColor: palette.blueDark,
      itemSelectedBg: palette.blueSoft,
      itemSelectedColor: palette.blueDark,
      itemColor: palette.inkSoft,
      itemHoverBg: '#f5f7fa',
      itemHoverColor: palette.ink,
      itemBorderRadius: 10,
      horizontalItemBorderRadius: 10,
    },
    Button: {
      fontWeight: 600,
      primaryShadow: '0 3px 9px rgba(47,127,240,0.28)',
      defaultShadow: 'none',
      borderRadiusLG: 10,
    },
    Card: {
      borderRadiusLG: 14,
      colorBorderSecondary: palette.line,
    },
    Drawer: { colorBgElevated: palette.raised },
    Input: { activeShadow: '0 0 0 3px rgba(47,127,240,0.14)', borderRadius: 9 },
    Tag: { borderRadiusSM: 8 },
    Table: {
      headerBg: '#fafbfd',
      headerColor: palette.inkSoft,
      borderColor: palette.line,
      rowHoverBg: '#fafbff',
      cellPaddingBlock: 7,
    },
  },
};
