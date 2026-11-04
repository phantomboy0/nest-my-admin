/**
 * The showcase shop (`NMA_DEMO_SHOWCASE=1`): a home and office store with a believable catalog, two months of orders
 * and the people who run it. The README's screenshots are taken from it. The E2E seed (`../seed.ts`) stays as it is.
 *
 * Every product names a lucide icon and a hue: `scripts/render-product-images.ts` draws its pictures from them.
 */

export const SHOP_NAME = { en: 'Lumen & Oak', fa: 'لومن و اوک' };

export interface ShowcaseCategory {
  key: string;
  name: string;
  /** Hue of the category's pictures (0–360). */
  hue: number;
}

export const CATEGORIES: ShowcaseCategory[] = [
  { key: 'lighting', name: 'Lighting', hue: 36 },
  { key: 'desk', name: 'Desk & office', hue: 172 },
  { key: 'furniture', name: 'Furniture', hue: 22 },
  { key: 'kitchen', name: 'Kitchen', hue: 352 },
  { key: 'audio', name: 'Audio', hue: 228 },
  { key: 'stationery', name: 'Stationery', hue: 140 },
  { key: 'home', name: 'Home & garden', hue: 96 },
  { key: 'fa', name: 'نوشت‌افزار', hue: 280 },
];

export const TAGS = ['Bestseller', 'New', 'Eco', 'Gift idea', 'Handmade', 'Limited'] as const;
export type ShowcaseTag = (typeof TAGS)[number];

export interface ShowcaseProduct {
  sku: string;
  name: string;
  category: string;
  icon: string;
  price: number;
  compareAt?: number;
  cost: number;
  stock: number;
  status: 'draft' | 'active' | 'archived';
  releasedOn?: string;
  tags: ShowcaseTag[];
  specs: [label: string, value: string][];
  /** How many pictures it has (the first is the list's thumbnail). */
  pictures: number;
}

export const PRODUCTS: ShowcaseProduct[] = [
  { sku: 'LO-1001', name: 'Arc floor lamp', category: 'lighting', icon: 'lamp-floor', price: 289, cost: 132, stock: 14, status: 'active', releasedOn: '2025-03-04', tags: ['Bestseller'], specs: [['Height', '182 cm'], ['Bulb', 'E27, up to 60 W'], ['Finish', 'Matte black']], pictures: 3 },
  { sku: 'LO-1002', name: 'Brass desk lamp', category: 'lighting', icon: 'lamp-desk', price: 129, compareAt: 149, cost: 54, stock: 3, status: 'active', releasedOn: '2024-11-18', tags: ['Bestseller', 'Gift idea'], specs: [['Wattage', '8 W LED'], ['Cable', '1.8 m, fabric'], ['Dimmer', 'Touch, 3 steps']], pictures: 2 },
  { sku: 'LO-1003', name: 'Smoked glass pendant', category: 'lighting', icon: 'lamp-ceiling', price: 179, cost: 71, stock: 22, status: 'active', releasedOn: '2025-06-12', tags: ['New'], specs: [['Diameter', '30 cm'], ['Drop', 'Adjustable to 150 cm']], pictures: 2 },
  { sku: 'LO-1004', name: 'Linen table lamp', category: 'lighting', icon: 'lamp', price: 89, cost: 33, stock: 0, status: 'active', releasedOn: '2024-02-20', tags: ['Eco'], specs: [['Shade', 'Washed linen'], ['Base', 'Ceramic']], pictures: 1 },
  { sku: 'LO-1005', name: 'Wall sconce, pair', category: 'lighting', icon: 'lamp-wall-up', price: 158, cost: 64, stock: 9, status: 'draft', tags: ['New'], specs: [['Mounting', 'Hardwired or plug-in']], pictures: 1 },

  { sku: 'LO-2001', name: 'Low-profile keyboard', category: 'desk', icon: 'keyboard', price: 149, cost: 61, stock: 41, status: 'active', releasedOn: '2025-01-09', tags: ['Bestseller'], specs: [['Layout', '75%, ANSI'], ['Switches', 'Hot-swappable, tactile'], ['Battery', '4,000 mAh']], pictures: 3 },
  { sku: 'LO-2002', name: 'Silent wireless mouse', category: 'desk', icon: 'mouse', price: 59, cost: 19, stock: 63, status: 'active', releasedOn: '2024-09-30', tags: [], specs: [['Sensor', '4,000 DPI'], ['Battery', '70 days']], pictures: 1 },
  { sku: 'LO-2003', name: 'Monitor arm, single', category: 'desk', icon: 'monitor', price: 119, cost: 47, stock: 18, status: 'active', releasedOn: '2024-05-14', tags: [], specs: [['Fits', '17–32 in, VESA 75/100'], ['Load', '2–9 kg']], pictures: 1 },
  { sku: 'LO-2004', name: 'Walnut desk tray', category: 'desk', icon: 'paperclip', price: 45, cost: 14, stock: 4, status: 'active', releasedOn: '2025-08-01', tags: ['Handmade', 'Gift idea'], specs: [['Wood', 'Oiled walnut'], ['Size', '32 × 12 cm']], pictures: 2 },
  { sku: 'LO-2005', name: 'Wall clock, 30 cm', category: 'desk', icon: 'clock', price: 72, cost: 25, stock: 27, status: 'active', releasedOn: '2023-10-02', tags: [], specs: [['Movement', 'Silent sweep']], pictures: 1 },

  { sku: 'LO-3001', name: 'Oak lounge chair', category: 'furniture', icon: 'armchair', price: 649, compareAt: 720, cost: 290, stock: 6, status: 'active', releasedOn: '2024-04-22', tags: ['Handmade'], specs: [['Frame', 'Solid oak'], ['Seat', 'Wool bouclé'], ['Lead time', '2–3 weeks']], pictures: 3 },
  { sku: 'LO-3002', name: 'Two-seat sofa', category: 'furniture', icon: 'sofa', price: 1390, cost: 610, stock: 2, status: 'active', releasedOn: '2025-02-17', tags: ['Limited'], specs: [['Width', '168 cm'], ['Cover', 'Removable, washable']], pictures: 2 },
  { sku: 'LO-3003', name: 'Ladder bookshelf', category: 'furniture', icon: 'library', price: 260, cost: 98, stock: 11, status: 'active', releasedOn: '2023-12-05', tags: ['Eco'], specs: [['Shelves', '5'], ['Height', '190 cm']], pictures: 1 },
  { sku: 'LO-3004', name: 'Oak side table', category: 'furniture', icon: 'table', price: 210, cost: 82, stock: 0, status: 'archived', releasedOn: '2022-06-30', tags: [], specs: [['Top', 'Ø 45 cm']], pictures: 1 },

  { sku: 'LO-4001', name: 'Pour-over coffee set', category: 'kitchen', icon: 'coffee', price: 68, cost: 24, stock: 34, status: 'active', releasedOn: '2024-10-11', tags: ['Bestseller', 'Gift idea'], specs: [['Includes', 'Dripper, carafe, 40 filters'], ['Carafe', '600 ml']], pictures: 2 },
  { sku: 'LO-4002', name: 'Cast-iron casserole', category: 'kitchen', icon: 'cooking-pot', price: 189, cost: 72, stock: 12, status: 'active', releasedOn: '2024-01-26', tags: [], specs: [['Volume', '4.2 L'], ['Hobs', 'All, induction included']], pictures: 1 },
  { sku: 'LO-4003', name: 'Glass water carafe', category: 'kitchen', icon: 'glass-water', price: 32, cost: 9, stock: 88, status: 'active', releasedOn: '2025-05-20', tags: ['Eco'], specs: [['Volume', '1 L']], pictures: 1 },
  { sku: 'LO-4004', name: 'Steak knives, set of 4', category: 'kitchen', icon: 'utensils-crossed', price: 96, cost: 31, stock: 5, status: 'active', releasedOn: '2024-07-08', tags: [], specs: [['Steel', 'X50CrMoV15'], ['Handles', 'Olive wood']], pictures: 1 },

  { sku: 'LO-5001', name: 'Over-ear headphones', category: 'audio', icon: 'headphones', price: 249, compareAt: 299, cost: 104, stock: 19, status: 'active', releasedOn: '2025-04-03', tags: ['Bestseller', 'New'], specs: [['Noise cancelling', 'Hybrid, adaptive'], ['Battery', '40 h'], ['Weight', '254 g']], pictures: 3 },
  { sku: 'LO-5002', name: 'Bookshelf speakers', category: 'audio', icon: 'speaker', price: 399, cost: 170, stock: 7, status: 'active', releasedOn: '2024-08-19', tags: [], specs: [['Power', '2 × 40 W'], ['Inputs', 'Bluetooth, optical, RCA']], pictures: 2 },
  { sku: 'LO-5003', name: 'Table radio', category: 'audio', icon: 'radio', price: 119, cost: 46, stock: 0, status: 'active', releasedOn: '2023-11-14', tags: ['Gift idea'], specs: [['Bands', 'FM, DAB+']], pictures: 1 },

  { sku: 'LO-6001', name: 'Dot-grid notebook, A5', category: 'stationery', icon: 'notebook', price: 18, cost: 5, stock: 240, status: 'active', releasedOn: '2023-03-01', tags: ['Eco'], specs: [['Pages', '192, 100 g/m²'], ['Binding', 'Lay-flat']], pictures: 1 },
  { sku: 'LO-6002', name: 'Fountain pen, fine nib', category: 'stationery', icon: 'pen-line', price: 54, cost: 17, stock: 46, status: 'active', releasedOn: '2024-12-02', tags: ['Gift idea'], specs: [['Nib', 'Steel, F'], ['Fill', 'Cartridge or converter']], pictures: 1 },
  { sku: 'LO-6003', name: '2027 weekly planner', category: 'stationery', icon: 'calendar', price: 26, cost: 7, stock: 130, status: 'draft', releasedOn: '2026-11-20', tags: ['New'], specs: [['Layout', 'Week on two pages']], pictures: 1 },

  { sku: 'LO-7001', name: 'Terracotta planter', category: 'home', icon: 'plant-pot', price: 38, cost: 11, stock: 57, status: 'active', releasedOn: '2024-03-15', tags: ['Handmade', 'Eco'], specs: [['Diameter', '22 cm'], ['Drainage', 'Hole and saucer']], pictures: 1 },
  { sku: 'LO-7002', name: 'Canvas backpack', category: 'home', icon: 'backpack', price: 115, cost: 41, stock: 23, status: 'active', releasedOn: '2025-07-07', tags: [], specs: [['Volume', '22 L'], ['Laptop', 'Up to 16 in']], pictures: 2 },
  { sku: 'LO-7003', name: 'Compact umbrella', category: 'home', icon: 'umbrella', price: 34, cost: 10, stock: 3, status: 'active', releasedOn: '2024-10-01', tags: [], specs: [['Folded', '28 cm']], pictures: 1 },

  { sku: 'LO-8001', name: 'دفتر یادداشت چرمی', category: 'fa', icon: 'notebook-pen', price: 42, cost: 13, stock: 35, status: 'active', releasedOn: '2025-03-21', tags: ['Handmade', 'Gift idea'], specs: [['جلد', 'چرم طبیعی'], ['برگ', '۱۶۰ برگ']], pictures: 1 },
];

export const SUPPLIERS = [
  { name: 'Nordlys Lighting', email: 'orders@nordlys.example', phone: '+45 32 10 44 80' },
  { name: 'Atelier Brun', email: 'hello@atelier-brun.example', phone: '+33 1 84 60 22 17' },
  { name: 'Kyoto Paper Works', email: 'trade@kyoto-paper.example', phone: '+81 75 200 3141' },
  { name: 'Fieldline Audio', email: 'b2b@fieldline.example', phone: '+44 20 3808 1190' },
  { name: 'Ironclad Kitchen', email: 'sales@ironclad.example', phone: '+1 503 555 0142' },
];

export const CUSTOMERS = [
  'Maya Okafor', 'Lucas Brandt', 'Sofia Marín', 'Noah Lindqvist', 'Aiko Tanaka', 'Omar Haddad', 'Clara Weiss',
  'Daniel Reyes', 'Priya Natarajan', 'Jonas Becker', 'Leila Karimi', 'Ethan Cole', 'Hana Novak', 'Mateo Rossi',
  'Zara Ahmed', 'Felix Moreau', 'Ingrid Solberg', 'Kenji Mori', 'Amara Diallo', 'Theo Laurent', 'سارا رحیمی',
  'Elena Petrova', 'Samuel Adeyemi', 'Nora Fischer', 'Rafael Costa', 'Yuki Sato',
  'Isabel Ortega', 'Malik Johnson',
];

export const EMPLOYEES = [
  { name: 'Ava Moradi', position: 'Store manager', salary: 6800, hiredOn: '2021-02-01' },
  { name: 'Jonah Pike', position: 'Warehouse lead', salary: 4300, hiredOn: '2022-05-02' },
  { name: 'Lena Vogel', position: 'Customer support', salary: 3600, hiredOn: '2023-08-14' },
  { name: 'Reza Ahmadi', position: 'Fulfilment', salary: 3400, hiredOn: '2024-01-15' },
  { name: 'Chloé Martin', position: 'Merchandiser', salary: 4100, hiredOn: '2024-09-09' },
];

export const ARTICLES = [
  {
    title: 'How to light a small living room',
    body: '<h2>Start with three layers</h2><p>Every room needs <strong>ambient</strong>, <strong>task</strong> and <strong>accent</strong> light. In a small room one fixture rarely does all three.</p><ul><li><p>Ambient: a pendant or a ceiling flush mount, dimmable.</p></li><li><p>Task: a floor lamp beside the reading chair.</p></li><li><p>Accent: a sconce that washes one wall.</p></li></ul><h3>Colour temperature</h3><p>Stay between 2,700 K and 3,000 K for living spaces. Mixing temperatures in one room reads as a mistake.</p>',
  },
  {
    title: 'Caring for oak furniture',
    body: '<h2>Weekly</h2><p>Dust with a dry, soft cloth, along the grain.</p><h2>Twice a year</h2><p>Clean with a damp cloth and a drop of soap flakes, dry at once, then apply a thin coat of hard wax oil.</p><blockquote><p>Never place oak in direct sun for long periods: it darkens unevenly.</p></blockquote>',
  },
  {
    title: 'The pour-over ratio we use in the shop',
    body: '<p>We brew <strong>15 g of coffee to 250 g of water</strong> at 94 °C.</p><ol><li><p>Rinse the filter and warm the carafe.</p></li><li><p>Bloom with 40 g of water for 40 seconds.</p></li><li><p>Pour the rest in slow circles; finish by 3:00.</p></li></ol>',
  },
  {
    title: 'Holiday shipping dates',
    body: '<p>Order by <strong>December 16</strong> for standard delivery before the holidays, and by December 19 for express.</p><table><tbody><tr><th><p>Service</p></th><th><p>Order by</p></th></tr><tr><td><p>Standard</p></td><td><p>Dec 16</p></td></tr><tr><td><p>Express</p></td><td><p>Dec 19</p></td></tr></tbody></table>',
  },
  {
    title: 'راهنمای انتخاب دفتر یادداشت',
    body: '<h2>کاغذ</h2><p>برای خودنویس کاغذ <strong>۱۰۰ گرمی</strong> یا سنگین‌تر انتخاب کنید تا جوهر پشت برگ نزند.</p><h2>صحافی</h2><p>صحافی باز شونده روی میز صاف می‌ماند و نوشتن را راحت‌تر می‌کند.</p>',
  },
];
