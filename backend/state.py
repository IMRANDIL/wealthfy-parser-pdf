# state.py

from enum import Enum
from typing import List, Optional, Any, Dict, Union
from pydantic import BaseModel, Field, ConfigDict, model_validator
import json

# -------------------------
# Enumerations
# -------------------------

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

# --- NEW: Transaction Type Enums for LLM Guidance (Referenced in main.py prompt) ---

class TransactionTypeEnumForMutualFunds(str, Enum):
    PURCHASE = "PURCHASE"
    REDEMPTION = "REDEMPTION"
    SWITCH_IN = "SWITCH_IN"
    SWITCH_OUT = "SWITCH_OUT"
    DIVIDEND_REINVESTMENT = "DIVIDEND_REINVESTMENT"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"
    SYSTEMATIC_PURCHASE = "SYSTEMATIC_PURCHASE"
    SYSTEMATIC_WITHDRAWAL = "SYSTEMATIC_WITHDRAWAL"
    OTHERS = "OTHERS"

class TransactionTypeEnumForStocksDemat(str, Enum):
    SETTLEMENT_CREDIT = "SETTLEMENT_CREDIT"
    SETTLEMENT_DEBIT = "SETTLEMENT_DEBIT"
    CORPORATE_ACTION_CREDIT = "CORPORATE_ACTION_CREDIT"
    CORPORATE_ACTION_DEBIT = "CORPORATE_ACTION_DEBIT"
    PLEDGE_IN = "PLEDGE_IN"
    PLEDGE_OUT = "PLEDGE_OUT"

class TransactionTypeEnumForStocksContractNote(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    CHARGES = "CHARGES"
    TAXES = "TAXES"
    BROKERAGE = "BROKERAGE"
    OTHERS = "OTHERS"

# -------------------------
# Leaf models
# -------------------------

class Holding(BaseModel):
    model_config = ConfigDict(extra="ignore")

    security_id: Optional[str] = None
    security_name: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    market_value: Optional[float] = None
    currency: Optional[str] = None
    average_cost_per_unit: Optional[float] = None
    total_cost_value: Optional[float] = None
    unrealized_gain_loss: Optional[float] = None
    holding_date: Optional[str] = None

class Transaction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    transaction_date: Optional[str] = None
    # Accept free-form labels like "NEW DEPOSIT", "CASH", etc., but LLM guided by Enums in prompt
    transaction_type: Optional[str] = None 
    security_id: Optional[str] = None
    security_name: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    net_amount: Optional[float] = None
    currency: Optional[str] = None
    settlement_date: Optional[str] = None
    transaction_description: Optional[str] = None

class Order(BaseModel):
    model_config = ConfigDict(extra="ignore")

    order_date: Optional[str] = None
    trade_date: Optional[str] = None
    order_ref: Optional[str] = None
    transaction_type: Optional[str] = None
    security_id: Optional[str] = None
    security_name: Optional[str] = None
    security_type: Optional[SecurityTypeEnum] = None
    quantity: Optional[float] = None
    price: Optional[float] = None
    net_amount: Optional[float] = None
    currency: Optional[str] = None

# -------------------------
# Containers
# -------------------------

class AccountInformation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account_id: Optional[str] = None
    account_type: Optional[str] = None
    primary_holder_name: Optional[str] = None
    custodian_name: Optional[str] = None

class Account(BaseModel):
    model_config = ConfigDict(extra="ignore")

    account_information: AccountInformation = Field(default_factory=AccountInformation)
    holdings: List[Holding] = Field(default_factory=list)
    transactions: List[Transaction] = Field(default_factory=list)
    orders: List[Order] = Field(default_factory=list)

class StatementMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    statement_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    issuer_name: Optional[str] = None
    statement_frequency: Optional[StatementFrequencyEnum] = None

# -------------------------
# Root model that coerces Gemini shapes into canonical shape
# -------------------------

class FinancialSecurityStatement(BaseModel):
    """
    Canonical shape expected by your app:
    
      {
        "statement_metadata": {...},
        "accounts": [ ... ]
      }
    
    This model also accepts Gemini's current output:
      [
        {
          "account_id": "...",
          "statement_date": "YYYY-MM-DD",
          "holdings": [...],
          "transactions": [...]
        },
        ...
      ]
    
    Or a single flat dict of the same form. All variants are normalized to the
    canonical shape during validation.
    """
    model_config = ConfigDict(extra="ignore")

    statement_metadata: StatementMetadata = Field(default_factory=StatementMetadata)
    accounts: List[Account] = Field(default_factory=list)

    # ---------- utilities ----------
    @staticmethod
    def _dump(obj: Any) -> Any:
        """Return a plain dict for BaseModel, passthrough otherwise."""
        if isinstance(obj, BaseModel):
            return obj.model_dump()
        return obj

    @classmethod
    def _dump_list(cls, seq: Any) -> List[Any]:
        if not isinstance(seq, list):
            return []
        out: List[Any] = []
        for item in seq:
            if isinstance(item, BaseModel):
                out.append(item.model_dump())
            elif isinstance(item, dict):
                out.append(item)
            # ignore other types silently
        return out

    # ---------- validator ----------
    @model_validator(mode="before")
    @classmethod
    def _coerce_llm_shapes(cls, data: Any) -> Any:
        # If input is a JSON string, parse it first
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                return {"statement_metadata": {}, "accounts": []}

        # Already canonical dict (possibly with BaseModel values)?
        if isinstance(data, dict) and ("accounts" in data and "statement_metadata" in data):
            return cls._normalize_canonical_dict(data)

        # Gemini often returns a list of flat account dicts
        if isinstance(data, list):
            flat_items = [x for x in data if isinstance(x, (dict, BaseModel))]
            return cls._from_flat_list(flat_items)

        # Single flat dict case (one account)
        if isinstance(data, (dict, BaseModel)):
            d = cls._dump(data)
            if any(k in d for k in ("account_id", "holdings", "transactions")):
                return cls._from_single_flat_dict(d)

        # Fallback: empty canonical skeleton
        return {"statement_metadata": {}, "accounts": []}

    # ---------- helpers to build canonical dict ----------
    @classmethod
    def _normalize_canonical_dict(cls, obj: Any) -> Dict[str, Any]:
        obj = cls._dump(obj)

        sm_raw = obj.get("statement_metadata")
        sm = cls._dump(sm_raw) 
        
        # CRITICAL FIX 1: Ensure 'sm' is a dictionary before calling .get() for metadata
        if not isinstance(sm, dict):
             sm = {}

        accounts_in = obj.get("accounts") or []
        accounts_in = cls._dump_list(accounts_in)

        normalized_accounts: List[Dict[str, Any]] = []
        for acc in accounts_in:
            if not isinstance(acc, (dict, BaseModel)):
                continue
            acc = cls._dump(acc)
            ai_raw = acc.get("account_information") or {}
            ai = cls._dump(ai_raw) 
            
            # CRITICAL FIX 2: Ensure 'ai' is a dictionary before calling .get() for account info
            if not isinstance(ai, dict):
                ai = {}

            holdings = cls._dump_list(acc.get("holdings") or [])
            transactions = cls._dump_list(acc.get("transactions") or [])
            orders = cls._dump_list(acc.get("orders") or [])

            normalized_accounts.append({
                "account_information": {
                    "account_id": ai.get("account_id"),
                    "account_type": ai.get("account_type"),
                    "primary_holder_name": ai.get("primary_holder_name"),
                    "custodian_name": ai.get("custodian_name"),
                },
                "holdings": holdings,
                "transactions": transactions,
                "orders": orders,
            })

        return {
            "statement_metadata": {
                "statement_date": sm.get("statement_date"),
                "start_date": sm.get("start_date"),
                "end_date": sm.get("end_date"),
                "issuer_name": sm.get("issuer_name"),
                "statement_frequency": sm.get("statement_frequency"),
            },
            "accounts": normalized_accounts,
        }

    @classmethod
    def _from_single_flat_dict(cls, d: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "statement_metadata": {
                "statement_date": d.get("statement_date"),
                "start_date": None,
                "end_date": None,
                "issuer_name": None,
                "statement_frequency": None,
            },
            "accounts": [
                {
                    "account_information": {
                        "account_id": d.get("account_id"),
                        "account_type": None,
                        "primary_holder_name": None,
                        "custodian_name": None,
                    },
                    "holdings": cls._dump_list(d.get("holdings") or []),
                    "transactions": cls._dump_list(d.get("transactions") or []),
                    "orders": cls._dump_list(d.get("orders") or []),
                }
            ],
        }

    @classmethod
    def _from_flat_list(cls, items: List[Any]) -> Dict[str, Any]:
        accounts: List[Dict[str, Any]] = []
        statement_date = None

        for it in items:
            it = cls._dump(it)
            if not statement_date:
                statement_date = it.get("statement_date")
            accounts.append({
                "account_information": {
                    "account_id": it.get("account_id"),
                    "account_type": None,
                    "primary_holder_name": None,
                    "custodian_name": None,
                },
                "holdings": cls._dump_list(it.get("holdings") or []),
                "transactions": cls._dump_list(it.get("transactions") or []),
                "orders": cls._dump_list(it.get("orders") or []),
            })

        return {
            "statement_metadata": {
                "statement_date": statement_date,
                "start_date": None,
                "end_date": None,
                "issuer_name": None,
                "statement_frequency": None,
            },
            "accounts": accounts,
        }