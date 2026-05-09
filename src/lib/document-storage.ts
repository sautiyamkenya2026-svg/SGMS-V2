import { supabase } from "@/integrations/supabase/client";
import {
  generateDepositInvoicePDF,
  generateGatePassPDF,
  generateInvoicePDF,
  generateJobCardPDF,
  generateQuotationPDF,
  generateReceiptPDF,
  type GatePassData,
  type GeneratedPdfFile,
  type InvoiceData,
  type JobCardData,
} from "@/lib/pdf-templates";

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

export type InvoicePdfKind = "quotation" | "deposit_invoice" | "invoice" | "receipt";

export interface StoredPdfFile {
  fileName: string;
  path: string;
  url: string;
}

function withCacheBust(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

async function uploadPdf(path: string, pdf: GeneratedPdfFile): Promise<StoredPdfFile> {
  return uploadGeneratedFile({
    path,
    file: pdf.blob,
    fileName: pdf.fileName,
    contentType: "application/pdf",
  });
}

async function uploadGeneratedFile({
  path,
  file,
  fileName,
  contentType,
}: {
  path: string;
  file: Blob;
  fileName: string;
  contentType: string;
}): Promise<StoredPdfFile> {
  const { error } = await supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).upload(path, file, {
    upsert: true,
    cacheControl: "60",
    contentType,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).getPublicUrl(path);
  return {
    fileName,
    path,
    url: withCacheBust(data.publicUrl),
  };
}

export async function storeInvoiceDocumentPdf({
  invoiceId,
  kind,
  data,
  paymentMode,
  receivedFrom,
}: {
  invoiceId: string;
  kind: InvoicePdfKind;
  data: InvoiceData;
  paymentMode?: string | null;
  receivedFrom?: string | null;
}) {
  let pdf: GeneratedPdfFile;

  if (kind === "quotation") {
    pdf = await generateQuotationPDF(data, { mode: "blob" });
  } else if (kind === "deposit_invoice") {
    pdf = await generateDepositInvoicePDF(data, { mode: "blob" });
  } else if (kind === "receipt") {
    pdf = await generateReceiptPDF({
      ...data,
      received_from: receivedFrom ?? data.customer_name,
      payment_mode: (paymentMode ?? "cash").toUpperCase(),
    }, { mode: "blob" });
  } else {
    pdf = await generateInvoicePDF(data, { mode: "blob" });
  }

  return uploadPdf(`invoices/${invoiceId}/${kind}.pdf`, pdf);
}

export async function storeJobCardPdf({
  jobId,
  data,
}: {
  jobId: string;
  data: JobCardData;
}) {
  const pdf = await generateJobCardPDF(data, { mode: "blob" });
  return uploadPdf(`jobs/${jobId}/job-card.pdf`, pdf);
}

export async function storeGatePassPdf({
  gatePassId,
  data,
}: {
  gatePassId: string;
  data: GatePassData;
}) {
  const pdf = await generateGatePassPDF(data, { mode: "blob" });
  return uploadPdf(`gate-passes/${gatePassId}/gate-pass.pdf`, pdf);
}

export async function storeGeneratedTextFile({
  path,
  fileName,
  contents,
  contentType,
}: {
  path: string;
  fileName: string;
  contents: string;
  contentType: string;
}) {
  const file = new Blob([contents], { type: contentType });
  return uploadGeneratedFile({ path, file, fileName, contentType });
}

export async function storeGeneratedPdfFile({
  path,
  pdf,
}: {
  path: string;
  pdf: GeneratedPdfFile;
}) {
  return uploadPdf(path, pdf);
}

export function reserveDocumentWindow() {
  if (typeof window === "undefined") return null;
  try {
    return window.open("", "_blank");
  } catch {
    return null;
  }
}

export function closeReservedDocumentWindow(target: Window | null | undefined) {
  if (!target || target.closed) return;
  try {
    target.close();
  } catch {
    // ignore close errors on blocked popup windows
  }
}

export function openStoredDocumentUrl(url: string, target?: Window | null) {
  if (typeof window === "undefined") return;

  if (target && !target.closed) {
    target.location.href = url;
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}
