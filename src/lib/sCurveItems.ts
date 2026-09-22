export interface SCurveCostItemInput {
  activityId: string;
  itemNo: string;
  description: string;
  quantity: number;
  unitCost: number;
}

export interface SCurveCostItem extends SCurveCostItemInput {
  amount: number;
  weightPct: number;
}

export interface SCurveCostSummary {
  items: SCurveCostItem[];
  totalContractAmount: number;
  totalWeightPct: number;
}

export function computeSCurveCostSummary(items: SCurveCostItemInput[]): SCurveCostSummary {
  const normalized = items.map((item) => ({
    ...item,
    quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
    unitCost: Number.isFinite(item.unitCost) ? item.unitCost : 0,
  }));
  const totalContractAmount = normalized.reduce(
    (sum, item) => sum + item.quantity * item.unitCost,
    0,
  );
  let runningWeightPct = 0;
  const computed = normalized.map((item, index) => {
    const amount = item.quantity * item.unitCost;
    const isLast = index === normalized.length - 1;
    const weightPct =
      totalContractAmount <= 0
        ? 0
        : isLast
          ? Math.max(0, 100 - runningWeightPct)
          : Math.round(((amount / totalContractAmount) * 100) * 10000) / 10000;
    if (!isLast) runningWeightPct += weightPct;
    return {
      ...item,
      amount,
      weightPct,
    };
  });

  return {
    items: computed,
    totalContractAmount,
    totalWeightPct: computed.reduce((sum, item) => sum + item.weightPct, 0),
  };
}
