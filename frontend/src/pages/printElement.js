// Prints one part of the page in its own window, on A4 landscape.
// Printing the whole app page is unreliable because the app layout (sidebar,
// fixed-height scrolling area) cuts long tables off. A separate window with
// the same stylesheets prints every row, on as many pages as needed.
export default function printElement(el, title = 'Timetable') {
  if (!el) return;
  const w = window.open('', '_blank');
  if (!w) {
    window.alert('Please allow pop-ups for this site, then click Print again.');
    return;
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join('\n');
  w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
${styles}
<style>
  @page { size: A4 landscape; margin: 8mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body { margin: 0; padding: 0; }
  .overflow-x-auto { overflow: visible !important; }
  .tt-table, .tw-table { min-width: 0 !important; width: 100% !important; font-size: 10px; }
  .tt-table tr, .tw-table tr { break-inside: avoid; }
</style>
</head>
<body>${el.outerHTML}</body>
</html>`);
  w.document.close();
  w.focus();
  // give the stylesheets a moment to load before the print dialog opens
  setTimeout(() => w.print(), 800);
}
