// Minimal CSV parser that handles quoted fields containing commas.
// Returns an array of objects keyed by the header row.
export function parseCSV(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];

  const headers = splitCSVLine(lines[0]).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Triggers a browser download of a CSV template with the given headers.
export function downloadCSVTemplate(filename, headers, exampleRow) {
  const csv = [headers.join(','), exampleRow ? exampleRow.join(',') : ''].filter(Boolean).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Escapes a single CSV field: wraps in quotes if it contains a comma,
// quote, or newline, and doubles any internal quotes.
function escapeCSVField(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Exports an array of row objects to a downloadable CSV file.
// `columns` is an array of { key, label } — label becomes the header,
// key looks up the value on each row.
export function exportRowsToCSV(filename, columns, rows) {
  const headerLine = columns.map((c) => escapeCSVField(c.label)).join(',');
  const dataLines = rows.map((row) => columns.map((c) => escapeCSVField(row[c.key])).join(','));
  const csv = [headerLine, ...dataLines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
