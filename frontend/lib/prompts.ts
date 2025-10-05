export const EXTRACTION_PROMPT = `You are a financial data extraction AI. Extract ALL holdings and transactions from this PDF statement.

Return ONLY valid JSON matching this structure:
{
  "statement_date": "YYYY-MM-DD",
  "issuer": "Bank/Institution name",
  "base_currency": "USD|INR|etc",
  "accounts": [
    {
      "account_id": "folio/demat/portfolio number",
      "account_type": "string",
      "primary_holder_name": "string",
      "custodian_name": "string",
      "holdings": [
        {
          "security_id": "ISIN/CUSIP if available",
          "security_name": "string",
          "security_type": "Stock|Bond|Mutual Fund|Others",
          "quantity": number,
          "market_value": number,
          "price": number,
          "currency": "actual currency code",
          "average_cost_per_unit": number,
          "unrealized_gain_loss": number,
          "holding_date": "YYYY-MM-DD"
        }
      ],
      "transactions": [
        {
          "transaction_date": "YYYY-MM-DD",
          "transaction_type": "Purchase|Redemption|Buy|Sell|Dividend Payout|Coupon|Charges|Taxes|STT|Stamp Duty",
          "security_id": "ISIN if available",
          "security_name": "string",
          "security_type": "Stock|Bond|Mutual Fund|Others",
          "quantity": number,
          "price": number,
          "net_amount": number,
          "gross_amount": number,
          "currency": "actual currency code",
          "transaction_ref": "reference number"
        }
      ]
    }
  ]
}

CRITICAL EXTRACTION RULES:
1. Extract ALL asset types: stocks, bonds, mutual funds, perpetual bonds, short-term investments
2. Extract ALL pages - do not summarize, capture every holding and transaction
3. Preserve original currency codes (USD, EUR, GBP, CNH, etc.) - DO NOT convert to INR
4. For bonds: include ISIN, coupon rate, maturity date in security_name if no separate fields
5. Create separate transaction objects for: main trade, charges, taxes, stamp duty
6. Exclude loan drawdowns/repayments unless they're actual securities transactions
7. Group all holdings/transactions by account_id if multiple accounts exist
8. All amounts must be positive numbers (no negative signs)
9. Dates must be YYYY-MM-DD format (pad with zeros: 2025-06-03 not 2025-6-3)

TRANSACTION TYPES:
- Stocks: "Buy", "Sell", "Dividend Payout", "Charges", "Taxes", "STT"
- Mutual Funds: "Purchase", "Redemption", "Switch In", "Switch Out", "Dividend Reinvestment"
- Bonds: "Coupon" (for interest payments)
- All: "Stamp Duty" (separate transaction)

Return ONLY the JSON object with NO markdown, explanations, or code blocks.`;

export const TRANSFORM_PROMPT = (data: any, userPrompt: string) => `
Transform this financial data according to the user's instructions.

Original Data:
${JSON.stringify(data, null, 2)}

User Instructions:
${userPrompt}

Return ONLY valid JSON with the transformed data in Wealthfy format:
{
  "date": "YYYY-MM-DD",
  "description": "string",
  "amount": number,
  "type": "debit|credit",
  "category": "string"
}`;