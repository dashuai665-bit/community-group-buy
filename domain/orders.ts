export type OrderStatus='pending'|'submitted'|'partially_formed'|'formed'|'ready_for_pickup'|'completed'|'cancelled';
export function deriveFormationStatus(items:Array<{allCommitmentsFormed:boolean}>):OrderStatus {
  if(items.length===0) throw new RangeError('訂單至少需要一個品項');
  const formed=items.filter((item)=>item.allCommitmentsFormed).length;
  return formed===items.length?'formed':formed===0?'submitted':'partially_formed';
}
export function canCancelOrder(status:OrderStatus,admin=false,hasLockedBatch=false):boolean {
  if(hasLockedBatch)return false;
  return admin?['pending','submitted','partially_formed','formed'].includes(status):['pending','submitted','partially_formed'].includes(status);
}
