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

const toMoneyValue = (value: number | null | undefined) =>
  Math.max(0, Number(value || 0));

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
  Math.max(0, toMoneyValue(doc.amount) - toMoneyValue(doc.discount));

const getReceiptRecordedAmount = (doc: Pick<BillingDocument, "doc_type" | "amount" | "amount_paid">) =>
  doc.doc_type === "receipt"
    ? Math.max(toMoneyValue(doc.amount_paid), toMoneyValue(doc.amount))
    : 0;

const getDepositRecordedAmount = (doc: Pick<BillingDocument, "doc_type" | "amount_paid">) =>
  doc.doc_type === "deposit_invoice"
    ? toMoneyValue(doc.amount_paid)
    : 0;

const buildBillingBuckets = (documents: BillingDocument[]) => {
  const buckets = new Map<string, {
    invoiceNet: number;
    invoiceDay: string | null;
    invoicePaid: number;
    receiptAmount: number;
    receiptDay: string | null;
    depositPaid: number;
    depositDay: string | null;
  }>();

  documents.forEach((doc, index) => {
    const key = billingBucketKey(doc, index);
    const current = buckets.get(key) ?? {
      invoiceNet: 0,
      invoiceDay: null,
      invoicePaid: 0,
      receiptAmount: 0,
      receiptDay: null,
      depositPaid: 0,
      depositDay: null,
    };

    if (doc.doc_type === "invoice") {
      const invoiceNet = getNetInvoiceAmount(doc);
      if (invoiceNet >= current.invoiceNet) {
        current.invoiceNet = invoiceNet;
        current.invoiceDay = getBillingDocumentDay(doc);
      }
      current.invoicePaid = Math.max(current.invoicePaid, toMoneyValue(doc.amount_paid));
    } else if (doc.doc_type === "receipt") {
      const receiptAmount = getReceiptRecordedAmount(doc);
      if (receiptAmount >= current.receiptAmount) {
        current.receiptAmount = receiptAmount;
        current.receiptDay = getBillingDocumentDay(doc);
      }
    } else if (doc.doc_type === "deposit_invoice") {
      current.depositPaid += getDepositRecordedAmount(doc);
      current.depositDay = getBillingDocumentDay(doc);
    }

    buckets.set(key, current);
  });

  return Array.from(buckets.values());
};

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
  buildBillingBuckets(documents).reduce(
    (sum, bucket) => sum + (bucket.receiptAmount > 0 ? bucket.receiptAmount : bucket.invoiceNet),
    0,
  );

export const sumBilledInvoicesForDay = (documents: BillingDocument[], day: string) =>
  buildBillingBuckets(documents).reduce((sum, bucket) => {
    const billedAmount = bucket.receiptAmount > 0 ? bucket.receiptAmount : bucket.invoiceNet;
    const billedDay = bucket.receiptAmount > 0 ? bucket.receiptDay : bucket.invoiceDay;
    return billedDay === day ? sum + billedAmount : sum;
  }, 0);

export const sumRecordedPayments = (documents: BillingDocument[]) => {
  return buildBillingBuckets(documents).reduce((total, bucket) => {
    if (bucket.receiptAmount > 0) return total + bucket.receiptAmount;
    if (bucket.invoicePaid > 0) return total + bucket.invoicePaid;
    return total + bucket.depositPaid;
  }, 0);
};

export const sumRecordedPaymentsForDay = (documents: BillingDocument[], day: string) =>
  buildBillingBuckets(documents).reduce((total, bucket) => {
    if (bucket.receiptAmount > 0) {
      return bucket.receiptDay === day ? total + bucket.receiptAmount : total;
    }
    if (bucket.invoicePaid > 0) {
      return bucket.invoiceDay === day ? total + bucket.invoicePaid : total;
    }
    return bucket.depositDay === day ? total + bucket.depositPaid : total;
  }, 0);

export const sumOutstandingInvoices = (documents: BillingDocument[]) =>
  documents.reduce((sum, doc) => sum + getInvoiceOutstandingAmount(doc), 0);
