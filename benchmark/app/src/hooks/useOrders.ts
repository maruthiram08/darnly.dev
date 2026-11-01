import { useEffect, useState } from 'react';
import { getJson } from '../lib/api';

export interface Order {
  id: string;
  date: string;
  total: number;
  status: 'processing' | 'shipped' | 'delivered';
  items: number;
}

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getJson<Order[]>('/api/order')
      .then((data) => !cancelled && setOrders(data))
      .catch(() => !cancelled && setOrders([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { orders, loading };
}
