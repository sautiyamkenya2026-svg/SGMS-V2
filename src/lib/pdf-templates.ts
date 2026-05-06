// Branded PDF templates for Golden Automotive Solutions
// Golden-brown theme, downloadable in-browser via jsPDF.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoUrl from "@/assets/golden-logo.png";

export type PdfOutputMode = "download" | "blob";

export interface PdfBuildOptions {
  mode?: PdfOutputMode;
}

export interface GeneratedPdfFile {
  blob: Blob;
  fileName: string;
}

const BROWN: [number, number, number] = [135, 75, 25];
const GOLD: [number, number, number] = [212, 160, 23];
const DARK: [number, number, number] = [40, 24, 8];
const MUTED: [number, number, number] = [110, 95, 78];

const COMPANY = {
  name: "GOLDEN AUTOMOTIVE SOLUTIONS",
  tagline: "Specialist in Spares, Bodyworks, Painting, Diagnosis & Programming.",
  address: "Located in Thindigua, Kiambu road behind Shell Petrol Station",
  phone: "0742901169 / 0710 723529",
  email: "goldenautosolutions@gmail.com",
  paybill: "Paybill: 247247  ·  Account: 0710723529",
};

async function loadLogo(): Promise<string> {
  if (!(loadLogo as any)._cache) {
    (loadLogo as any)._cache = (async () => {
      const res = await fetch(logoUrl);
      const blob = await res.blob();
      return await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      });
    })();
  }
  return (loadLogo as any)._cache as Promise<string>;
}

function fmtKsh(n: number) {
  return `KSh ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function finalizePdf(doc: jsPDF, fileName: string, options: PdfBuildOptions = {}): GeneratedPdfFile {
  const blob = doc.output("blob");
  if (options.mode !== "blob") doc.save(fileName);
  return { blob, fileName };
}

async function drawDocumentWatermark(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  try {
    const logo = await loadLogo();
    const logoW = Math.min(92, w - 30);
    const logoH = logoW / 3.4;
    doc.addImage(logo, "PNG", (w - logoW) / 2, (h - logoH) / 2 - 8, logoW, logoH);
  } catch {
    // ignore logo issues and still draw the soft text mark below
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(212, 160, 23);
  doc.text("Golden Automotive Solutions", w / 2, h / 2 + 24, { align: "center" });
}

// Centred A5 header: logo top-middle, then company name perfectly centred,
// tagline, address & contacts all centred under it. Returns the Y coord
// after the header where body content can start.
async function drawHeader(doc: jsPDF, title: string): Promise<number> {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...BROWN);
  doc.rect(0, 0, w, 3, "F");
  // Logo centered, preserve ~3.4:1 banner ratio
  const logoH = 14;
  const logoW = logoH * 3.4;
  try {
    const logo = await loadLogo();
    doc.addImage(logo, "PNG", (w - logoW) / 2, 6, logoW, logoH);
  } catch {/* ignore */}
  let y = 6 + logoH + 5; // below logo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BROWN);
  doc.text(COMPANY.name, w / 2, y, { align: "center" });
  y += 4;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(COMPANY.tagline, w / 2, y, { align: "center" });
  y += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...DARK);
  doc.text(COMPANY.address, w / 2, y, { align: "center" });
  y += 3.2;
  doc.text(`${COMPANY.phone}  ·  ${COMPANY.email}`, w / 2, y, { align: "center" });
  y += 3.2;
  doc.setTextColor(...BROWN);
  doc.text(COMPANY.paybill, w / 2, y, { align: "center" });
  y += 2.5;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(8, y, w - 8, y);
  y += 3;
  // Title pill centred
  doc.setFillColor(...BROWN);
  doc.roundedRect(w / 2 - 30, y, 60, 7, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(title, w / 2, y + 5, { align: "center" });
  return y + 11;
}

function drawFooter(doc: jsPDF, msg: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.4);
  doc.line(8, h - 14, w - 8, h - 14);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(msg, w / 2, h - 9, { align: "center" });
  doc.setFillColor(...BROWN);
  doc.rect(0, h - 3, w, 3, "F");
}

function drawMetaBox(doc: jsPDF, rows: Array<[string, string]>, x: number, y: number, w: number) {
  const lh = 5;
  doc.setDrawColor(...BROWN);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, rows.length * lh + 3, 1.2, 1.2);
  rows.forEach(([label, value], i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...BROWN);
    doc.text(label, x + 2, y + 5 + i * lh);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DARK);
    doc.text(value || "—", x + 22, y + 5 + i * lh);
  });
}

export interface InvoiceLine {
  description: string;
  qty: number;
  unit_price: number;
}

export interface InvoiceData {
  doc_no?: string;
  date?: string;
  customer_name?: string;
  customer_phone?: string;
  plate?: string;
  job_no?: string;
  lpo_no?: string;
  delivery_no?: string;
  lines: InvoiceLine[];
  vat?: boolean;
  discount?: number;
  amount_paid?: number;
  notes?: string;
  served_by?: string;
}

// Standard receipt/invoice/quotation size: A5 portrait (148 x 210 mm).
async function buildBaseDoc() {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  await drawDocumentWatermark(doc);
  return doc;
}

async function generateInvoiceLikePDF(
  title: string,
  filePrefix: string,
  data: InvoiceData,
  options: PdfBuildOptions = {},
) {
  const doc = await buildBaseDoc();
  const headerY = await drawHeader(doc, title);
  const w = doc.internal.pageSize.getWidth();
  const half = (w - 8 - 8 - 4) / 2; // two columns with 4mm gap
  drawMetaBox(doc, [
    ["Customer", data.customer_name ?? ""],
    ["Plate", data.plate ?? ""],
    ["Contact", data.customer_phone ?? ""],
  ], 8, headerY, half);
  drawMetaBox(doc, [
    ["Invoice No.", data.doc_no ?? ""],
    ["Job No.", data.job_no ?? ""],
    ["Date", data.date ?? new Date().toISOString().slice(0, 10)],
  ], 8 + half + 4, headerY, half);

  const sub = data.lines.reduce((s, l) => s + (l.qty || 0) * (l.unit_price || 0), 0);
  const discount = Number(data.discount ?? 0);
  const vat = data.vat ? (sub - discount) * 0.16 : 0;
  const total = sub - discount + vat;

  autoTable(doc, {
    startY: headerY + 22,
    head: [["QTY", "DESCRIPTION", "UNIT PRICE", "TOTAL (KSh)"]],
    body: data.lines.length
      ? data.lines.map((l) => [
          String(l.qty),
          l.description,
          fmtKsh(l.unit_price),
          fmtKsh((l.qty || 0) * (l.unit_price || 0)),
        ])
      : [["", "(no items)", "", ""]],
    theme: "grid",
    headStyles: { fillColor: BROWN, textColor: 255, fontStyle: "bold", halign: "center", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: DARK },
    columnStyles: {
      0: { cellWidth: 12, halign: "center" },
      2: { cellWidth: 24, halign: "right" },
      3: { cellWidth: 28, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 4;
  const boxW = 70;
  const boxX = w - 8 - boxW;
  const rows: Array<[string, string]> = [["SUB TOTAL", fmtKsh(sub)]];
  if (discount) rows.push(["DISCOUNT", `- ${fmtKsh(discount)}`]);
  if (data.vat) rows.push(["VAT 16%", fmtKsh(vat)]);
  rows.push(["TOTAL", fmtKsh(total)]);
  if (data.amount_paid != null) {
    rows.push(["PAID", fmtKsh(data.amount_paid)]);
    rows.push(["BALANCE", fmtKsh(Math.max(0, total - Number(data.amount_paid)))]);
  }
  rows.forEach(([k, v], i) => {
    const y = finalY + 2 + i * 5.5;
    const isTotal = k === "TOTAL";
    if (isTotal) {
      doc.setFillColor(...BROWN);
      doc.rect(boxX, y - 4, boxW, 5.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(...DARK);
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(8);
    doc.text(k, boxX + 2, y);
    doc.text(v, boxX + boxW - 2, y, { align: "right" });
  });

  if (data.notes) {
    const ny = finalY + rows.length * 5.5 + 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...BROWN);
    doc.text("Notes:", 8, ny);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...DARK);
    doc.text(doc.splitTextToSize(data.notes, w - 16), 8, ny + 4);
  }

  drawFooter(doc, "ACCOUNTS ARE DUE ON DEMAND  ·  E.&O.E");
  return finalizePdf(doc, `${filePrefix}-${data.doc_no || data.job_no || data.plate || "GAS"}.pdf`, options);
}

// ----- INVOICE -----
export async function generateInvoicePDF(data: InvoiceData, options: PdfBuildOptions = {}) {
  return generateInvoiceLikePDF("INVOICE", "Invoice", data, options);
}

export async function generateDepositInvoicePDF(data: InvoiceData, options: PdfBuildOptions = {}) {
  return generateInvoiceLikePDF("DEPOSIT INVOICE", "Deposit-Invoice", data, options);
}

// ----- QUOTATION -----
export async function generateQuotationPDF(data: InvoiceData & { valid_until?: string }, options: PdfBuildOptions = {}) {
  const doc = await buildBaseDoc();
  const headerY = await drawHeader(doc, "QUOTATION");
  const w = doc.internal.pageSize.getWidth();
  const half = (w - 8 - 8 - 4) / 2;
  drawMetaBox(doc, [
    ["To", data.customer_name ?? ""],
    ["Plate", data.plate ?? ""],
    ["Contact", data.customer_phone ?? ""],
  ], 8, headerY, half);
  drawMetaBox(doc, [
    ["Quote No.", data.doc_no ?? ""],
    ["Job No.", data.job_no ?? ""],
    ["Date", data.date ?? new Date().toISOString().slice(0, 10)],
    ["Valid Until", data.valid_until ?? ""],
  ], 8 + half + 4, headerY, half);

  const sub = data.lines.reduce((s, l) => s + (l.qty || 0) * (l.unit_price || 0), 0);
  const discount = Number(data.discount ?? 0);
  const vatBase = Math.max(0, sub - discount);
  const vat = data.vat ? vatBase * 0.16 : 0;
  const total = vatBase + vat;

  autoTable(doc, {
    startY: headerY + 24,
    head: [["#", "DESCRIPTION / SERVICE", "QTY", "UNIT PRICE", "AMOUNT (KSh)"]],
    body: (data.lines.length ? data.lines : Array(4).fill({ description: "", qty: 0, unit_price: 0 } as InvoiceLine))
      .map((l, i) => [
        String(i + 1),
        l.description,
        l.qty ? String(l.qty) : "",
        l.unit_price ? fmtKsh(l.unit_price) : "",
        l.qty && l.unit_price ? fmtKsh(l.qty * l.unit_price) : "",
      ]),
    theme: "grid",
    headStyles: { fillColor: BROWN, textColor: 255, fontStyle: "bold", halign: "center", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: DARK, minCellHeight: 5.5 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 28, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 4;
  const boxW = 70;
  const boxX = w - 8 - boxW;
  const rows: Array<[string, string]> = [["SUB TOTAL", fmtKsh(sub)]];
  if (discount) rows.push(["DISCOUNT", `- ${fmtKsh(discount)}`]);
  rows.push(["VAT 16%", fmtKsh(vat)]);
  rows.push(["TOTAL", fmtKsh(total)]);
  rows.forEach(([k, v], i) => {
    const y = finalY + 2 + i * 5.5;
    const isTotal = k === "TOTAL";
    if (isTotal) {
      doc.setFillColor(...BROWN);
      doc.rect(boxX, y - 4, boxW, 5.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(...DARK);
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(8);
    doc.text(k, boxX + 2, y);
    doc.text(v, boxX + boxW - 2, y, { align: "right" });
  });

  const ty = finalY + 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...BROWN);
  doc.text("TERMS & CONDITIONS", 8, ty);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...DARK);
  [
    "• This quotation is valid for the period shown above only.",
    "• Prices are subject to change without prior notice.",
    "• Payment to be made in full upon approval.",
    "• No goods or services released without full payment.",
    "• This is not a Tax Invoice.",
  ].forEach((line, i) => doc.text(line, 8, ty + 4 + i * 3.2));

  drawFooter(doc, "THANK YOU FOR THE OPPORTUNITY TO SERVE YOU!");
  return finalizePdf(doc, `Quotation-${data.doc_no || data.job_no || data.plate || "GAS"}.pdf`, options);
}

// ----- RECEIPT -----
export async function generateReceiptPDF(
  data: InvoiceData & { received_from?: string; payment_mode?: string },
  options: PdfBuildOptions = {},
) {
  const doc = await buildBaseDoc();
  const headerY = await drawHeader(doc, "CASH RECEIPT");
  const w = doc.internal.pageSize.getWidth();
  const half = (w - 8 - 8 - 4) / 2;
  drawMetaBox(doc, [
    ["From", data.received_from ?? data.customer_name ?? ""],
    ["Plate", data.plate ?? ""],
    ["Contact", data.customer_phone ?? ""],
    ["Mode", data.payment_mode ?? "CASH"],
  ], 8, headerY, half);
  drawMetaBox(doc, [
    ["Receipt No.", data.doc_no ?? ""],
    ["Job No.", data.job_no ?? ""],
    ["Date", data.date ?? new Date().toISOString().slice(0, 10)],
    ["Served By", data.served_by ?? ""],
  ], 8 + half + 4, headerY, half);

  const sub = data.lines.reduce((s, l) => s + (l.qty || 0) * (l.unit_price || 0), 0);
  const discount = Number(data.discount ?? 0);
  const total = sub - discount;

  autoTable(doc, {
    startY: headerY + 28,
    head: [["DESCRIPTION / SERVICE", "AMOUNT (KSh)"]],
    body: data.lines.map((l) => [l.description, fmtKsh((l.qty || 1) * (l.unit_price || 0))]),
    theme: "grid",
    headStyles: { fillColor: BROWN, textColor: 255, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: DARK },
    columnStyles: { 1: { cellWidth: 38, halign: "right" } },
    margin: { left: 8, right: 8 },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 4;
  const boxW = 70;
  const boxX = w - 8 - boxW;
  const rows: Array<[string, string]> = [
    ["SUBTOTAL", fmtKsh(sub)],
    ["DISCOUNT", discount ? `- ${fmtKsh(discount)}` : "—"],
    ["TOTAL", fmtKsh(total)],
  ];
  rows.forEach(([k, v], i) => {
    const y = finalY + 2 + i * 5.5;
    const isTotal = k === "TOTAL";
    if (isTotal) {
      doc.setFillColor(...BROWN);
      doc.rect(boxX, y - 4, boxW, 5.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(...DARK);
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(8);
    doc.text(k, boxX + 2, y);
    doc.text(v, boxX + boxW - 2, y, { align: "right" });
  });

  drawFooter(doc, "WITH THANKS  ·  GOODS ONCE SOLD ARE NOT RETURNABLE.");
  return finalizePdf(doc, `Receipt-${data.doc_no || data.job_no || data.plate || "GAS"}.pdf`, options);
}

// ----- JOB CARD -----
export interface JobCardData {
  job_no?: string;
  date?: string;
  customer_name?: string;
  customer_phone?: string;
  plate?: string;
  vehicle?: string;
  mileage_in?: number | string;
  fuel_level?: string;
  customer_complaint?: string;
  technician_diagnosis?: string;
  technicians?: string;
  accessories?: string[];
  valuables?: string;
  paint_color_code?: string;
}

export async function generateJobCardPDF(data: JobCardData, options: PdfBuildOptions = {}) {
  const doc = await buildBaseDoc();
  const headerY = await drawHeader(doc, "JOB CARD");
  const w = doc.internal.pageSize.getWidth();
  const half = (w - 8 - 8 - 4) / 2;
  drawMetaBox(doc, [
    ["Customer", data.customer_name ?? ""],
    ["Contact", data.customer_phone ?? ""],
    ["Vehicle", data.vehicle ?? ""],
    ["Plate", data.plate ?? ""],
  ], 8, headerY, half);
  drawMetaBox(doc, [
    ["Job No.", data.job_no ?? ""],
    ["Date", data.date ?? new Date().toISOString().slice(0, 10)],
    ["Mileage", String(data.mileage_in ?? "")],
    ["Paint Code", data.paint_color_code ?? "—"],
  ], 8 + half + 4, headerY, half);
  let y = headerY + 28;

  const block = (title: string, body: string) => {
    doc.setFillColor(...BROWN);
    doc.rect(8, y, w - 16, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, 10, y + 3.5);
    y += 6.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    const lines = doc.splitTextToSize(body || "—", w - 20);
    doc.text(lines, 10, y + 3);
    const blockH = Math.max(12, lines.length * 4 + 4);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.3);
    doc.rect(8, y, w - 16, blockH);
    y += blockH + 3;
  };

  block("CUSTOMER COMPLAINT", data.customer_complaint ?? "");
  block("TECHNICIAN DIAGNOSIS", data.technician_diagnosis ?? "");
  block("ACCESSORIES", (data.accessories ?? []).join(", "));
  block("VALUABLES", data.valuables ?? "");
  block("TECHNICIAN(S)", data.technicians ?? "");

  y += 4;
  doc.setDrawColor(...BROWN);
  doc.line(12, y, w / 2 - 4, y);
  doc.line(w / 2 + 4, y, w - 12, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...BROWN);
  doc.text("Customer signature", 12, y + 3);
  doc.text("Authorised by", w / 2 + 4, y + 3);

  drawFooter(doc, "Vehicle accepted in the condition described above. E.&O.E");
  return finalizePdf(doc, `JobCard-${data.job_no || data.plate || "GAS"}.pdf`, options);
}

// ----- GATE PASS -----
export interface GatePassData {
  pass_no: string;
  job_no: string;
  date?: string;
  plate: string;
  vehicle?: string;
  customer_name?: string;
  customer_phone?: string;
  technicians?: string;
  amount_paid?: number;
  total?: number;
  issued_by?: string;
  message?: string;
}

// Bus-ticket sized gate pass: 80mm x 150mm. Minimal info: just the
// pass number, plate, and "FULLY SETTLED" stamp. The gateman searches
// the number in the system to verify the vehicle is cleared.
export async function generateGatePassPDF(data: GatePassData, options: PdfBuildOptions = {}) {
  const doc = new jsPDF({ unit: "mm", format: [80, 150] });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // Top brown stripe
  doc.setFillColor(...BROWN);
  doc.rect(0, 0, w, 6, "F");

  // Tiny centred logo
  try {
    const logo = await loadLogo();
    const lh = 9;
    const lw = lh * 3.4;
    doc.addImage(logo, "PNG", (w - lw) / 2, 9, lw, lh);
  } catch {/* ignore */}

  // Centred company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BROWN);
  doc.text(COMPANY.name, w / 2, 23, { align: "center" });

  // Title
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text("GATE PASS", w / 2, 31, { align: "center" });

  // Dashed separator (ticket vibe)
  doc.setDrawColor(...MUTED);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(4, 35, w - 4, 35);
  doc.setLineDashPattern([], 0);

  // BIG pass number — the only thing the gateman needs to type
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("PASS NUMBER", w / 2, 43, { align: "center" });

  doc.setFillColor(...GOLD);
  doc.roundedRect(6, 46, w - 12, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...DARK);
  doc.text(data.pass_no, w / 2, 58, { align: "center" });

  // Plate
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("PLATE", w / 2, 69, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...BROWN);
  doc.text(data.plate || "—", w / 2, 77, { align: "center" });

  // Job number — gateman searches by this
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("JOB NUMBER", w / 2, 84, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text(data.job_no || "—", w / 2, 91, { align: "center" });

  // Date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(data.date ?? new Date().toLocaleString(), w / 2, 96, { align: "center" });

  // Settled stamp
  doc.setDrawColor(...BROWN);
  doc.setLineWidth(0.6);
  doc.roundedRect(10, 100, w - 20, 11, 2, 2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BROWN);
  doc.text("FULLY SETTLED ✓", w / 2, 107.5, { align: "center" });

  // Dashed separator
  doc.setDrawColor(...MUTED);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(4, 116, w - 4, 116);
  doc.setLineDashPattern([], 0);

  // Warm thank-you to the customer (replaces gateman instruction)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BROWN);
  doc.text("Asante sana — drive safe! 🚗✨", w / 2, 121, { align: "center" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text("It's always a pleasure serving you. See you on the next service!", w / 2, 126, { align: "center", maxWidth: w - 8 });

  // Bottom brown stripe
  doc.setFillColor(...BROWN);
  doc.rect(0, h - 4, w, 4, "F");

  return finalizePdf(doc, `GatePass-${data.pass_no}.pdf`, options);
}

// ----- PETTY CASH REPORT -----
export interface PettyCashRow {
  date: string;
  type: "opening_balance" | "payment" | "topup";
  payee?: string | null;
  contact?: string | null;
  details?: string | null;
  payment_mode?: string | null;
  payment_reference?: string | null;
  amount: number;
  transaction_cost: number;
}

export interface PettyCashReportData {
  from: string;
  to: string;
  rows: PettyCashRow[];
  generated_by?: string;
}

export async function generatePettyCashReportPDF(data: PettyCashReportData, options: PdfBuildOptions = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const headerY = await drawHeader(doc, "PETTY CASH REPORT");
  const w = doc.internal.pageSize.getWidth();

  const half = (w - 8 - 8 - 4) / 2;
  drawMetaBox(doc, [
    ["From", data.from],
    ["To", data.to],
  ], 8, headerY, half);
  drawMetaBox(doc, [
    ["Generated", new Date().toLocaleString()],
    ["By", data.generated_by ?? "—"],
  ], 8 + half + 4, headerY, half);

  let opening = 0, payments = 0, topups = 0, paymentTxnCost = 0, bankCharges = 0;
  for (const r of data.rows) {
    if (r.type === "opening_balance") opening += Number(r.amount);
    else if (r.type === "payment") {
      payments += Number(r.amount);
      paymentTxnCost += Number(r.transaction_cost || 0);
    } else if (r.type === "topup") {
      topups += Number(r.amount);
      bankCharges += Number(r.transaction_cost || 0);
    }
  }
  const txnCost = paymentTxnCost + bankCharges;
  const balance = opening + topups - payments - txnCost;

  autoTable(doc, {
    startY: headerY + 18,
    head: [["DATE", "TYPE", "PAYEE / SOURCE", "CONTACT", "DETAILS", "MODE / REF", "IN", "OUT", "TXN COST"]],
    body: data.rows.length ? data.rows.map(r => {
      const isIn = r.type === "topup" || r.type === "opening_balance";
      const typeLabel = r.type === "opening_balance" ? "Opening" : r.type === "topup" ? "Top-up" : "Payment";
      const modeRef = [r.payment_mode ?? "", r.payment_reference ?? ""].filter(Boolean).join(" · ");
      return [
        r.date,
        typeLabel,
        r.payee ?? "—",
        r.contact ?? "—",
        r.details ?? "—",
        modeRef || "—",
        isIn ? fmtKsh(Number(r.amount)) : "",
        !isIn ? fmtKsh(Number(r.amount)) : "",
        r.transaction_cost ? fmtKsh(Number(r.transaction_cost)) : "—",
      ];
    }) : [["", "", "", "", "(no entries in range)", "", "", "", ""]],
    theme: "grid",
    headStyles: { fillColor: BROWN, textColor: 255, fontStyle: "bold", fontSize: 8, halign: "center" },
    bodyStyles: { fontSize: 7.5, textColor: DARK },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 16 },
      3: { cellWidth: 22 },
      6: { cellWidth: 20, halign: "right" },
      7: { cellWidth: 20, halign: "right" },
      8: { cellWidth: 18, halign: "right" },
    },
    margin: { left: 8, right: 8 },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 6;
  // Summary box
  const boxW = 90;
  const boxX = w - 8 - boxW;
  const sumRows: Array<[string, string]> = [
    ["Opening balance", fmtKsh(opening)],
    ["Top-ups (cash in)", `+ ${fmtKsh(topups)}`],
    ["Bank charges on top-ups", `- ${fmtKsh(bankCharges)}`],
    ["Payments (cash out)", `- ${fmtKsh(payments)}`],
    ["Payment txn costs", `- ${fmtKsh(paymentTxnCost)}`],
    ["TOTAL EXPENDITURE", fmtKsh(payments + txnCost)],
    ["CLOSING BALANCE", fmtKsh(balance)],
  ];
  doc.setDrawColor(...BROWN);
  doc.setLineWidth(0.4);
  doc.roundedRect(boxX, finalY - 2, boxW, sumRows.length * 6 + 3, 1.5, 1.5);
  sumRows.forEach(([k, v], i) => {
    const y = finalY + 3 + i * 6;
    const isTotal = k === "CLOSING BALANCE";
    if (isTotal) {
      doc.setFillColor(...BROWN);
      doc.rect(boxX + 0.4, y - 4, boxW - 0.8, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(...DARK);
      doc.setFont("helvetica", k === "TOTAL EXPENDITURE" ? "bold" : "normal");
    }
    doc.setFontSize(8.5);
    doc.text(k, boxX + 3, y);
    doc.text(v, boxX + boxW - 3, y, { align: "right" });
  });

  // Page numbers + footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    drawFooter(doc, `Petty Cash Report  ·  ${data.from} → ${data.to}  ·  Page ${i} of ${pageCount}`);
  }

  return finalizePdf(doc, `PettyCash-${data.from}_to_${data.to}.pdf`, options);
}
