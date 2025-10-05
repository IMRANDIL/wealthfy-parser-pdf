'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type AnyObj = Record<string, any>;

type Holding = {
  security_name?: string | null;
  security_type?: string | null;
  asset_class?: string | null;
  unit_price?: number | null;
  price?: number | null;
  quantity?: number | null;
  market_value?: number | null;
  currency?: string | null;
  isin?: string | null;
  _ui_id?: string;
};

type Transaction = {
  transaction_date?: string | null;
  date?: string | null;
  transaction_type?: string | null;
  description?: string | null;
  security_name?: string | null;
  amount?: number | null;
  net_amount?: number | null;
  currency?: string | null;
  _ui_id?: string;
};

type Account = {
  account_information?: {
    account_id?: string | null;
    account_number?: string | null;
  } | null;
  holdings?: Holding[] | null;
  transactions?: Transaction[] | null;
};

type FinancialSecurityStatement = {
  statement_metadata?: {
    issuer?: string | null;
    statement_date?: string | null;
    reporting_period_start?: string | null;
    reporting_period_end?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    period_start?: string | null;
    period_end?: string | null;
  } | null;
  accounts: Account[];
};

export default function ReviewPage() {
  const router = useRouter();
  const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

  const [loading, setLoading] = useState(true);
  const [fs, setFs] = useState<FinancialSecurityStatement | null>(null);
  const [acct, setAcct] = useState<Account | null>(null);
  const [transforming, setTransforming] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [modalEntityType, setModalEntityType] = useState<'holding' | 'transaction'>('holding');
  const [promptText, setPromptText] = useState('');

  const toNum = (v: any): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const fmtNum = (v: any) => {
    const n = toNum(v);
    return n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('extractedData');
      if (!raw || raw === 'undefined') throw new Error('No extracted data found. Please upload a PDF again.');
      const anyParsed = JSON.parse(raw);

      const parsed: FinancialSecurityStatement =
        anyParsed?.data?.accounts ? anyParsed.data :
        anyParsed?.accounts      ? anyParsed :
        (() => { throw new Error('Unexpected JSON shape in extractedData'); })();

      const firstAcc: Account = parsed?.accounts?.[0] || { holdings: [], transactions: [] };

      const holdings: Holding[] = (firstAcc.holdings || []).map((h: AnyObj, i: number) => {
        const security_type = h.security_type ?? h.asset_class ?? h.asset_type ?? null;
        const unit_price = h.unit_price ?? h.price ?? null;
        const market_value = h.market_value ?? h.total_cost_value ?? null;
        const isin = h.isin ?? h.cusip ?? h.isin_code ?? null;
        return {
          ...h,
          security_type,
          unit_price,
          market_value,
          isin,
          _ui_id: `h-${i}-${h.security_name || ''}-${isin || ''}`,
        };
      });

      const transactions: Transaction[] = (firstAcc.transactions || []).map((t: AnyObj, i: number) => ({
        ...t,
        transaction_date: t.transaction_date ?? t.date ?? null,
        amount: t.amount ?? t.net_amount ?? null,
        security_name: t.security_name ?? null,
        _ui_id: `t-${i}-${t.security_name || ''}-${t.transaction_date || t.date || ''}`,
      }));

      setFs(parsed);
      setAcct({ ...firstAcc, holdings, transactions });
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }, []);

  // section-wide transform
  const transformSection = async (entityType: 'holding' | 'transaction', mappingPrompt: string) => {
    if (!acct) return;

    const items = (entityType === 'holding' ? (acct.holdings || []) : (acct.transactions || [])) as AnyObj[];
    setTransforming(true);
    try {
      const resp = await fetch(`${API_BASE}/transform`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, items, mappingPrompt }),
      });

      const payload = await resp.json();
      if (!resp.ok) {
        alert(payload?.detail || 'Transform failed');
        setTransforming(false);
        return;
      }

      const transformedData = {
        issuer: fs?.statement_metadata?.issuer || '',
        entityType,
        fallback: !!payload?.fallback,
        note: payload?.note || '',
        originalCount: items.length,
        mappingPrompt, // keep the rules if you want them on the /transform page
        transformed: Array.isArray(payload?.data) ? payload.data : items,
      };
      sessionStorage.setItem('transformedData', JSON.stringify(transformedData));
      router.replace('/transform');
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Transform failed');
      // stay on page
      setTransforming(false);
    }
  };

  const issuerLower = (fs?.statement_metadata?.issuer || '—').trim().toLowerCase();
  const meta = fs?.statement_metadata || {};
  const statementDate =
    meta.statement_date ||
    (meta.reporting_period_start && meta.reporting_period_end
      ? `${meta.reporting_period_start} → ${meta.reporting_period_end}`
      : null) ||
    (meta.start_date && meta.end_date
      ? `${meta.start_date} → ${meta.end_date}`
      : null) ||
    (meta.period_start && meta.period_end
      ? `${meta.period_start} → ${meta.period_end}`
      : null) ||
    '—';

  const infoAny = (acct?.account_information as AnyObj) || {};
  const acctId =
    issuerLower.includes('nsdl')
      ? (infoAny.pan || infoAny.account_id || infoAny.account_number || infoAny.portfolio_number || '—')
      : (infoAny.account_id || infoAny.account_number || infoAny.portfolio_number || infoAny.pan || '—');

  const handleUploadAgain = () => {
    sessionStorage.removeItem('extractedData');
    sessionStorage.removeItem('transformedData');
    router.replace('/');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-900">Loading…</div>;
  if (!acct) return <div className="p-8 text-red-600">No data. Go back and upload a PDF.</div>;

  const holdings = acct.holdings || [];
  const txs = acct.transactions || [];

  // download helpers (strip _ui_id)
  const stripUi = (rows: AnyObj[]) => rows.map(({ _ui_id, ...rest }) => rest);

  const buildCSV = (rows: AnyObj[]) => {
    if (!rows.length) return '';
    const cols = Array.from(
      rows.reduce((set, r) => { Object.keys(r || {}).forEach(k => set.add(k)); return set; }, new Set<string>())
    );
    const esc = (v: any) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(',');
    const lines = rows.map(r => cols.map(c => esc(r?.[c])).join(','));
    return [header, ...lines].join('\n');
  };

  const download = (kind: 'holdings-json' | 'holdings-csv' | 'transactions-json' | 'transactions-csv') => {
    const src = kind.startsWith('holdings') ? holdings : txs;
    const cleaned = stripUi(src as AnyObj[]);

    if (kind.endsWith('json')) {
      const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${kind}.json`; a.click();
    } else {
      const csv = buildCSV(cleaned);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${kind}.csv`; a.click();
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gradient-to-b from-white to-blue-50 text-slate-900">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Review Extracted Data</h1>
          <p className="text-sm text-slate-700 mt-2">
            Issuer: <span className="font-medium">{fs?.statement_metadata?.issuer || '—'}</span> &nbsp;|&nbsp;
            Period: <span className="font-medium">{statementDate}</span> &nbsp;|&nbsp;
            Account: <span className="font-medium">{acctId}</span>
          </p>
        </div>
        <button
          onClick={handleUploadAgain}
          className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800"
        >
          Upload again
        </button>
      </div>

      {/* Holdings */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-wrap gap-3 justify-between items-center mb-3">
          <h2 className="text-2xl font-semibold text-slate-900">Holdings ({holdings.length})</h2>
          <div className="flex gap-2">
            {holdings.length > 0 && (
              <>
                <button
                  disabled={transforming}
                  onClick={() => { setModalEntityType('holding'); setShowModal(true); }}
                  className={`px-4 py-2 rounded-lg text-white ${transforming ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  Transform Holdings
                </button>
                <button onClick={() => download('holdings-json')} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
                  Download JSON
                </button>
                <button onClick={() => download('holdings-csv')} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
                  Download CSV
                </button>
              </>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left">Security</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Market Value</th>
                <th className="px-3 py-2 text-left">CCY</th>
                <th className="px-3 py-2 text-left">ISIN</th>
              </tr>
            </thead>
            <tbody className="text-slate-900">
              {holdings.map((h) => {
                const typ = h.security_type || h.asset_class || '—';
                const unitPrice = h.unit_price ?? h.price ?? null;
                return (
                  <tr key={h._ui_id} className="border-t">
                    <td className="px-3 py-2">{h.security_name || '—'}</td>
                    <td className="px-3 py-2">{typ}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(h.quantity)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(unitPrice)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(h.market_value)}</td>
                    <td className="px-3 py-2">{h.currency || '—'}</td>
                    <td className="px-3 py-2">{h.isin || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transactions */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-wrap gap-3 justify-between items-center mb-3">
          <h2 className="text-2xl font-semibold text-slate-900">Transactions ({txs.length})</h2>
          <div className="flex gap-2">
            {txs.length > 0 && (
              <>
                <button
                  disabled={transforming}
                  onClick={() => { setModalEntityType('transaction'); setShowModal(true); }}
                  className={`px-4 py-2 rounded-lg text-white ${transforming ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  Transform Transactions
                </button>
                <button onClick={() => download('transactions-json')} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
                  Download JSON
                </button>
                <button onClick={() => download('transactions-csv')} className="px-3 py-2 border rounded bg-white hover:bg-slate-50">
                  Download CSV
                </button>
              </>
            )}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-lg overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Description / Security</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">CCY</th>
              </tr>
            </thead>
            <tbody className="text-slate-900">
              {txs.map((t) => {
                const date = t.transaction_date || t.date || '—';
                const amt = t.amount ?? t.net_amount ?? null;
                const label = t.security_name || t.description || '—';
                return (
                  <tr key={t._ui_id} className="border-t">
                    <td className="px-3 py-2">{date}</td>
                    <td className="px-3 py-2">{t.transaction_type || '—'}</td>
                    <td className="px-3 py-2">{label}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(amt)}</td>
                    <td className="px-3 py-2">{t.currency || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for section-wide mapping rules */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl">
            <h3 className="text-xl font-bold mb-4">
              Transform {modalEntityType === 'holding' ? 'Holdings' : 'Transactions'}
            </h3>
            <p className="text-sm text-slate-600 mb-2">
              Describe how to map keys / adjust values. Example:
            </p>
            <pre className="text-xs bg-slate-50 border rounded p-2 mb-3 overflow-auto">
{`For holdings:
security_name -> name
asset_class/security_type -> type
quantity -> qty
unit_price/price -> unit_price
market_value -> market_value
currency -> ccy
isin -> isin

For transactions:
transaction_date/date -> date
transaction_type -> type
description/security_name -> description
amount/net_amount -> amount
currency -> ccy

Special cases:
- If description contains "HKAA 2.4 PERP", set type = "Interest"`}
            </pre>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Tell me how to map each field (see example above)."
              className="w-full h-36 px-3 py-2 border rounded"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setShowModal(false); setPromptText(''); }} className="px-4 py-2 border rounded">
                Cancel
              </button>
              <button
                disabled={transforming}
                onClick={() => {
                  if (!promptText.trim()) return alert('Please enter mapping rules');
                  setShowModal(false);
                  transformSection(modalEntityType, promptText.trim());
                }}
                className={`px-4 py-2 rounded text-white ${transforming ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {transforming ? 'Transforming…' : 'Transform Section'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULL-PAGE LOADING OVERLAY WHILE TRANSFORMING */}
      {transforming && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-lg px-6 py-4 text-slate-800 flex items-center gap-3">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" fill="none" stroke="currentColor" strokeWidth="4" />
            </svg>
            <span className="font-medium">Transforming section… Please wait.</span>
          </div>
        </div>
      )}
    </div>
  );
}
