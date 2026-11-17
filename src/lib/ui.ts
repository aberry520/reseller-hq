// Shared spacing / colour scale for Reseller HQ.
// Plain StyleSheet only — no UI kit dependency. Keep the existing
// blue primary (#0969da) and light card style everywhere.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const colors = {
  primary: '#0969da',
  text: '#1f2328',
  muted: '#656d76',
  background: '#ffffff',
  card: '#f6f8fa',
  border: '#d0d7de',
  divider: '#eaeef2',
  chip: '#eaeef2',
  danger: '#cf222e',
  success: '#1a7f37',
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
} as const;

// Minimum comfortable touch height for buttons, chips and rows
// (44pt is the iOS minimum; most controls here are 48pt+).
export const minTouchHeight = 48;
