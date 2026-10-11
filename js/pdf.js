// Builds the general schedule as a PDF (one page per month, laid out like the Word draft).
// Uses jsPDF, which manager.html loads from a CDN.
(function () {
  const AV = (window.AV = window.AV || {});

  // months: array of 'YYYY-MM' to include. nameOf(id) -> display name.
  function buildSchedulePdf(JsPDF, schedule, nameOf, months, U) {
    const doc = new JsPDF({ unit: 'pt', format: 'letter' });
    const W = 612, H = 792, M = 54, CW = W - 2 * M;
    const labelW = 96, colW = (CW - labelW) / 3, rowH = 22;
    const want = new Set(months);
    const byMonth = {};
    (schedule.sundays || []).forEach((d) => { if (want.has(d.slice(0, 7))) (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(d); });
    const keys = Object.keys(byMonth).sort();
    const cell = (txt, x, y, w, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(11);
      let t = String(txt || '');
      while (t.length > 1 && doc.getTextWidth(t) > w - 12) t = t.slice(0, -1);
      doc.text(t, x + 6, y + 15);
    };

    keys.forEach((m, idx) => {
      if (idx) doc.addPage();
      let y = M;
      const title = (title) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(0);
        doc.text(title, W / 2, y + 16, { align: 'center' });
        y += 44;
      };
      title('A/V Operators ' + U.fmtMonthYear(m));
      byMonth[m].forEach((d) => {
        const day = (schedule.assignments || {})[d] || {};
        const single = (schedule.isSingle || {})[d];
        const svcs = Object.keys(day).sort((a, b) => a - b);
        const need = 24 + rowH * (svcs.length + 1) + 16;
        if (y + need > H - M) { doc.addPage(); y = M; title('A/V Operators ' + U.fmtMonthYear(m) + ' (continued)'); }

        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0);
        const heading = 'Date: ' + U.parseIso(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        doc.text(heading, M, y + 14);
        const note = (schedule.notes || {})[d];
        if (note) { doc.setFont('helvetica', 'italic'); doc.setFontSize(11); doc.text('(' + note + ')', M + doc.getTextWidth(heading) + 8, y + 14); }
        y += 24;

        // header row
        doc.setFillColor(228, 234, 244); doc.rect(M, y, CW, rowH, 'F');
        ['Audio', 'Screens', 'Camera'].forEach((h, i) => cell(h, M + labelW + colW * i, y, colW, true));
        y += rowH;
        svcs.forEach((s) => {
          const label = single ? 'Combined' : ((schedule.serviceTimes || [])[s] || 'Service ' + (+s + 1));
          cell(label, M, y, labelW, true);
          cell(nameOf(day[s].audio), M + labelW, y, colW);
          cell(day[s].screens ? nameOf(day[s].screens) : '-', M + labelW + colW, y, colW);
          cell(nameOf(day[s].camera), M + labelW + colW * 2, y, colW);
          y += rowH;
        });
        // table borders
        const top = y - rowH * (svcs.length + 1);
        doc.setDrawColor(160); doc.setLineWidth(0.5);
        doc.rect(M, top, CW, rowH * (svcs.length + 1));
        for (let r = 1; r <= svcs.length; r++) doc.line(M, top + rowH * r, M + CW, top + rowH * r);
        [labelW, labelW + colW, labelW + colW * 2].forEach((x) => doc.line(M + x, top, M + x, y));
        y += 16;
      });
    });
    if (!keys.length) { doc.setFontSize(12); doc.text('No Sundays selected.', M, M + 16); }
    return doc;
  }

  AV.pdf = { buildSchedulePdf };
})();
