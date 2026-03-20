"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PnlValue } from "@/components/ui/pnl-value";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent, formatDate } from "@/lib/utils";
import {
  chartColors,
  chartTooltipStyle,
  chartAxisProps,
  chartGridProps,
} from "@/lib/chart-theme";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StrategyRow {
  id: string;
  pnl: number;
  trades: number;
  wins: number;
}

interface DailyRow {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
}

interface PortfolioSnapshot {
  total_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  cash: number;
  snapshot_at: string;
}

interface PnlTabsProps {
  byStrategy: StrategyRow[];
  daily: DailyRow[];
  portfolioSnapshots: PortfolioSnapshot[];
  strategyNames: Record<string, string>;
}

export function PnlTabs({
  byStrategy,
  daily,
  portfolioSnapshots,
  strategyNames,
}: PnlTabsProps) {
  return (
    <Tabs defaultValue={0}>
      <TabsList>
        <TabsTrigger value={0}>Strategy Attribution</TabsTrigger>
        <TabsTrigger value={1}>Daily P&L</TabsTrigger>
        <TabsTrigger value={2}>Portfolio Timeline</TabsTrigger>
      </TabsList>

      {/* Strategy Attribution */}
      <TabsContent value={0}>
        {byStrategy.length === 0 ? (
          <EmptyState message="No resolved trades yet. Strategies are scanning every 5 minutes." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Wins</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Avg P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStrategy.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {strategyNames[s.id] ?? s.id}
                  </TableCell>
                  <TableCell className="text-right font-mono">{s.trades}</TableCell>
                  <TableCell className="text-right font-mono">{s.wins}</TableCell>
                  <TableCell className="text-right font-mono">
                    {s.trades > 0 ? formatPercent(s.wins / s.trades) : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right">
                    <PnlValue value={s.pnl} format={formatCurrency} />
                  </TableCell>
                  <TableCell className="text-right">
                    {s.trades > 0 ? (
                      <PnlValue value={s.pnl / s.trades} format={formatCurrency} />
                    ) : (
                      "\u2014"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      {/* Daily P&L */}
      <TabsContent value={1}>
        {daily.length === 0 ? (
          <EmptyState message="No resolved trades yet. Daily P&L will appear as trades close." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Wins</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">P&L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daily.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="font-mono">{d.date}</TableCell>
                  <TableCell className="text-right font-mono">{d.trades}</TableCell>
                  <TableCell className="text-right font-mono">{d.wins}</TableCell>
                  <TableCell className="text-right font-mono">
                    {d.trades > 0 ? formatPercent(d.wins / d.trades) : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right">
                    <PnlValue value={d.pnl} format={formatCurrency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      {/* Portfolio Timeline */}
      <TabsContent value={2}>
        {portfolioSnapshots.length === 0 ? (
          <EmptyState message="No portfolio snapshots yet." />
        ) : (
          <div className="h-[400px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={portfolioSnapshots}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.success} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColors.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGridProps} />
                <XAxis
                  dataKey="snapshot_at"
                  {...chartAxisProps}
                  tickFormatter={(v: string) => {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis
                  {...chartAxisProps}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelFormatter={(v: string) => formatDate(v)}
                  formatter={(value: number) => [formatCurrency(value), "Total Value"]}
                />
                <Area
                  type="monotone"
                  dataKey="total_value"
                  stroke={chartColors.success}
                  fill="url(#portfolioFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
