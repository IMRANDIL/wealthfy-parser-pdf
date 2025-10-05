'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type AnyObj = Record<string, any>;

export default function TransformSummaryPage() {
  const router = useRouter();
  const [data, setData] = useState<{
    issuer?: string;
    entityType?: 'holding' | 'transaction';
    fallback?: boolean;
    note?: string;
    originalCount?: number;
    transformed?: AnyObj[];
    mappingPrompt?: string;
  } | null>(null);

  // ---- canonicalization helpers ----
  const normalizeHolding = (r: AnyObj) => {
    const out: AnyObj = { ...r };

    // prefer canonical keys
    out.unit_price = out.unit_price ?? out.price ?? null;
    out.isin = out.isin ?? out.cusip ?? out.isin_code ?? null;
    out.security_type = out.security_type ?? out.asset_class ?? null;

    // drop duplicates
    delete out.price;
    delete out.cusip;
    delete out.isin_code;
    delete out.asset_class;

    return out;
  };

  const normalizeTransaction = (r: AnyObj) => {
    const out: AnyObj = { ...r };

    // prefer canonical keys
    out.date = out.date ?? out.transaction_date ?? null;
    out.amount = out.amount ?? out.net_amount ?? null;
    out.description = out.description ?? out.security_name ?? null;

    // drop duplicates
    delete out.transaction_date;
    delete out.net_amount;
    delete out.security_name;

    return out;
  };

  const normalizeRows = (rows: AnyObj[] = [], entity?: 'holding' | 'transaction') =>
    rows.map(row => (entity === 'holding' ? normalizeHolding(row) : normalizeTransaction(row)));

  // ---- load & normalize once ----
  useEffect(() => {
    const raw = sessionStorage.getItem('transformedData');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        issuer?: string;
        entityType?: 'holding' | 'transaction';
        fallback?: boolean;
        note?: string;
        originalCount?: number;
        transformed?: AnyObj[];
        mappingPrompt?: string;
      };

      const normalized = normalizeRows(parsed.transformed || [], parsed.entityType);
      setData({ ...parsed, transformed: normalized });
    } catch {
      // ignore
    }
  }, []);

  const handleUploadAgain = () => {
    sessionStorage.removeItem('extractedData');
    sessionStorage.removeItem('transformedData');
    router.replace('/');
  };

  const handleBackToReview = () => {
    sessionStorage.removeItem('transformedData'); // clear as requested
    router.replace('/review');
  };

  // Helpers to strip _ui_id for downloads
  const stripUiId = (rows: AnyObj[] = []) =>
    rows.map(({ _ui_id, ...rest }) => rest);

  const downloadJSON = () => {
    if (!data?.transformed) return;
    const cleaned = stripUiId(data.transformed);
    const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `transformed_${data.entityType || 'section'}.json`;
    a.click();
  };

  const csv = useMemo(() => {
    if (!data?.transformed || data.transformed.length === 0) return '';
    const cleaned = stripUiId(data.transformed);

    // column order: prefer a nice default, then append any extras
    const first = cleaned[0] || {};
    const baseCols =
      (data?.entityType === 'holding')
        ? ['security_name', 'quantity', 'unit_price', 'market_value', 'currency', 'security_type', 'isin']
        : ['date', 'type', 'description', 'amount', 'currency'];
    const extras = Object.keys(first).filter(k => !['_ui_id', ...baseCols].includes(k));
    const cols = [...baseCols.filter(k => k in first), ...extras];

    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(',');
    const rows = cleaned.map(r => cols.map(c => esc(r?.[c])).join(','));
    return [header, ...rows].join('\n');
  }, [data]);

  const downloadCSV = () => {
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `transformed_${data?.entityType || 'section'}.csv`;
    a.click();
  };

  if (!data) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center text-slate-900">
        No transformed data. Go back to Review.
      </div>
    );
  }

  const rows = data.transformed || [];
  const first = rows[0] || {};

  // visible columns: ordered + extras, hide _ui_id
  const baseOrder =
    (data.entityType === 'holding')
      ? ['security_name', 'quantity', 'unit_price', 'market_value', 'currency', 'security_type', 'isin']
      : ['date', 'type', 'description', 'amount', 'currency'];
  const extras = Object.keys(first).filter(k => !['_ui_id', ...baseOrder].includes(k));
  const visibleCols = [...baseOrder.filter(k => k in first), ...extras];

  return (
    <div className="min-h-screen p-8 bg-gradient-to-b from-white to-blue-50 text-slate-900">
      <div className="max-w-7xl mx-auto mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Transformed {data.entityType === 'holding' ? 'Holdings' : 'Transactions'}
          </h1>
          <p className="text-sm text-slate-700 mt-2">
            Issuer: <span className="font-medium">{data.issuer || '—'}</span>
            {typeof data.originalCount === 'number' && (
              <> &nbsp;|&nbsp; Items: <span className="font-medium">{data.originalCount}</span></>
            )}
          </p>
          {data.fallback && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
              Notice: {data.note || 'Could not interpret mapping rules; showing original items.'}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={handleBackToReview} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
            Back to Review
          </button>
          <button onClick={handleUploadAgain} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
            Upload again
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mb-4 flex gap-3">
        <button onClick={downloadJSON} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
          Download JSON
        </button>
        <button onClick={downloadCSV} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
          Download CSV
        </button>
      </div>

      <div className="max-w-7xl mx-auto bg-white rounded-xl shadow-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              {visibleCols.length > 0
                ? visibleCols.map((k) => (<th key={k} className="px-3 py-2 text-left">{k}</th>))
                : <th className="px-3 py-2 text-left">No data</th>}
            </tr>
          </thead>
          <tbody className="text-slate-900">
            {rows.map((row: AnyObj, idx: number) => (
              <tr key={row?._ui_id || idx} className="border-t">
                {visibleCols.map((k) => (
                  <td key={`${idx}-${k}`} className="px-3 py-2">
                    {row?.[k] === null || row?.[k] === undefined ? '—' : String(row?.[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
