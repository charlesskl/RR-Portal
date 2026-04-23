// Design tokens — single source of truth, mirrors zuru-master design language.
// 暖色 canvas + 深青绿 accent + 降饱和度语义色。

export const colors = {
  ink: '#1a1a18',
  ink2: '#3a3934',
  muted: '#6b6a65',
  border: '#e8e6e1',
  borderStrong: '#d6d4ce',
  surface: '#ffffff',
  canvas: '#faf9f5',
  canvas2: '#f3f1ea',
  accent: '#0d7c66',
  accent2: '#0a6453',
  accentSoft: '#e5f1ee',
  accentTint: 'rgba(13, 124, 102, 0.08)',
  warn: '#b8750d',
  warnSoft: '#fdf4e3',
  danger: '#a83e3e',
  dangerSoft: '#faeaea',
  info: '#2f5d8f',
  infoSoft: '#e8effa',
  // Accent purple for 印尼 RR02 category (distinct from teal primary)
  purple: '#6e4a9e',
  purpleSoft: '#f1ebf8',
} as const

// AntD 6 ConfigProvider theme — tokens drive the entire component library.
export const antdTheme = {
  token: {
    colorPrimary: colors.accent,
    colorSuccess: colors.accent,
    colorInfo: colors.info,
    colorWarning: colors.warn,
    colorError: colors.danger,

    colorBgBase: colors.canvas,
    colorBgContainer: colors.surface,
    colorBgLayout: colors.canvas,
    colorBgElevated: colors.surface,

    colorBorder: colors.border,
    colorBorderSecondary: colors.borderStrong,

    colorText: colors.ink,
    colorTextSecondary: colors.ink2,
    colorTextTertiary: colors.muted,
    colorTextQuaternary: colors.muted,

    colorFillAlter: colors.canvas2,
    colorFillSecondary: colors.canvas2,
    colorFillTertiary: 'rgba(26,26,24,0.03)',
    colorFillQuaternary: 'rgba(26,26,24,0.02)',

    borderRadius: 10,
    borderRadiusSM: 6,
    borderRadiusLG: 12,
    borderRadiusXS: 4,

    fontFamily:
      "'Geist', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif",
    fontFamilyCode: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: 15,
    fontSizeSM: 13,
    fontSizeLG: 16,
    fontSizeHeading1: 30,
    fontSizeHeading2: 22,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,
    lineHeight: 1.55,

    // zuru-master 风格：几乎看不见的阴影，不要 glow
    boxShadow: '0 1px 2px rgba(26, 26, 24, 0.03)',
    boxShadowSecondary: '0 4px 12px rgba(26, 26, 24, 0.06)',
    boxShadowTertiary: '0 1px 2px rgba(26, 26, 24, 0.03)',

    motionDurationFast: '120ms',
    motionDurationMid: '160ms',
    motionDurationSlow: '200ms',
  },
  components: {
    Button: {
      fontWeight: 500,
      primaryShadow: '0 1px 2px rgba(13, 124, 102, 0.2)',
      defaultShadow: 'none',
      dangerShadow: 'none',
      contentFontSizeLG: 15,
      paddingContentHorizontal: 16,
    },
    Card: {
      headerFontSize: 13,
      headerFontSizeSM: 12,
      headerHeight: 44,
      headerHeightSM: 36,
      headerBg: 'transparent',
      actionsBg: 'transparent',
      paddingLG: 20,
    },
    Typography: {
      titleMarginBottom: '0.4em',
      titleMarginTop: '0.4em',
    },
    Table: {
      headerBg: colors.canvas2,
      headerColor: colors.ink2,
      headerSplitColor: colors.border,
      rowHoverBg: colors.accentSoft,
      borderColor: colors.border,
      fontSize: 13,
      cellPaddingBlock: 8,
      cellPaddingInline: 10,
    },
    Descriptions: {
      labelBg: 'transparent',
      titleColor: colors.ink,
      contentColor: colors.ink,
      itemPaddingBottom: 6,
    },
    List: {
      headerBg: 'transparent',
      itemPaddingSM: '8px 12px',
      emptyTextPadding: 20,
    },
    Alert: {
      borderRadiusLG: 10,
      withDescriptionPadding: '12px 14px',
      defaultPadding: '10px 14px',
    },
    Tag: {
      defaultBg: colors.canvas2,
      defaultColor: colors.ink2,
    },
    Upload: {
      actionsColor: colors.muted,
    },
  },
} as const
