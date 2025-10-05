// lib/groq.ts
import 'server-only';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

// Optional: best-effort plaintext hint from PDF (won’t crash if pdf-parse can’t load)
async function tryPdfText(buffer: Buffer): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse: (b: Buffer, o?: any) => Promise<{ text: string }> = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    const t = (parsed.text || '').trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const MODEL_NAME = 'gemini-2.0-flash';        // free tier friendly
const MAX_FILE_SIZE_MB = 20;

// -------------------- Zod schemas mirroring state.py --------------------
const StatementFrequencyEnum = z.enum(['Monthly', 'Quarterly', 'Annual', 'Other']);

const SecurityTypeEnum = z.enum(['Stock', 'Bond', 'Mutual Fund', 'Others']);

// MF enum
const TransactionTypeEnumForMutualFunds = z.enum([
  'Purchase','Redemption','Switch In','Switch Out','Transfer In','Transfer Out',
  'Systematic Purchase','Systematic Redemption','Systematic Switch In','Systematic Switch Out',
  'Stamp Duty','STT','Dividend Payout','Dividend Reinvestment','Bonus','Others'
]);
// Stocks demat enum
const TransactionTypeEnumForStocksDemat = z.enum([
  'Settlement Credit','Settlement Debit','Corporate Action Debit','Corporate Action Credit'
]);
// Contract note enum
const TransactionTypeEnumForStocksContractNote = z.enum([
  'Buy','Sell','Charges','Taxes'
]);

// In JSON Schema we can’t do “oneOf” unions easily for free tier; for LLM guidance we’ll expose a full union set as allowed string values:
const TransactionTypeUnifiedEnum = z.enum([
  ...TransactionTypeEnumForMutualFunds.options,
  ...TransactionTypeEnumForStocksDemat.options,
  ...TransactionTypeEnumForStocksContractNote.options,
  'Interest', 'Coupon', // extra common finance types your Python prompt implies
]);

// Holding
export const Holding = z.object({
  security_id: z.string().nullable().optional(),
  security_type: SecurityTypeEnum.nullable().optional(),
  quantity: z.number().nullable().optional(),
  average_cost_per_unit: z.number().nullable().optional(),
  total_cost_value: z.number().nullable().optional(),
  market_value: z.number().nullable().optional(),
  security_name: z.string().nullable().optional(),
  issuer: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  unrealized_gain_loss: z.number().nullable().optional(),
  invested_value: z.number().nullable().optional(),
  committed_value: z.number().nullable().optional(),
  drawndown_value: z.number().nullable().optional(),
  capital_returned: z.number().nullable().optional(),
  income_distributed: z.number().nullable().optional(),
  holding_date: z.string().nullable().optional(),
  price_date: z.string().nullable().optional(),
});

// Transaction (use unified enum string for LLM; you can map back to specific Python enums downstream)
export const Transaction = z.object({
  transaction_date: z.string().nullable().optional(),
  transaction_type: TransactionTypeUnifiedEnum.nullable().optional(),
  security_id: z.string().nullable().optional(),
  security_type: SecurityTypeEnum.nullable().optional(),
  quantity: z.number().nullable().optional(),
  net_amount: z.number().nullable().optional(),
  settlement_date: z.string().nullable().optional(),
  security_name: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  gross_amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  transaction_ref: z.string().nullable().optional(),
  transaction_description: z.string().nullable().optional(),
});

// Order
export const Order = z.object({
  order_date: z.string().nullable().optional(),
  order_time: z.string().nullable().optional(),
  trade_date: z.string().nullable().optional(),
  trade_time: z.string().nullable().optional(),
  order_ref: z.string().nullable().optional(),
  trade_ref: z.string().nullable().optional(),
  transaction_type: TransactionTypeUnifiedEnum.nullable().optional(),
  security_id: z.string().nullable().optional(),
  security_type: SecurityTypeEnum.nullable().optional(),
  quantity: z.number().nullable().optional(),
  net_amount: z.number().nullable().optional(),
  security_name: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  gross_amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  order_description: z.string().nullable().optional(),
});

// AccountInformation
export const AccountInformation = z.object({
  account_id: z.string().nullable().optional(),
  account_type: z.string().nullable().optional(),
  primary_holder_name: z.string().nullable().optional(),
  primary_holder_id: z.string().nullable().optional(),
  secondary_holder_name: z.string().nullable().optional(),
  secondary_holder_id: z.string().nullable().optional(),
  third_holder_name: z.string().nullable().optional(),
  third_holder_id: z.string().nullable().optional(),
  advisory_mandate: z.string().nullable().optional(),
  relationship_manager: z.string().nullable().optional(),
  base_currency: z.string().nullable().optional(),
  custodian_name: z.string().nullable().optional(),
  custodian_id: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  bank_account_id: z.string().nullable().optional(),
  broker_code: z.string().nullable().optional(),
});

// Account
export const Account = z.object({
  account_information: AccountInformation.nullable().optional(),
  holdings: z.array(Holding).nullable().optional(),
  transactions: z.array(Transaction).nullable().optional(),
  orders: z.array(Order).nullable().optional(),
});

// StatementMetadata
export const StatementMetadata = z.object({
  statement_date: z.string().nullable().optional(),
  reporting_period_start: z.string().nullable().optional(),
  reporting_period_end: z.string().nullable().optional(),
  statement_issuer: z.string().nullable().optional(),
  statement_frequency: StatementFrequencyEnum.nullable().optional(),
  base_currency: z.string().nullable().optional(),
  statement_description: z.string().nullable().optional(),
});

// FinancialSecurityStatement (top level)
export const FinancialSecurityStatement = z.object({
  statement_metadata: StatementMetadata,
  accounts: z.array(Account),
});
export type FinancialSecurityStatementT = z.infer<typeof FinancialSecurityStatement>;

// -------------------- Prompt (aligned with Python) --------------------
const BASE_PROMPT = `
You are an expert financial data extraction AI. Analyze the provided PDF statement and return ONLY valid JSON matching the FinancialSecurityStatement schema:

{
  "statement_metadata": {
    "statement_date": "YYYY-MM-DD or null",
    "reporting_period_start": "YYYY-MM-DD or null",
    "reporting_period_end": "YYYY-MM-DD or null",
    "statement_issuer": "string or null",
    "statement_frequency": "Monthly|Quarterly|Annual|Other or null",
    "base_currency": "string or null",
    "statement_description": "string or null"
  },
  "accounts": [
    {
      "account_information": {
        "account_id": "folio/demat/portfolio id (prefer this over bank numbers) or null",
        "account_type": "string or null",
        "primary_holder_name": "string or null",
        "primary_holder_id": "string or null",
        "secondary_holder_name": "string or null",
        "secondary_holder_id": "string or null",
        "third_holder_name": "string or null",
        "third_holder_id": "string or null",
        "advisory_mandate": "string or null",
        "relationship_manager": "string or null",
        "base_currency": "string or null",
        "custodian_name": "string or null",
        "custodian_id": "string or null",
        "bank_name": "string or null",
        "bank_account_id": "string or null",
        "broker_code": "string or null"
      },
      "holdings": [ /* Holding[] */ ],
      "transactions": [ /* Transaction[] */ ],
      "orders": [ /* Order[] (ONLY if explicit order placement info exists) */ ]
    }
  ]
}

STRICT RULES:
- Extract ALL holdings and ALL transactions from ALL pages. Group them under the correct account.
- Dates MUST be YYYY-MM-DD (zero-padded). If a holding date is missing, leave null (we will fill with statement date).
- Numeric values MUST be positive (absolute values).
- security_type MUST be one of: Stock, Bond, Mutual Fund, Others.
- ACCOUNT ID: prefer the investment account identifier printed on the statement header (folio/demat/portfolio like “640101-1”). Do NOT use a bank number if both appear.
- BOND COUPONS/INTEREST: set transaction_type to "Interest" (or "Coupon"), security_type="Bond", and copy the bond ISIN into security_id.
- TIME DEPOSITS: use security_type="Others". "NEW DEPOSIT", "MATURED TIME DEPOSIT", and their interest belong to "Others".
- CHARGES/TAXES per trade: create separate transaction objects with transaction_type "Charges" or "Taxes" and copy security_id/security_name/security_type from the related trade.
- Every holding must have at least one of {security_id | security_name | quantity | market_value}. Do NOT emit empty placeholder rows.
- Use null for unavailable fields.
- Return ONLY JSON, no markdown.
`.trim();

// -------------------- Helpers --------------------
function normDate(s?: string | null): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  const dt = new Date(t);
  if (!isNaN(dt.getTime())) {
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  return t;
}

function abs(n: number | null | undefined): number | null {
  return typeof n === 'number' ? Math.abs(n) : (n ?? null);
}

// Light post-processing to match your Python norms
function postProcess(doc: FinancialSecurityStatementT): FinancialSecurityStatementT {
  const md = {
    ...doc.statement_metadata,
    statement_date: normDate(doc.statement_metadata.statement_date) ?? null,
    reporting_period_start: normDate(doc.statement_metadata.reporting_period_start),
    reporting_period_end: normDate(doc.statement_metadata.reporting_period_end),
  };

  const accs = (doc.accounts || []).map(acc => {
    const holdings = (acc.holdings || [])
      .map(h => ({
        ...h,
        quantity: abs(h.quantity),
        average_cost_per_unit: abs(h.average_cost_per_unit),
        total_cost_value: abs(h.total_cost_value),
        market_value: abs(h.market_value),
        price: abs(h.price),
        unrealized_gain_loss: abs(h.unrealized_gain_loss),
        invested_value: abs(h.invested_value),
        committed_value: abs(h.committed_value),
        drawndown_value: abs(h.drawndown_value),
        capital_returned: abs(h.capital_returned),
        income_distributed: abs(h.income_distributed),
        holding_date: normDate(h.holding_date) ?? md.statement_date ?? null,
        price_date: normDate(h.price_date),
      }))
      // drop truly empty rows
      .filter(h =>
        (h.security_id && h.security_id.trim() !== '') ||
        (h.security_name && h.security_name.trim() !== '') ||
        h.quantity != null || h.market_value != null
      );

    // Build quick index for coupon reconciliation
    const byName = new Map<string, { security_id?: string | null; security_type?: string | null }>();
    for (const h of holdings) {
      const key = (h.security_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (key) byName.set(key, { security_id: h.security_id ?? null, security_type: h.security_type ?? null });
    }

    const txns = (acc.transactions || []).map(t => {
      const tt = (t.transaction_type || '') as string;
      let security_type = t.security_type ?? null;
      let security_id = t.security_id ?? null;

      // Heuristic: if it's interest/coupon and the security_name matches a holding, copy ISIN and set Bond
      if (tt === 'Interest' || tt === 'Coupon') {
        const key = (t.security_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const match = key ? byName.get(key) : undefined;
        if (match?.security_id && !security_id) security_id = match.security_id;
        if (!security_type) security_type = 'Bond' as any;
      }

      return {
        ...t,
        transaction_date: normDate(t.transaction_date),
        settlement_date: normDate(t.settlement_date),
        quantity: abs(t.quantity),
        price: abs(t.price),
        gross_amount: abs(t.gross_amount),
        net_amount: abs(t.net_amount),
        security_type,
        security_id,
      };
    });

    const orders = (acc.orders || []).map(o => ({
      ...o,
      order_date: normDate(o.order_date),
      trade_date: normDate(o.trade_date),
      quantity: abs(o.quantity),
      price: abs(o.price),
      gross_amount: abs(o.gross_amount),
      net_amount: abs(o.net_amount),
    }));

    return {
      ...acc,
      holdings,
      transactions: txns,
      orders,
    };
  });

  return { statement_metadata: md, accounts: accs };
}

// -------------------- Gemini response schema (free-tier safe) --------------------
const responseSchema = {
  type: 'object',
  properties: {
    statement_metadata: {
      type: 'object',
      properties: {
        statement_date: { type: 'string', nullable: true },
        reporting_period_start: { type: 'string', nullable: true },
        reporting_period_end: { type: 'string', nullable: true },
        statement_issuer: { type: 'string', nullable: true },
        statement_frequency: { type: 'string', enum: ['Monthly','Quarterly','Annual','Other'], nullable: true },
        base_currency: { type: 'string', nullable: true },
        statement_description: { type: 'string', nullable: true },
      },
      required: ['statement_date'],
    },
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          account_information: {
            type: 'object',
            properties: {
              account_id: { type: 'string', nullable: true },
              account_type: { type: 'string', nullable: true },
              primary_holder_name: { type: 'string', nullable: true },
              primary_holder_id: { type: 'string', nullable: true },
              secondary_holder_name: { type: 'string', nullable: true },
              secondary_holder_id: { type: 'string', nullable: true },
              third_holder_name: { type: 'string', nullable: true },
              third_holder_id: { type: 'string', nullable: true },
              advisory_mandate: { type: 'string', nullable: true },
              relationship_manager: { type: 'string', nullable: true },
              base_currency: { type: 'string', nullable: true },
              custodian_name: { type: 'string', nullable: true },
              custodian_id: { type: 'string', nullable: true },
              bank_name: { type: 'string', nullable: true },
              bank_account_id: { type: 'string', nullable: true },
              broker_code: { type: 'string', nullable: true },
            },
            nullable: true,
          },
          holdings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                security_id: { type: 'string', nullable: true },
                security_type: { type: 'string', enum: ['Stock','Bond','Mutual Fund','Others'], nullable: true },
                quantity: { type: 'number', nullable: true },
                average_cost_per_unit: { type: 'number', nullable: true },
                total_cost_value: { type: 'number', nullable: true },
                market_value: { type: 'number', nullable: true },
                security_name: { type: 'string', nullable: true },
                issuer: { type: 'string', nullable: true },
                price: { type: 'number', nullable: true },
                currency: { type: 'string', nullable: true },
                unrealized_gain_loss: { type: 'number', nullable: true },
                invested_value: { type: 'number', nullable: true },
                committed_value: { type: 'number', nullable: true },
                drawndown_value: { type: 'number', nullable: true },
                capital_returned: { type: 'number', nullable: true },
                income_distributed: { type: 'number', nullable: true },
                holding_date: { type: 'string', nullable: true },
                price_date: { type: 'string', nullable: true },
              },
            },
            nullable: true,
          },
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                transaction_date: { type: 'string', nullable: true },
                transaction_type: {
                  type: 'string',
                  enum: TransactionTypeUnifiedEnum.options,
                  nullable: true,
                },
                security_id: { type: 'string', nullable: true },
                security_type: { type: 'string', enum: ['Stock','Bond','Mutual Fund','Others'], nullable: true },
                quantity: { type: 'number', nullable: true },
                net_amount: { type: 'number', nullable: true },
                settlement_date: { type: 'string', nullable: true },
                security_name: { type: 'string', nullable: true },
                price: { type: 'number', nullable: true },
                gross_amount: { type: 'number', nullable: true },
                currency: { type: 'string', nullable: true },
                counterparty: { type: 'string', nullable: true },
                transaction_ref: { type: 'string', nullable: true },
                transaction_description: { type: 'string', nullable: true },
              },
            },
            nullable: true,
          },
          orders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                order_date: { type: 'string', nullable: true },
                order_time: { type: 'string', nullable: true },
                trade_date: { type: 'string', nullable: true },
                trade_time: { type: 'string', nullable: true },
                order_ref: { type: 'string', nullable: true },
                trade_ref: { type: 'string', nullable: true },
                transaction_type: {
                  type: 'string',
                  enum: TransactionTypeUnifiedEnum.options,
                  nullable: true,
                },
                security_id: { type: 'string', nullable: true },
                security_type: { type: 'string', enum: ['Stock','Bond','Mutual Fund','Others'], nullable: true },
                quantity: { type: 'number', nullable: true },
                net_amount: { type: 'number', nullable: true },
                security_name: { type: 'string', nullable: true },
                price: { type: 'number', nullable: true },
                gross_amount: { type: 'number', nullable: true },
                currency: { type: 'string', nullable: true },
                counterparty: { type: 'string', nullable: true },
                order_description: { type: 'string', nullable: true },
              },
            },
            nullable: true,
          },
        },
      },
    },
  },
  required: ['statement_metadata','accounts'],
} as const;

// -------------------- Public API --------------------
export async function extractFinancialStatementFromPDF(
  pdfBuffer: Buffer
): Promise<FinancialSecurityStatementT> {
  const sizeInMB = pdfBuffer.length / (1024 * 1024);
  if (sizeInMB > MAX_FILE_SIZE_MB) {
    throw new Error(`PDF too large (${sizeInMB.toFixed(2)}MB). Max ${MAX_FILE_SIZE_MB}MB.`);
  }

  // Optional plaintext hint
  const textHint = await tryPdfText(pdfBuffer);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema, // free-tier-safe schema (no additionalProperties)
    },
  });

  const parts: Array<any> = [{ text: BASE_PROMPT }];
  if (textHint) parts.push({ text: `\n\nPlain-text hint extracted from PDF (may be imperfect):\n${textHint.slice(0, 12000)}` });
  parts.push({
    inlineData: {
      data: pdfBuffer.toString('base64'),
      mimeType: 'application/pdf',
    },
  });

  const res = await model.generateContent({
    contents: [{ role: 'user', parts }],
  });

  let text = res.response.text().trim();
  if (text.startsWith('```')) {
    text = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Model returned invalid JSON');
  }

  const parsed = FinancialSecurityStatement.safeParse(json);
  if (!parsed.success) {
    // Surface first error for quick debugging
    const first = parsed.error.issues?.[0];
    throw new Error(`Schema validation failed: ${first?.path?.join('.') ?? ''} - ${first?.message ?? ''}`);
  }

  return postProcess(parsed.data);
}
