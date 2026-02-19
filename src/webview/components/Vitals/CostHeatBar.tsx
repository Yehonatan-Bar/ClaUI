import React from 'react';

interface CostHeatBarProps {
  totalCostUsd: number;
  /** Budget threshold for full red (default $1.00) */
  budgetUsd?: number;
}

export const CostHeatBar: React.FC<CostHeatBarProps> = React.memo(
  ({ totalCostUsd, budgetUsd = 1.0 }) => {
    const fillPercent = Math.min((totalCostUsd / budgetUsd) * 100, 100);

    if (totalCostUsd <= 0) return null;

    return (
      <div className="cost-heat-bar" title={`Session cost: $${totalCostUsd.toFixed(4)}`}>
        <div
          className="cost-heat-bar-fill"
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    );
  }
);
