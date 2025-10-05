import os
import traceback
import tempfile
import pdfplumber
import json
from typing import List, Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# --- Configuration ---
# Updated path to reflect the new structured JSON output
OUTPUT_FILE_PATH = "extracted_structured_data.json"

# --- Response Model (Keeps a simple structure for client communication) ---
class ExtractionResponse(BaseModel):
    success: bool
    message: str
    output_file: str

# --- FastAPI Application ---
app = FastAPI(
    title="Complex PDF Structured Data Extractor",
    description="Upload a PDF financial statement to perform structured table extraction using pdfplumber and save the result as JSON.",
    version="1.1.0"
)

# --- Core Structured Extraction Logic using pdfplumber ---

def extract_structured_data_and_save(pdf_bytes: bytes, output_path: str) -> Dict[str, Any]:
    """
    Extracts structured table data and raw text metadata from a PDF using pdfplumber.
    The result is saved as a JSON file at the specified output path.

    Returns the extracted structured dictionary.
    """
    
    temp_pdf_path = None
    structured_data = {
        "metadata_text": [],
        "extracted_tables": []
    }
    
    try:
        # 1. Save uploaded bytes to a temporary file (pdfplumber requires a file path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_pdf:
            temp_pdf.write(pdf_bytes)
            temp_pdf_path = temp_pdf.name
        
        # 2. Extract content using pdfplumber
        with pdfplumber.open(temp_pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                page_number = i + 1
                
                # --- A. EXTRACT TABLES (Crucial for Holdings/Transactions) ---
                # This returns clean lists of lists, fixing the LLM's linearization problem.
                tables: List[List[List[str]]] = page.extract_tables()
                
                if tables:
                    for table_idx, table_data in enumerate(tables):
                        # Only include tables that actually contain data (e.g., more than just headers)
                        if table_data and len(table_data) > 1:
                            structured_data["extracted_tables"].append({
                                "page": page_number,
                                "table_index": table_idx,
                                "hint": "LLM must classify this table as Holdings, Transactions, or other.",
                                "data": table_data
                            })
                
                # --- B. EXTRACT RAW TEXT (For general account info/metadata) ---
                raw_text = page.extract_text()
                if raw_text and raw_text.strip():
                    structured_data["metadata_text"].append({
                        "page": page_number,
                        "text": raw_text.strip()
                    })

        # 3. Save the extracted structured content to the final output file as JSON
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(structured_data, f, indent=2, ensure_ascii=False)
        
        return structured_data

    except Exception as e:
        print(f"An error occurred during structured PDF extraction: {e}")
        traceback.print_exc()
        # Re-raise the exception to be caught by the FastAPI handler
        raise Exception(f"Failed to extract structured PDF content: {str(e)}")
        
    finally:
        # 4. Clean up the temporary PDF file
        if temp_pdf_path and os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)


@app.post("/extract", response_model=ExtractionResponse)
async def extract_structured_data(file: UploadFile = File(...)):
    """
    Accepts a PDF upload via the client, extracts all structured table data 
    and metadata using pdfplumber, saves the output to 'extracted_structured_data.json', 
    and returns a success status.
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a PDF.")

    try:
        pdf_bytes = await file.read()
        structured_content = extract_structured_data_and_save(pdf_bytes, OUTPUT_FILE_PATH)
        
        table_count = len(structured_content["extracted_tables"])
        
        return JSONResponse(content={
            "success": True,
            "message": f"Structured data (including {table_count} tables) successfully extracted from '{file.filename}' and saved to '{OUTPUT_FILE_PATH}'.",
            "output_file": OUTPUT_FILE_PATH
        })
        
    except Exception as e:
        # Handle exceptions raised from the extraction function
        error_message = f"An internal server error occurred: {str(e)}"
        print(error_message)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_message)

if __name__ == "__main__":
    import uvicorn
    print("Starting FastAPI server...")
    print(f"Structured extraction results will be saved to: {OUTPUT_FILE_PATH}")
    # uvicorn.run(app, host="0.0.0.0", port=8000)
