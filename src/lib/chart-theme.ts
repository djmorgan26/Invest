export const chartColors = {
  success: "var(--success)",
  destructive: "var(--destructive)",
  warning: "var(--warning)",
  line: "#e4e4e7",
  grid: "rgba(255,255,255,0.06)",
  axis: "rgba(255,255,255,0.06)",
  axisText: "#a1a1aa",
  tooltipBg: "#18181b",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipText: "#e4e4e7",
  tooltipLabel: "#a1a1aa",
  bid: "var(--success)",
  ask: "var(--destructive)",
  pending: "#71717a",
} as const;

export const chartTooltipStyle = {
  backgroundColor: chartColors.tooltipBg,
  border: `1px solid ${chartColors.tooltipBorder}`,
  borderRadius: "8px",
  fontSize: 12,
} as const;

export const chartAxisProps = {
  tick: { fontSize: 11, fill: chartColors.axisText },
  tickLine: false as const,
  axisLine: { stroke: chartColors.axis },
} as const;

export const chartGridProps = {
  strokeDasharray: "3 3",
  stroke: chartColors.grid,
} as const;
