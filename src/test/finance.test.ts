import { describe, expect, it } from "vitest";
import {
  sumBilledInvoices,
  sumBilledInvoicesForDay,
  sumRecordedPayments,
  sumRecordedPaymentsForDay,
  type BillingDocument,
} from "@/lib/finance";

describe("finance helpers", () => {
  it("prefers receipt totals over invoice totals for billed summaries", () => {
    const documents: BillingDocument[] = [
      {
        job_id: "job-1",
        doc_type: "invoice",
        amount: 10000,
        discount: 3000,
        amount_paid: 7000,
        date: "2026-05-08",
      },
      {
        job_id: "job-1",
        doc_type: "receipt",
        amount: 7000,
        amount_paid: 7000,
        date: "2026-05-09",
      },
    ];

    expect(sumBilledInvoices(documents)).toBe(7000);
    expect(sumBilledInvoicesForDay(documents, "2026-05-08")).toBe(0);
    expect(sumBilledInvoicesForDay(documents, "2026-05-09")).toBe(7000);
  });

  it("avoids double-counting deposits once a receipt exists", () => {
    const documents: BillingDocument[] = [
      {
        job_id: "job-2",
        doc_type: "deposit_invoice",
        amount_paid: 3000,
        date: "2026-05-08",
      },
      {
        job_id: "job-2",
        doc_type: "receipt",
        amount: 10000,
        amount_paid: 10000,
        date: "2026-05-09",
      },
    ];

    expect(sumRecordedPayments(documents)).toBe(10000);
    expect(sumRecordedPaymentsForDay(documents, "2026-05-08")).toBe(0);
    expect(sumRecordedPaymentsForDay(documents, "2026-05-09")).toBe(10000);
  });
});
