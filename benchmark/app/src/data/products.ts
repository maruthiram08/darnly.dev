export interface Product {
  id: string;
  name: string;
  price: number;
  category: 'home' | 'office' | 'outdoor' | 'kitchen';
  description: string;
  sizes?: string[];
  rating: number;
}

export const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Desk Lamp', price: 34, category: 'office', description: 'A warm LED light with a weighted base.', rating: 4.6 },
  { id: 'p2', name: 'Ceramic Mug', price: 12, category: 'kitchen', description: 'Holds 350 ml. Dishwasher safe.', rating: 4.8 },
  { id: 'p3', name: 'Wool Throw Blanket', price: 58, category: 'home', description: 'Soft merino wool, 130 x 170 cm.', sizes: ['S', 'M', 'L'], rating: 4.5 },
  { id: 'p4', name: 'Trail Water Bottle', price: 22, category: 'outdoor', description: 'Keeps drinks cold for 24 hours.', rating: 4.4 },
  { id: 'p5', name: 'Hand-Stitched Leather Notebook Cover With Pen Loop And Card Pocket', price: 46, category: 'office', description: 'Fits A5 notebooks.', rating: 4.7 },
  { id: 'p6', name: 'Linen Apron', price: 28, category: 'kitchen', description: 'Adjustable neck strap, two pockets.', sizes: ['S', 'M', 'L', 'XL'], rating: 4.3 },
  { id: 'p7', name: 'Camping Lantern', price: 39, category: 'outdoor', description: 'Rechargeable, three brightness levels.', rating: 4.2 },
  { id: 'p8', name: 'Oak Cutting Board', price: 31, category: 'kitchen', description: 'Solid oak with a juice groove.', rating: 4.9 },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
