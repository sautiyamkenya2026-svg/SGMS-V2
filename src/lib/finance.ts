import { toDateValue } from "@/lib/date-values";

export type BillingDocument = {
  id?: string | null;
  job_id?: string | null;
  invoice_no?: string | null;
  plate?: string | null;
  doc_type?: string | null;
  amount?: number | null;
  amount_paid?: number | null;
  discount?: number | null;
  date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const normalizeKeyPart = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase();

const billingBucketKey = (doc: BillingDocument, index: number) => {
  if (doc.job_id) return `job:${doc.job_id}`;

  const invoiceNo = normalizeKeyPart(doc.invoice_no);
  if (invoiceNo) return `invoice:${invoiceNo}`;

  if (doc.id) return `id:${doc.id}`;

  const plate = normalizeKeyPart(doc.plate).replace(/\s+/g, "");
  if (plate) return `plate:${plate}:${String(doc.doc_type ?? "")}`;

  return `row:${index}`;
};

export const isFinalInvoiceDocument = (doc: Pick<BillingDocument, "doc_type">) =>
  doc.doc_type === "invoice";

export const isCollectedPaymentDocument = (doc: Pick<BillingDocument, "doc_type">) =>
  doc.doc_type === "receipt" || doc.doc_type === "deposit_invoice";

export const getNetInvoiceAmount = (doc: Pick<BillingDocument, "amount" | "discount">) =>
  Math.max(0, Number(doc.amount || 0) - Number(doc.discount || 0));

export const getInvoiceOutstandingAmount = (
  doc: Pick<BillingDocument, "doc_type" | "amount" | "amount_paid" | "discount">,
) =>
  isFinalInvoiceDocument(doc)
    ? Math.max(0, getNetInvoiceAmount(doc) - Number(doc.amount_paid || 0))
    : 0;

export const getBillingDocumentDay = (
  doc: Pick<BillingDocument, "date" | "created_at" | "updated_at">,
) => toDateValue(doc.date ?? doc.updated_at ?? doc.created_at);

export const sumBilledInvoices = (documents: BillingDocument[]) =>
  documents.reduce((sum, doc) => (
    isFinalInvoiceDocument(doc)
      ? sum + getNetInvoiceAmount(doc)
      : sum
  ), 0);

export const sumBilledInvoicesForDay = (documents: BillingDocument[], day: string) =>
  documents.reduce((sum, doc) => (
    isFinalInvoiceDocument(doc) && getBillingDocumentDay(doc) === day
      ? sum + getNetInvoiceAmount(doc)
      : sum
  ), 0);

export const sumRecordedPayments = (documents: BillingDocument[]) => {
  const buckets = new Map<string, {
    invoicePaid: number;
    depositPaid: number;
    receiptPaid: number;
    hasInvoice: boolean;
  }>();

  documents.forEach((doc, index) => {
    const key = billingBucketKey(doc, index);
    const current = buckets.get(key) ?? {
      invoicePaid: 0,
      depositPaid: 0,
      receiptPaid: 0,
      hasInvoice: false,
    };
    const amountPaid = Math.max(0, Number(doc.amount_paid || 0));

    if (doc.doc_type === "invoice") {
      current.hasInvoice = true;
      current.invoicePaid = Math.max(current.invoicePaid, amountPaid);
    } else if (doc.doc_type === "deposit_invoice") {
      current.depositPaid += amountPaid;
    } else if (doc.doc_type === "receipt") {
      current.receiptPaid += amountPaid;
    }

    buckets.set(key, current);
  });

  let total = 0;
  buckets.forEach((bucket) => {
    const documentPayments = bucket.depositPaid + bucket.receiptPaid;
    total += bucket.hasInvoice
      ? Math.max(bucket.invoicePaid, documentPayments)
      : documentPayments;
  });
  return total;
};

export const sumOutstandingInvoices = (documents: BillingDocument[]) =>
  documents.reduce((sum, doc) => sum + getInvoiceOutstandingAmount(doc), 0);
