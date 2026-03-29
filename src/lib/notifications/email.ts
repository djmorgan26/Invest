/**
 * Email notification service via Resend.
 *
 * Sends alerts when stale opportunities are detected on Kalshi.
 * Free tier: 100 emails/day, 3,000/month — more than enough.
 */

import { Resend } from "resend";

let resendClient: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not set, notifications disabled");
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function getRecipient(): string {
  return process.env.ALERT_EMAIL || process.env.RESEND_FROM_EMAIL || "";
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

export interface OpportunityAlert {
  ticker: string;
  market_title: string;
  category: string;
  trigger_source: string;
  trigger_event: string;
  trigger_detail: string;
  kalshi_price: number;
  estimated_fair_value: number;
  edge_cents: number;
  side: "yes" | "no";
  confidence: number;
  staleness_seconds: number;
  window_seconds: number;
}

/**
 * Send an email alert for a stale price opportunity.
 */
export async function sendOpportunityAlert(opp: OpportunityAlert): Promise<boolean> {
  const client = getClient();
  const to = getRecipient();

  if (!client || !to) {
    console.log("[Email] Skipping alert (no client or recipient)");
    return false;
  }

  const sideLabel = opp.side.toUpperCase();
  const edgeColor = opp.edge_cents >= 10 ? "#22c55e" : "#f59e0b";
  const confidencePct = (opp.confidence * 100).toFixed(0);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">

    <!-- Header -->
    <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:24px;">🚨</span>
        <span style="font-size:18px;font-weight:700;color:#fff;">STALE OPPORTUNITY</span>
      </div>
      <p style="font-size:14px;color:#a1a1aa;margin:0;">
        Act fast — this market hasn't repriced yet
      </p>
    </div>

    <!-- The bet -->
    <div style="background:#18181b;border:2px solid ${edgeColor};border-radius:12px;padding:20px;margin-bottom:16px;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#71717a;margin:0 0 8px 0;">Recommended Trade</p>

      <p style="font-size:16px;font-weight:600;color:#fff;margin:0 0 4px 0;">${opp.market_title}</p>
      <p style="font-size:12px;color:#71717a;margin:0 0 16px 0;">${opp.ticker}</p>

      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;background:#27272a;border-radius:8px;padding:12px;text-align:center;">
          <p style="font-size:11px;color:#71717a;margin:0 0 4px 0;">BUY</p>
          <p style="font-size:28px;font-weight:800;color:${opp.side === 'yes' ? '#22c55e' : '#ef4444'};margin:0;">
            ${sideLabel}
          </p>
        </div>
        <div style="flex:1;background:#27272a;border-radius:8px;padding:12px;text-align:center;">
          <p style="font-size:11px;color:#71717a;margin:0 0 4px 0;">EDGE</p>
          <p style="font-size:28px;font-weight:800;color:${edgeColor};margin:0;">${opp.edge_cents}¢</p>
        </div>
      </div>

      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;color:#71717a;">Current Kalshi Price</td>
          <td style="padding:6px 0;text-align:right;font-family:monospace;color:#fff;">${opp.kalshi_price}¢</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#71717a;">Estimated Fair Value</td>
          <td style="padding:6px 0;text-align:right;font-family:monospace;color:${edgeColor};">${opp.estimated_fair_value}¢</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#71717a;">Confidence</td>
          <td style="padding:6px 0;text-align:right;font-family:monospace;color:#fff;">${confidencePct}%</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#71717a;">Stale For</td>
          <td style="padding:6px 0;text-align:right;font-family:monospace;color:#f59e0b;">${opp.staleness_seconds}s</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#71717a;">Window Remaining</td>
          <td style="padding:6px 0;text-align:right;font-family:monospace;color:#ef4444;">${opp.window_seconds}s</td>
        </tr>
      </table>
    </div>

    <!-- Trigger info -->
    <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;margin-bottom:16px;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#71717a;margin:0 0 8px 0;">What Triggered This</p>
      <p style="font-size:14px;color:#fff;margin:0 0 4px 0;">
        <span style="background:#27272a;border-radius:4px;padding:2px 6px;font-size:11px;text-transform:uppercase;color:#a1a1aa;">${opp.trigger_source}</span>
        &nbsp;${opp.category}
      </p>
      <p style="font-size:13px;color:#e4e4e7;margin:8px 0 4px 0;">${opp.trigger_event}</p>
      <p style="font-size:12px;color:#71717a;margin:0;">${opp.trigger_detail}</p>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:16px;">
      <a href="https://kalshi.com/markets/${opp.ticker}" style="display:inline-block;background:#22c55e;color:#000;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">
        Open on Kalshi →
      </a>
    </div>

    <p style="font-size:11px;color:#52525b;text-align:center;margin:0;">
      Kalshi Edge • Speed Edge Alert • ${opp.category}
    </p>
  </div>
</body>
</html>`;

  try {
    const { error } = await client.emails.send({
      from: `Kalshi Edge <${getFromAddress()}>`,
      to: [to],
      subject: `🚨 ${opp.edge_cents}¢ edge: ${sideLabel} ${opp.ticker} (${opp.category})`,
      html,
    });

    if (error) {
      console.error("[Email] Send error:", error);
      return false;
    }

    console.log(`[Email] Alert sent for ${opp.ticker} (${opp.edge_cents}¢ edge)`);
    return true;
  } catch (err) {
    console.error("[Email] Failed:", err);
    return false;
  }
}

/**
 * Send a daily summary digest of all opportunities found.
 */
export async function sendDailySummary(stats: {
  opportunities_found: number;
  total_edge_cents: number;
  top_opportunities: OpportunityAlert[];
  sources_online: number;
  total_signals: number;
}): Promise<boolean> {
  const client = getClient();
  const to = getRecipient();

  if (!client || !to) return false;

  const topOpps = stats.top_opportunities
    .map(
      (o) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #27272a;font-size:13px;">${o.ticker}</td>
          <td style="padding:8px;border-bottom:1px solid #27272a;font-size:13px;">${o.side.toUpperCase()}</td>
          <td style="padding:8px;border-bottom:1px solid #27272a;font-size:13px;font-family:monospace;color:#22c55e;">${o.edge_cents}¢</td>
          <td style="padding:8px;border-bottom:1px solid #27272a;font-size:13px;">${o.trigger_source}</td>
        </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 16px 0;">📊 Daily Edge Summary</h1>

    <div style="display:flex;gap:12px;margin-bottom:20px;">
      <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;text-align:center;">
        <p style="font-size:11px;color:#71717a;margin:0 0 4px 0;">Opportunities</p>
        <p style="font-size:24px;font-weight:700;color:#fff;margin:0;">${stats.opportunities_found}</p>
      </div>
      <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;text-align:center;">
        <p style="font-size:11px;color:#71717a;margin:0 0 4px 0;">Total Edge</p>
        <p style="font-size:24px;font-weight:700;color:#22c55e;margin:0;">${stats.total_edge_cents}¢</p>
      </div>
      <div style="flex:1;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:12px;text-align:center;">
        <p style="font-size:11px;color:#71717a;margin:0 0 4px 0;">Signals</p>
        <p style="font-size:24px;font-weight:700;color:#fff;margin:0;">${stats.total_signals}</p>
      </div>
    </div>

    ${
      topOpps
        ? `<div style="background:#18181b;border:1px solid #27272a;border-radius:12px;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#27272a;">
                  <th style="padding:8px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;">Ticker</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;">Side</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;">Edge</th>
                  <th style="padding:8px;text-align:left;font-size:11px;color:#71717a;text-transform:uppercase;">Source</th>
                </tr>
              </thead>
              <tbody>${topOpps}</tbody>
            </table>
          </div>`
        : ""
    }

    <p style="font-size:11px;color:#52525b;text-align:center;margin:16px 0 0 0;">
      Kalshi Edge • Daily Summary
    </p>
  </div>
</body>
</html>`;

  try {
    const { error } = await client.emails.send({
      from: `Kalshi Edge <${getFromAddress()}>`,
      to: [to],
      subject: `📊 Daily: ${stats.opportunities_found} opportunities, ${stats.total_edge_cents}¢ total edge`,
      html,
    });

    if (error) {
      console.error("[Email] Summary send error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Email] Summary failed:", err);
    return false;
  }
}
