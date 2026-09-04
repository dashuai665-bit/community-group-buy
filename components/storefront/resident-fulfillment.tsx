'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client-api';

type Fulfillment = {
  completionState: 'procurement_pending' | 'no_pickup_required' | 'ready_for_payment' | 'paid_pending_pickup' | 'completed';
  paymentStatus: 'unpaid' | 'paid';
  pickupStatus: 'pending' | 'handed_over';
  pickupLocation: string | null;
  pickupWindow: string | null;
};

const labels = {
  procurement_pending: '採購尚未確認',
  no_pickup_required: '全數缺貨／無需取貨',
  ready_for_payment: '可取貨',
  paid_pending_pickup: '已付款待領取',
  completed: '已完成取貨',
};

export function ResidentFulfillment({ orderId }: { orderId: string }) {
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  useEffect(() => {
    api<{ order: { fulfillment: Fulfillment } }>(`/api/orders/${orderId}`)
      .then((result) => setFulfillment(result.order.fulfillment))
      .catch(() => undefined);
  }, [orderId]);
  if (!fulfillment) return null;
  return <section className="info-note"><strong>{labels[fulfillment.completionState]}</strong><p>付款：{fulfillment.paymentStatus === 'paid' ? '已收現金' : '未付款'} · 取貨：{fulfillment.pickupStatus === 'handed_over' ? '已交付' : '待交付'}</p>{fulfillment.pickupLocation ? <small>{fulfillment.pickupLocation} · {fulfillment.pickupWindow}</small> : null}</section>;
}
