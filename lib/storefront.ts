export function formatMoney(minor:number,currency='TWD'){const amount=minor/100;if(currency==='TWD')return `NT$${new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(amount)}`;return new Intl.NumberFormat('zh-TW',{style:'currency',currency,maximumFractionDigits:0}).format(amount);}
export const orderStatusLabels:Record<string,string>={pending:'準備中',submitted:'湊單中',partially_formed:'部分已成團',formed:'已成團',ready_for_pickup:'可取貨',completed:'已完成',cancelled:'已取消'};
export function formatOrderStatus(status:string){return orderStatusLabels[status]??status;}
export function formatBatchProgress(committed:number,threshold:number){return `${committed} / ${threshold}`;}
export function remainingForBatch(committed:number,threshold:number){return Math.max(0,threshold-committed);}
export function createIdempotencyKey(){return globalThis.crypto?.randomUUID?.()??`order-${Date.now()}-${Math.random().toString(36).slice(2)}`;}
