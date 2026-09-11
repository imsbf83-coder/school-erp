import { useState } from 'react';
import { parseCSV, downloadCSVTemplate } from '../utils/csv';

/**
 * A drop-in CSV import panel.
 * - templateHeaders/templateExample: for the downloadable template
 * - onImport(rows): called with parsed row objects; must return the API result
 *   ({ created, failed, errors: [{row, message, ...}] })
 */
export default function CSVImportPanel({ title, templateFilename, templateHeaders, templateExample, onImport }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setParseError('');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCSV(reader.result);
        if (parsed.length === 0) {
          setParseError('This file has no data rows.');
          return;
        }
        setRows(parsed);
      } catch (err) {
        setParseError('Could not read this file. Make sure it is a valid CSV.');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await onImport(rows);
      setResult(res);
    } catch (err) {
      setParseError(err.response?.data?.error || 'Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        <button
          type="button"
          onClick={() => downloadCSVTemplate(templateFilename, templateHeaders, templateExample)}
          className="text-xs text-brass-dark hover:underline"
        >
          Download CSV template
        </button>
      </div>

      <input
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="text-sm mb-3 block"
      />

      {parseError && <p className="text-absent text-sm mb-3">{parseError}</p>}

      {rows.length > 0 && !result && (
        <div className="mb-3">
          <p className="text-sm text-slate2 mb-3">
            Found <span className="font-medium text-ink">{rows.length}</span> row{rows.length === 1 ? '' : 's'} in {fileName}. Review the column headers match the template, then import.
          </p>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90 disabled:opacity-50"
          >
            {importing ? 'Importing…' : `Import ${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <p className="text-sm mb-2">
            <span className="text-present font-medium">{result.created} created</span>
            {result.failed > 0 && <span className="text-absent font-medium ml-3">{result.failed} failed</span>}
          </p>
          {result.errors?.length > 0 && (
            <div className="bg-absent/5 border border-absent/20 rounded-md p-3 max-h-48 overflow-y-auto">
              {result.errors.map((e, idx) => (
                <p key={idx} className="text-xs text-absent mb-1">
                  Row {e.row} ({e.admissionNumber || e.employeeId}): {e.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
