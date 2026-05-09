export type PettyCashEntryLike = {
  date: string;
  created_at: string;
  type: "opening_balance" | "payment" | "topup";
  amount: number;
  transaction_cost?: number | null;
};

export type PettyCashDailyLedger = {
  date: string;
  opening: number;
  payments: number;
  topups: number;
  paymentTxnCost: number;
  bankCharges: number;
  txnCost: number;
  totalExpenditure: number;
  closing: number;
};

export type PettyCashRangeSummary = {
  opening: number;
  payments: number;
  topups: number;
  paymentTxnCost: number;
  bankCharges: number;
  txnCost: number;
  balance: number;
  totalExpenditure: number;
};

export function sortPettyCashEntriesNewestFirst<T extends Pick<PettyCashEntryLike, "date" | "created_at">>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function sortPettyCashEntriesOldestFirst<T extends Pick<PettyCashEntryLike, "date" | "created_at">>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? 1 : -1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export function buildPettyCashDailyLedger(entries: PettyCashEntryLike[]): PettyCashDailyLedger[] {
  const grouped = new Map<string, PettyCashEntryLike[]>();

  sortPettyCashEntriesOldestFirst(entries).forEach((entry) => {
    const rows = grouped.get(entry.date) ?? [];
    rows.push(entry);
    grouped.set(entry.date, rows);
  });

  let carriedBalance = 0;
  const days: PettyCashDailyLedger[] = [];

  Array.from(grouped.entries())
    .sort(([left], [right]) => (left > right ? 1 : -1))
    .forEach(([date, rows]) => {
      const openingEntry = rows.find((row) => row.type === "opening_balance");
      const opening = openingEntry ? Number(openingEntry.amount || 0) : carriedBalance;

      let payments = 0;
      let topups = 0;
      let paymentTxnCost = 0;
      let bankCharges = 0;

      rows.forEach((row) => {
        if (row.type === "payment") {
          payments += Number(row.amount || 0);
          paymentTxnCost += Number(row.transaction_cost || 0);
        } else if (row.type === "topup") {
          topups += Number(row.amount || 0);
          bankCharges += Number(row.transaction_cost || 0);
        }
      });

      const txnCost = paymentTxnCost + bankCharges;
      const closing = opening + topups - payments - txnCost;
      carriedBalance = closing;

      days.push({
        date,
        opening,
        payments,
        topups,
        paymentTxnCost,
        bankCharges,
        txnCost,
        totalExpenditure: payments + txnCost,
        closing,
      });
    });

  return days;
}

export function calculatePettyCashRangeSummary(
  entries: PettyCashEntryLike[],
  options: {
    fromDate?: string;
    toDate?: string;
  } = {},
): PettyCashRangeSummary {
  const { fromDate = "", toDate = "" } = options;
  const days = buildPettyCashDailyLedger(entries);

  const inRange = days.filter((day) => {
    if (fromDate && day.date < fromDate) return false;
    if (toDate && day.date > toDate) return false;
    return true;
  });

  const balanceBeforeRange = fromDate
    ? [...days].reverse().find((day) => day.date < fromDate)?.closing ?? 0
    : 0;

  const opening = inRange.length > 0
    ? inRange[0].opening
    : balanceBeforeRange;

  const payments = inRange.reduce((sum, day) => sum + day.payments, 0);
  const topups = inRange.reduce((sum, day) => sum + day.topups, 0);
  const paymentTxnCost = inRange.reduce((sum, day) => sum + day.paymentTxnCost, 0);
  const bankCharges = inRange.reduce((sum, day) => sum + day.bankCharges, 0);
  const txnCost = paymentTxnCost + bankCharges;
  const balance = inRange.length > 0
    ? inRange[inRange.length - 1].closing
    : opening;

  return {
    opening,
    payments,
    topups,
    paymentTxnCost,
    bankCharges,
    txnCost,
    balance,
    totalExpenditure: payments + txnCost,
  };
}
