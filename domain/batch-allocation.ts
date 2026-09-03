export interface BatchAllocation { quantity: number; status: 'open' | 'formed' }

export function planBatchAllocation(currentQuantity: number, threshold: number, addedQuantity: number): BatchAllocation[] {
  if (![currentQuantity, threshold, addedQuantity].every(Number.isSafeInteger) || currentQuantity < 0 || threshold <= 0 || addedQuantity <= 0 || currentQuantity >= threshold) {
    throw new RangeError('批次數量必須是有效整數');
  }
  const allocations: BatchAllocation[] = [];
  let remaining = currentQuantity + addedQuantity;
  while (remaining >= threshold) {
    allocations.push({ quantity: threshold, status: 'formed' });
    remaining -= threshold;
  }
  if (remaining > 0) allocations.push({ quantity: remaining, status: 'open' });
  return allocations;
}
