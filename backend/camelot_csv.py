import os
import sys
import argparse
import shutil
import camelot
import pdfplumber

def has_ghostscript() -> bool:
    # On Windows Ghostscript cmd is usually gswin64c.exe; on *nix it's 'gs'
    return shutil.which("gswin64c") is not None or shutil.which("gs") is not None

def parse_pages_arg(pdf_path: str, pages_arg: str) -> list[int]:
    if pages_arg.lower() == "all":
        with pdfplumber.open(pdf_path) as pdf:
            return list(range(1, len(pdf.pages) + 1))
    # Support things like "5-7,9,10-11"
    pages = set()
    for part in pages_arg.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            pages.update(range(int(a), int(b) + 1))
        else:
            pages.add(int(part))
    return sorted(pages)

def save_tables(tables, outdir: str, page: int, flavor: str) -> int:
    count = 0
    for idx, t in enumerate(tables):
        # Basic sanity: at least 2 rows & 2 columns after extraction
        if t.df.shape[0] >= 2 and t.df.shape[1] >= 2:
            fname = f"page-{page:02d}_table-{idx+1:02d}_{flavor}.csv"
            fpath = os.path.join(outdir, fname)
            t.to_csv(fpath)
            count += 1
    return count

def extract_all(pdf_path: str, outdir: str, pages: str = "all") -> None:
    os.makedirs(outdir, exist_ok=True)
    # DO NOT override pdf_path here
    page_list = parse_pages_arg(pdf_path, pages)
    use_lattice = has_ghostscript()

    print(f"Input: {pdf_path}")
    print(f"Output dir: {outdir}")
    print(f"Pages: {page_list}")
    print(f"Ghostscript detected: {use_lattice}")

    grand_total = 0
    for p in page_list:
        page_total = 0
        if use_lattice:
            try:
                lat = camelot.read_pdf(pdf_path, pages=str(p), flavor="lattice", strip_text=" \n")
                page_total += save_tables(lat, outdir, p, "lattice")
            except Exception as e:
                print(f"[page {p}] lattice failed: {e}")

        if page_total == 0:
            try:
                stm = camelot.read_pdf(pdf_path, pages=str(p), flavor="stream", strip_text=" \n")
                page_total += save_tables(stm, outdir, p, "stream")
            except Exception as e:
                print(f"[page {p}] stream failed: {e}")

        print(f"[page {p}] tables saved: {page_total}")
        grand_total += page_total

    print(f"Done. Total tables saved: {grand_total}")

def main():
    ap = argparse.ArgumentParser(description="Extract all tables from a PDF to CSV using Camelot.")
    ap.add_argument("pdf", help="Path to input PDF")
    ap.add_argument("--outdir", default="tables_csv", help="Directory to save CSV files (default: tables_csv)")
    ap.add_argument("--pages", default="all", help='Pages to parse, e.g. "all" or "1,3,5-7" (default: all)')
    args = ap.parse_args()

    if not os.path.isfile(args.pdf):
        print(f"ERROR: File not found: {args.pdf}")
        sys.exit(1)

    extract_all(args.pdf, args.outdir, args.pages)

if __name__ == "__main__":
    main()
