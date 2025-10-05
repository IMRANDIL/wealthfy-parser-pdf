import os
import json
import traceback
import tempfile
from typing import List, Optional, Union
from enum import Enum
import asyncio
from typing import Literal

import google.generativeai as genai
from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware  # <-- NEW
from dotenv import load_dotenv

# --- Pydantic Models & Enums (kept as-is but unused for validation) ---
class StatementFrequencyEnum(str, Enum):
    MONTHLY = "Monthly"
    QUARTERLY = "Quarterly"
    ANNUAL = "Annual"
    OTHER = "Other"

class SecurityTypeEnum(str, Enum):
    STOCK = "Stock"
    BOND = "Bond"
    MUTUAL_FUND = "Mutual Fund"
    OTHERS = "Others"

class TransactionTypeEnumForMutualFunds(str, Enum):
    PURCHASE = "Purchase"
    REDEMPTION = "Redemption"
    SWITCH_IN = "Switch In"
    SWITCH_OUT = "Switch Out"
    TRANSFER_IN = "Transfer In"
    TRANSFER_OUT = "Transfer Out"
    SYSTEMATIC_PURCHASE = "Systematic Purchase"
    SYSTEMATIC_REDEMPTION = "Systematic Redemption"
    STAMP_DUTY = "Stamp Duty"
    DIVIDEND_PAYOUT = "Dividend Payout"
    DIVIDEND_REINVESTMENT = "Dividend Reinvestment"
    OTHERS = "Others"

class TransactionTypeEnumForStocksDemat(str, Enum):
    SETTLEMENT_CREDIT = "Settlement Credit"
    SETTLEMENT_DEBIT = "Settlement Debit"
    CORPORATE_ACTION_DEBIT = "Corporate Action Debit"
    CORPORATE_ACTION_CREDIT = "Corporate Action Credit"

class TransactionTypeEnumForStocksContractNote(str, Enum):
    BUY = "Buy"
    SELL = "Sell"
    CHARGES = "Charges"
    TAXES = "Taxes"

from pydantic import BaseModel
class Holding(BaseModel):
    security_id: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    average_cost_per_unit: Optional[float] = None
    total_cost_value: Optional[float] = None
    market_value: Optional[float] = None
    security_name: Optional[str] = None
    issuer: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    unrealized_gain_loss: Optional[float] = None
    invested_value: Optional[float] = None
    committed_value: Optional[float] = None
    drawndown_value: Optional[float] = None
    capital_returned: Optional[float] = None
    income_distributed: Optional[float] = None
    holding_date: Optional[str] = None
    price_date: Optional[str] = None

class Transaction(BaseModel):
    transaction_date: Optional[str] = None
    transaction_type: Optional[Union[TransactionTypeEnumForMutualFunds, TransactionTypeEnumForStocksDemat, TransactionTypeEnumForStocksContractNote]] = None
    security_id: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    net_amount: Optional[float] = None
    settlement_date: Optional[str] = None
    security_name: Optional[str] = None
    price: Optional[float] = None
    gross_amount: Optional[float] = None
    currency: Optional[str] = None
    counterparty: Optional[str] = None
    transaction_ref: Optional[str] = None
    transaction_description: Optional[str] = None

class Order(BaseModel):
    order_date: Optional[str] = None
    order_time: Optional[str] = None
    trade_date: Optional[str] = None
    trade_time: Optional[str] = None
    order_ref: Optional[str] = None
    trade_ref: Optional[str] = None
    transaction_type: Optional[Union[TransactionTypeEnumForMutualFunds, TransactionTypeEnumForStocksDemat, TransactionTypeEnumForStocksContractNote]] = None
    security_id: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    net_amount: Optional[float] = None
    security_name: Optional[str] = None
    price: Optional[float] = None
    gross_amount: Optional[float] = None
    currency: Optional[str] = None
    counterparty: Optional[str] = None
    order_description: Optional[str] = None

class AccountInformation(BaseModel):
    account_id: Optional[str] = None
    account_type: Optional[str] = None
    primary_holder_name: Optional[str] = None
    primary_holder_id: Optional[str] = None
    secondary_holder_name: Optional[str] = None
    secondary_holder_id: Optional[str] = None
    third_holder_name: Optional[str] = None
    third_holder_id: Optional[str] = None
    advisory_mandate: Optional[str] = None
    relationship_manager: Optional[str] = None
    base_currency: Optional[str] = None
    custodian_name: Optional[str] = None
    custodian_id: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_id: Optional[str] = None
    broker_code: Optional[str] = None

class Account(BaseModel):
    account_information: Optional[AccountInformation] = None
    holdings: Optional[List[Holding]] = None
    transactions: Optional[List[Transaction]] = None
    orders: Optional[List[Order]] = None

class StatementMetadata(BaseModel):
    statement_date: Optional[str] = None
    reporting_period_start: Optional[str] = None
    reporting_period_end: Optional[str] = None
    statement_issuer: Optional[str] = None
    statement_frequency: Optional[StatementFrequencyEnum] = None
    base_currency: Optional[str] = None
    statement_description: Optional[str] = None

class FinancialSecurityStatement(BaseModel):
    statement_metadata: StatementMetadata
    accounts: List[Account]
    class Config:
        use_enum_values = True

# --- Environment and Model Configuration ---
load_dotenv()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    raise ValueError("GOOGLE_API_KEY environment variable not set.")
genai.configure(api_key=GOOGLE_API_KEY)

# --- FastAPI App Initialization ---
app = FastAPI(
    title="Financial Statement Extraction API",
    description="Upload a PDF financial statement to extract holdings and transactions using Google Gemini.",
    version="3.0.0"
)

# ---------- CORS (allow React dev server) ----------
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,   # set False if you don't need cookies/auth
    allow_methods=["*"],
    allow_headers=["*"],
)
# ---------------------------------------------------

# --- Prompt (unchanged) ---
BASE_EXTRACTION_PROMPT = """
You are a world-class financial data extraction AI. Your task is to analyze the provided PDF financial statement and extract all holdings and transactions with extreme accuracy. You must return a single JSON object that strictly follows the 'FinancialSecurityStatement' Pydantic schema.

**CRITICAL STRUCTURE REQUIREMENTS:**
The final JSON object MUST have two top-level keys: "statement_metadata" and "accounts".
The "accounts" key must be a LIST, even if only one account is found.
All holdings and transactions for a specific account MUST be nested inside that account object within the "accounts" list.

**Example Structure:**
{
  "statement_metadata": { ... },
  "accounts": [
    {
      "account_information": { ... },
      "holdings": [ ... ],
      "transactions": [ ... ]
    }
  ]
}

**Key Extraction Instructions:**
1.  **Analyze Holistically**: Read the ENTIRE document to understand its context.
2.  **Group by Account**:
    * For the **NSDL statement**, identify accounts by **DP ID + Client ID** for Demat accounts, and by **Folio Number** for Mutual Fund Folios. Create a separate object for each in the "accounts" list.
    * For the **Standard Chartered statement**, the entire document pertains to one **Portfolio Number**. Create a single object in the "accounts" list for it.
3.  **Statement Metadata**:
    * Populate the "statement_metadata" object. Identify the issuer (e.g., "NSDL", "Standard Chartered Bank") and the reporting period.
4.  **Account Information**:
    * For each account object, populate its "account_information" field. Extract the primary account holder's name, PAN, and any account identifiers.
5.  **Holdings (Assets)**:
    * For each account, populate its "holdings" list.
    * From the **NSDL statement**, extract from "Equities (E)" and "Mutual Fund Folios (F)".
    * From the **Standard Chartered statement**, extract from "Short-Term Investments" and "Bonds".
6.  **Transactions (Activity)**:
    * For each account, populate its "transactions" list.
    * From the **NSDL statement**, extract from the "Mutual Funds Transaction Statement".
    * From the **Standard Chartered statement**, extract from "Cash Accounts Activity" and "Short-Term Investments Activity".
7.  **Data Integrity**:
    * Dates must be `YYYY-MM-DD`.
    * Numbers must be floats, without commas.
    * Use `null` for missing optional fields.
    * Map transaction descriptions to the correct `transaction_type` enum. A "Purchase" is a "Purchase", "DEPOSIT ROLLOVER" can be "Others".

Return ONLY the valid JSON object. Do not include any explanatory text or markdown formatting.
"""

class PDFProcessor:
    def __init__(self, model_name: str = "gemini-2.0-flash"):
        self.model = genai.GenerativeModel(model_name)

    async def extract_from_pdf(self, pdf_bytes: bytes) -> str:
        """
        Uploads the PDF to Gemini and returns the RAW JSON string that Gemini outputs.
        No Pydantic / schema validation.
        """
        uploaded_file = None
        temp_pdf_path = None

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_pdf:
            temp_pdf.write(pdf_bytes)
            temp_pdf_path = temp_pdf.name

        try:
            print("Uploading temporary PDF to Google AI File API...")
            uploaded_file = await asyncio.to_thread(
                genai.upload_file, path=temp_pdf_path, display_name="statement.pdf"
            )
            print(f"File uploaded: {uploaded_file.name}")

            generation_config = genai.GenerationConfig(response_mime_type="application/json")

            print("Sending request to Gemini for extraction...")
            response = await asyncio.to_thread(
                self.model.generate_content,
                [BASE_EXTRACTION_PROMPT, uploaded_file],
                generation_config=generation_config,
                request_options={"timeout": 600}
            )

            raw_json_output = response.text or ""
            print("Received response from Gemini (raw).")
            return raw_json_output

        except Exception as e:
            print(f"ERROR during Gemini processing: {e}")
            traceback.print_exc()
            raise HTTPException(status_code=500, detail="An internal error occurred during AI processing.")
        finally:
            # Cleanup uploaded files from Google and local disk
            if uploaded_file:
                try:
                    await asyncio.to_thread(genai.delete_file, uploaded_file.name)
                    print(f"Deleted uploaded file from Google AI: {uploaded_file.name}")
                except Exception as e:
                    print(f"Warning: Failed to delete Google AI file {uploaded_file.name}. Error: {e}")
            if temp_pdf_path and os.path.exists(temp_pdf_path):
                os.remove(temp_pdf_path)
                print(f"Deleted temporary local file: {temp_pdf_path}")



class TransformPayload(BaseModel):
    """
    Backward compatible payload: existing callers send
    { entityType, items, mappingPrompt }.

    New fields are optional:
      - scope: "section" | "row" (default "section")
      - row_ui_id: required when scope == "row"
      - issuer: optional, for context only
    """
    issuer: Optional[str] = None
    entityType: Literal["holding", "transaction"]
    items: List[dict]
    mappingPrompt: str
    scope: Literal["section", "row"] = "section"
    row_ui_id: Optional[str] = None


TRANSFORM_SYSTEM_PROMPT = """
You are a precise JSON transformer.

You will receive:
- INPUT_ROWS: a JSON array of row objects (each may include a special field "_ui_id")
- MAPPING_RULES: user instructions for renaming keys, changing values, switching keys/values,
  or fixing specific rows (e.g., "if description contains X set type=Y").

Rules:
1) Work ONLY with INPUT_ROWS. Do NOT add or remove rows; keep array length identical.
2) If a value is not present in the input, set it to null unless a rule specifies a literal constant.
3) Preserve the special field "_ui_id" per row EXACTLY so the client can align rows.
4) Keep numbers as numbers and dates as strings (YYYY-MM-DD) if present.
5) If MAPPING_RULES are unclear, contradictory, or require inventing data, return INPUT_ROWS unchanged.
6) Output ONLY a JSON array of objects (no wrapper object, no comments, no extra text).
"""




# --- API Endpoint ---
processor = PDFProcessor()

# NOTE: response_model REMOVED so FastAPI doesn’t validate output
@app.post("/extract")
async def extract_data(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Invalid file type. Only PDF is supported.")
    try:
        pdf_bytes = await file.read()
        raw = await processor.extract_from_pdf(pdf_bytes)
        # Return the raw JSON string exactly as produced by the model
        return Response(content=raw, media_type="application/json")
    except HTTPException as e:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "ok"}


def _safe_json_loads(s: str):
    try:
        return json.loads(s)
    except Exception:
        return None


def _reinject_missing_ui_ids(original: List[dict], transformed: List[dict]) -> List[dict]:
    """If the model dropped _ui_id anywhere, put it back by index."""
    out = []
    for i, row in enumerate(transformed):
        r = dict(row or {})
        if i < len(original) and "_ui_id" in original[i] and "_ui_id" not in r:
            r["_ui_id"] = original[i]["_ui_id"]
        out.append(r)
    return out


@app.post("/transform")
async def transform_section(payload: TransformPayload):
    """
    Transform a section (holdings OR transactions) or a single row, using user-supplied rules.
    Backward compatible with the old payload shape.

    Response shape (unchanged for your frontend):
      { success: bool, data: [...], fallback: bool, note?: str, model_raw?: str }
    - data is ALWAYS the full final section array so the UI can render it directly.
    """
    try:
        # Empty items -> passthrough
        if not isinstance(payload.items, list) or len(payload.items) == 0:
            return {"success": True, "data": payload.items, "fallback": False, "note": "No items to transform."}

        # Validate row scope request if provided
        if payload.scope == "row":
            if not payload.row_ui_id:
                return {
                    "success": True,
                    "data": payload.items,
                    "fallback": True,
                    "note": "scope='row' requested but row_ui_id missing; passthrough.",
                }
            # Find the target row by _ui_id
            idx = next((i for i, r in enumerate(payload.items) if r.get("_ui_id") == payload.row_ui_id), None)
            if idx is None:
                return {
                    "success": True,
                    "data": payload.items,
                    "fallback": True,
                    "note": "row_ui_id not found; passthrough.",
                }
            llm_rows = [payload.items[idx]]
        else:
            # default/section-wide
            llm_rows = payload.items

        # If mappingPrompt is empty/whitespace, passthrough by design
        mapping_rules = (payload.mappingPrompt or "").strip()
        if not mapping_rules:
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Empty mapping prompt; passthrough.",
            }

        # Build model input
        model = processor.model  # reuse your existing model instance
        content = [
            TRANSFORM_SYSTEM_PROMPT,
            f"MAPPING_RULES:\n{mapping_rules}\n\nINPUT_ROWS:\n{json.dumps(llm_rows, ensure_ascii=False)}"
        ]

        generation_config = genai.GenerationConfig(response_mime_type="application/json")
        response = await asyncio.to_thread(
            model.generate_content,
            content,
            generation_config=generation_config,
            request_options={"timeout": 180},
        )
        raw = (response.text or "").strip()

        parsed = _safe_json_loads(raw)

        # Guardrails: must be a list with same length as llm_rows
        if not isinstance(parsed, list):
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Model did not return a JSON array; passthrough.",
                "model_raw": raw[:1200],
            }
        if len(parsed) != len(llm_rows):
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Model changed row count; passthrough.",
                "model_raw": raw[:1200],
            }
        if any(not isinstance(x, dict) for x in parsed):
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Model output not an array of objects; passthrough.",
                "model_raw": raw[:1200],
            }

        # Ensure _ui_id stays present
        parsed = _reinject_missing_ui_ids(llm_rows, parsed)

        # If this was a row-scope transform, merge back into the full section
        if payload.scope == "row":
            final_rows = list(payload.items)
            final_rows[next(i for i, r in enumerate(payload.items) if r.get("_ui_id") == payload.row_ui_id)] = parsed[0]
            # Also make sure every row has its original _ui_id
            final_rows = _reinject_missing_ui_ids(payload.items, final_rows)
        else:
            # Section-wide result; also re-inject any missing _ui_id by index against the originals
            final_rows = _reinject_missing_ui_ids(payload.items, parsed)

        return {"success": True, "data": final_rows, "fallback": False}

    except Exception as e:
        traceback.print_exc()
        return {
            "success": False,
            "data": payload.items,
            "fallback": True,
            "note": f"Server error, passthrough. {str(e)}",
        }
    """
    Transform a whole section (all holdings OR all transactions) in one call,
    following the user's mapping prompt.
    """
    try:
        # Safety guard: empty list -> passthrough
        if not isinstance(payload.items, list) or len(payload.items) == 0:
            return {"success": True, "data": payload.items, "fallback": False, "note": "No items to transform."}

        # Build the prompt
        mapping_rules = payload.mappingPrompt.strip()
        if not mapping_rules:
            # Empty rules -> passthrough
            return {"success": True, "data": payload.items, "fallback": True, "note": "Empty mapping prompt; passthrough."}

        # Prepare request to Gemini
        model = processor.model  # reuse the same model instance
        sections_json = json.dumps(payload.items, ensure_ascii=False)

        prompt = f"""{TRANSFORM_SYSTEM_PROMPT}

Entity type: {payload.entityType}

User mapping rules (verbatim):
\"\"\"{mapping_rules}\"\"\"

Input records (JSON array):
{sections_json}

Output format:
- A pure JSON array (no extra text), where each item is the transformed object.
- Keep "_ui_id" if present.
"""

        generation_config = genai.GenerationConfig(response_mime_type="application/json")
        response = await asyncio.to_thread(
            model.generate_content,
            [prompt],
            generation_config=generation_config,
            request_options={"timeout": 600},
        )
        raw = (response.text or "").strip()

        # Try to parse JSON
        try:
            parsed = json.loads(raw)
        except Exception:
            # Fallback to passthrough if parsing fails
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Model returned non-JSON or invalid JSON. Passthrough original items.",
                "model_raw": raw[:1200],
            }

        # Validate shape (must be list of dicts)
        if not isinstance(parsed, list) or any(not isinstance(x, dict) for x in parsed):
            return {
                "success": True,
                "data": payload.items,
                "fallback": True,
                "note": "Model output not a list of objects. Passthrough original items.",
            }

        return {"success": True, "data": parsed, "fallback": False}

    except Exception as e:
        traceback.print_exc()
        return {
            "success": False,
            "data": payload.items,
            "fallback": True,
            "note": f"Server error, passthrough. {str(e)}",
        }