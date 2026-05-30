export type OrderStatus =
  | "created"
  | "assembled"
  | "delivered"
  | "cancelled"
  | "scheduled";

export type PaymentType =
  | "paid"
  | "cash_on_delivery";

export type Currency =
  | "USD"
  | "UZS";

export type OrderType =
  | "normal"
  | "storage";

export type Warehouse = {
  id: string;
  name: string;
};

export type OrderItem = {
  name: string;
  warehouseId: string;
  warehouseName: string;
};

export type Order = {
  id: string;

  type: OrderType;

  clientName: string;
  clientPhone: string;
  address: string;

  items: OrderItem[];

  deliveryTime: string;

  paymentType: PaymentType;

  amount?: number;
  currency?: Currency;

  courierId: number;
  courierName: string;

  status: OrderStatus;

  scheduledAt?: string;

  deliveryGroupMessageId?: number;

  deliveredPhotoFileId?: string;

  createdBy: number;

  createdAt: string;

  assembledAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
};