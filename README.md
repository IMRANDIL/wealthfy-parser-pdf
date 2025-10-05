# Financial Statement Extract & Transform — README

A small full-stack app to:

1. **Extract** holdings & transactions from a PDF statement using Google Gemini,
2. **Review** the extracted rows, and
3. **Transform** them with a **user-defined prompt** (field mapping and/or row tweaks), then **download JSON/CSV**.

Front end: **Next.js (App Router)**
Back end: **FastAPI** (+ Google Generative AI SDK)

---

## Features

* **/extract (backend)** — Upload a PDF; Gemini returns a JSON object (no server-side schema validation).
* **Review page (frontend)** — Renders issuer/period/account header, tables for Holdings & Transactions, and lets the user:

  * Open a **Transform modal** and define a natural-language mapping rule for the entire section,
  * **Download raw JSON/CSV** directly (without transforming),
  * **Upload again** (clears session and returns to the upload screen).
* **/transform (backend)** — Applies the user’s mapping prompt to **all rows in the selected section**. If the prompt is unclear or invalid JSON is returned by the LLM, the API falls back to **pass-through** (original rows) and marks `fallback: true`.
* **Transform page (frontend)** — Shows transformed rows, **normalizes duplicates** and column names, and supports **Download JSON/CSV**. Going **Back to Review** clears the transformed cache; **Upload again** clears everything.

**Normalization in Transform view (client-side):**

* Holdings:

  * `unit_price = unit_price ?? price`
  * `isin = isin ?? cusip ?? isin_code`
  * `security_type = security_type ?? asset_class`
  * Hides duplicate source keys (`price`, `cusip`, `isin_code`, `asset_class`)
* Transactions:

  * `date = date ?? transaction_date`
  * `amount = amount ?? net_amount`
  * `description = description ?? security_name`
  * Hides duplicate source keys (`transaction_date`, `net_amount`, `security_name`)
* `_ui_id` is hidden from table and **removed** from downloads.

---

## Prerequisites

* **Python** 3.10+
* **Node.js** 18+ / 20+ (for the Next.js frontend)
* **Google API key** with access to **Google Generative AI** (Gemini):

  * Set `GOOGLE_API_KEY` in your environment (see below).
* **Ghostscript** — *Only required if you plan to use `camelot-py` for PDF table parsing.*
  The current `/extract` flow uses Gemini directly and **does not require** Camelot, but if you use Camelot anywhere, Ghostscript must be installed system-wide.

  Install Ghostscript:

  * macOS: `brew install ghostscript`
  * Ubuntu/Debian: `sudo apt-get update && sudo apt-get install -y ghostscript`
  * Windows: Install from the Ghostscript site, then ensure `gswin64c.exe` (or `gswin32c.exe`) is in your `PATH`.

> **Answer to “ghostscript also required right?”**
> **Yes** — *if and only if* you use `camelot-py`. The requirements file includes `camelot-py[cv]`, so have Ghostscript installed if you enable or import Camelot in your code path. The shipping `/extract` endpoint (Gemini) does not need it.

---

## Backend — FastAPI

### Environment

Create `.env` in the backend directory:

```env
GOOGLE_API_KEY=your_google_api_key_here
```

### Install

```bash
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -U pip

# If you don't plan to use Camelot, you can omit it. Otherwise, keep it.
pip install -r requirements.txt
```

**requirements.txt** (as provided)

```
fastapi>=0.115
uvicorn[standard]>=0.30
python-multipart>=0.0.9
pydantic>=2.7
python-dotenv>=1.0
google-generativeai>=0.5.0
camelot-py[cv]>=0.11.0
pandas>=2.0.0
```

> If `camelot-py[cv]` is installed but Ghostscript is missing, you’ll get runtime errors the moment Camelot is imported/used.

### Run

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

* CORS is enabled for `http://localhost:3000`. Adjust in `main.py` if needed.

### API Endpoints

#### `POST /extract`

* **Body**: `multipart/form-data`, field name `file` (PDF)
* **Returns**: Raw JSON (from Gemini) with keys:

  * `statement_metadata`: issuer, period, etc.
  * `accounts`: array with `account_information`, `holdings`, `transactions`
* **Notes**: No server-side validation; the front end stores the response in `sessionStorage.extractedData`.

**cURL example:**

```bash
curl -X POST http://127.0.0.1:8000/extract \
  -F "file=@/path/to/statement.pdf"
```

#### `POST /transform`

* **Body (JSON)**:

  ```json
  {
    "entityType": "holding",        // or "transaction"
    "items": [ { ... }, { ... } ],  // the rows to transform (from extractedData)
    "mappingPrompt": "security_name -> name; amount/net_amount -> amount; ..."
  }
  ```
* **Behavior**:

  * Applies the mapping prompt to **every** row consistently using Gemini.
  * If the prompt is **empty/unclear** or model returns **invalid JSON**, the server returns the **original** `items` and sets `"fallback": true` with a human-readable `note`.
* **Returns**:

  ```json
  {
    "success": true,
    "data": [ { ...transformedRows } ],
    "fallback": false,
    "note": "optional message"
  }
  ```

**cURL example:**

```bash
curl -X POST http://127.0.0.1:8000/transform \
  -H "Content-Type: application/json" \
  -d '{
    "entityType":"transaction",
    "items":[{"transaction_date":"2025-06-03","description":"...","amount":11250,"currency":"USD"}],
    "mappingPrompt":"transaction_date/date -> date; description -> description; amount -> amount; currency -> ccy; if description contains \"HKAA\" then type = \"Interest\""
  }'
```

#### `GET /health`

* Simple health probe: `{ "status": "ok" }`

---

## Frontend — Next.js

### Environment

Create `.env.local` in the frontend directory:

```env
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
```

### Install & Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Pages & Flow

* **Upload** → calls `POST /extract`, stores the raw response in `sessionStorage.extractedData`.

* **/review**

  * Renders two tables:

    * **Holdings** (shows `security_name`, `type`, `qty`, `unit_price`, `market_value`, `ccy`, `isin`)

      * `type` is taken from `security_type` or `asset_class`.
      * `unit_price` is shown from `unit_price` or `price`.
      * For **NSDL**, the **Account** header prefers **PAN** when available.
    * **Transactions** (shows `date`, `type`, `description/security`, `amount`, `ccy`)
  * **Transform Holdings / Transactions** → opens modal to enter mapping prompt.
    On submit:

    * Sets a **loading overlay** (blocking state),
    * Calls `POST /transform`,
    * On success: stores `{ issuer, entityType, fallback, note, originalCount, transformed }` in `sessionStorage.transformedData` and **navigates to `/transform`**,
    * On error: shows alert and **stays on the review page** (no navigation).
  * **Download JSON/CSV** — downloads the currently visible section **as-is** (after stripping `_ui_id`).
  * **Upload again** — clears both `extractedData` and `transformedData` and returns to `/`.

* **/transform**

  * Loads `sessionStorage.transformedData`.
  * **Normalizes** rows to avoid duplicates (see “Normalization” above).
  * Hides `_ui_id` from view & downloads.
  * **Download JSON/CSV** (normalized data).
  * **Back to Review** — clears `transformedData` and returns to `/review`.
  * **Upload again** — clears both caches and returns to `/`.

### Session Storage Keys

* `extractedData` — exact JSON returned by `/extract` (or `{ data: ... }` wrapper, both handled).
* `transformedData` — object used by `/transform` page:

  ```ts
  {
    issuer: string;
    entityType: 'holding' | 'transaction';
    fallback: boolean;
    note: string;
    originalCount: number;
    transformed: Array<Record<string, any>>;
    mappingPrompt?: string; // optional
  }
  ```

---

## Mapping Prompt Tips

You can mix **field remapping** and **conditional fixes** in natural language:

**Holdings (example)**

```
security_name -> security_name
asset_class/security_type -> security_type
quantity -> quantity
unit_price/price -> unit_price
market_value -> market_value
currency -> currency
isin/cusip -> isin
If security_name contains "TIME DEPOSIT", set unit_price = 100.69
```

**Transactions (example)**

```
transaction_date/date -> date
transaction_type -> type
description/security_name -> description
amount/net_amount -> amount
currency -> currency
If description contains "HKAA 2.4 PERP", set type = "Interest"
```

If the prompt is gibberish or contradictory, the backend returns a **pass-through** result with `fallback: true` and the Transform page shows a notice.

---

## Troubleshooting

* **Ghostscript errors / Camelot import fails**

  * Install Ghostscript (see “Prerequisites”).
  * If you don’t use Camelot, you may remove `camelot-py[cv]` from your requirements to avoid the dependency.
* **CORS issues**

  * Update `origins` in the FastAPI CORS config to match your frontend URL.
* **Gemini errors (401/403/429)**

  * Check `GOOGLE_API_KEY`, project access, or quotas.
* **Transform returns invalid JSON**

  * The backend will fall back to pass-through. You’ll see a notice on the Transform page.

---

## Project Structure (high-level)

```
/backend
  main.py                # FastAPI app: /extract, /transform, /health
  .env                   # GOOGLE_API_KEY=...
  requirements.txt
/frontend
  app/
    page.tsx             # upload / entry
    review/page.tsx      # review UI + transform modal + download
    transform/page.tsx   # normalized transformed view + downloads
  .env.local             # NEXT_PUBLIC_BACKEND_URL=...
```

---

## License

Internal/demo project. Adapt as needed for your environment and compliance.
