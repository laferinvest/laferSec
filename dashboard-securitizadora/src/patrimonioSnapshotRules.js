const monthKey = (dateValue) => {
  if (typeof dateValue === "string") return dateValue.slice(0, 7);
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export function calculateMonthVariation(rows, referenceDate = new Date()) {
  const targetMonth = monthKey(referenceDate);
  if (!targetMonth) return 0;

  const orderedRows = [...(rows || [])]
    .filter((row) => row?.data)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const monthRows = orderedRows.filter((row) => monthKey(row.data) === targetMonth);
  if (!monthRows.length) return 0;

  const previousRows = orderedRows.filter((row) => monthKey(row.data) < targetMonth);
  let previousPl = previousRows.length ? Number(previousRows[previousRows.length - 1].pl || 0) : null;
  let variation = 0;

  monthRows.forEach((row) => {
    const currentPl = Number(row.pl || 0);
    if (previousPl !== null && previousPl > 0) {
      variation += currentPl - Number(row.compraDebentures || 0) - previousPl;
    }
    previousPl = currentPl;
  });

  return Number(variation.toFixed(2));
}

export function groupSnapshotsByMonth(rows) {
  const groups = new Map();

  [...(rows || [])]
    .filter((row) => row?.data)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    .forEach((row) => {
      const month = monthKey(row.data);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(row);
    });

  return Array.from(groups.entries()).map(([mes, snapshots]) => {
    const lastSnapshot = snapshots[snapshots.length - 1];
    const periodReturn = snapshots.reduce(
      (accumulated, snapshot) => accumulated * (1 + Number(snapshot.periodReturn || 0)),
      1
    ) - 1;
    const variacao = snapshots.reduce(
      (total, snapshot) => total + Number(snapshot.variacao || 0),
      0
    );
    const compraDebentures = snapshots.reduce(
      (total, snapshot) => total + Number(snapshot.compraDebentures || 0),
      0
    );

    return {
      ...lastSnapshot,
      mes,
      snapshots,
      variacao: Number(variacao.toFixed(2)),
      periodReturn,
      retornoMesPct: periodReturn * 100,
      compraDebentures: Number(compraDebentures.toFixed(2)),
    };
  });
}
