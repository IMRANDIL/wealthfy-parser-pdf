'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

  // Remove any accidental global dim/overlay and force strong colors
  useEffect(() => {
    const prevHtmlOpacity = document.documentElement.style.opacity;
    const prevBodyOpacity = document.body.style.opacity;
    const prevColor = document.body.style.color;
    const prevBg = document.body.style.backgroundColor;

    document.documentElement.style.opacity = '1';
    document.body.style.opacity = '1';
    document.body.style.color = 'rgb(15 23 42)';       // slate-900
    document.body.style.backgroundColor = '#ffffff';   // white

    // Kill common leftover full-screen backdrops
    const killers = [
      ...document.querySelectorAll<HTMLElement>('[data-overlay], [aria-hidden="true"][class*="backdrop"], .fixed.inset-0, .bg-black\\/50')
    ];
    killers.forEach(el => {
      const z = parseInt(getComputedStyle(el).zIndex || '0', 10);
      const isFullscreen =
        el.classList.contains('fixed') &&
        (el.classList.contains('inset-0') ||
         (getComputedStyle(el).position === 'fixed' &&
          getComputedStyle(el).top === '0px' &&
          getComputedStyle(el).left === '0px' &&
          getComputedStyle(el).right === '0px' &&
          getComputedStyle(el).bottom === '0px'));
      if (isFullscreen && z >= 40) el.remove();
    });

    return () => {
      document.documentElement.style.opacity = prevHtmlOpacity;
      document.body.style.opacity = prevBodyOpacity;
      document.body.style.color = prevColor;
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch(`${API_BASE}/extract`, { method: 'POST', body: formData });

      // Read once as text to preserve error bodies
      const text = await resp.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* leave null */ }

      if (!resp.ok) {
        const msg = json?.detail?.message || json?.detail || json?.error || text || 'Extraction failed';
        throw new Error(msg);
      }

      // Accept either { success, data } or the FS object directly
      const fsObj = json?.data ?? json;
      if (!fsObj || !fsObj.accounts) {
        throw new Error('Backend returned unexpected shape: missing "accounts".');
      }

      const toStore = JSON.stringify(fsObj);
      sessionStorage.setItem('extractedData', toStore);
      router.replace('/review');
    } catch (e: any) {
      setError(e?.message || 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gradient-to-b from-white to-blue-50 text-slate-900">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-xl p-8">
        <h1 className="text-3xl font-extrabold mb-6 tracking-tight">Wealthfy Statement Parser</h1>

        <input
          type="file"
          accept=".pdf"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setError('');
            // Clear any stale parse if user is picking a new file
            sessionStorage.removeItem('extractedData');
          }}
          className="block w-full mb-4 text-sm
                     file:mr-4 file:py-2 file:px-4 file:rounded-lg
                     file:border-0 file:bg-blue-50 file:text-blue-700
                     file:hover:bg-blue-100"
        />

        {error && (
          <p className="text-red-600 mb-4 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
        >
          {loading ? 'Processing...' : 'Upload & Extract'}
        </button>

        <div className="mt-6 text-xs text-slate-600">
          <p>Maximum file size: 20MB</p>
          <p>Supported: Bank, Mutual Fund, Demat, Portfolio statements</p>
        </div>
      </div>
    </div>
  );
}
