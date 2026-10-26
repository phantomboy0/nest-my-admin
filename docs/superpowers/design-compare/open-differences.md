# Open differences from the design

Differences between the real admin and the approved design that are not fixed yet. Each is fixed, or accepted by the user at the next checkpoint (accepted ones move to spec §8b).

| Screen | What differs | Why | Task |
|---|---|---|---|
| dashboard-light (top bar) | No notification bell | nest-my-admin has no notifications feature; the bell is left out (not in spec §8b yet) — ask at checkpoint A | 2b |
| products-desktop | Set filter chips have a small × to remove them; the design has none | removing one filter in one click (the chip row is the only place desktop shows active filters) — ask at checkpoint A | 2c |
| products-desktop | Set chips stay in schema order; the design shows the set «دسته‌بندی» chip first | a chip that moves while set remounts and closes its popover mid-choice | 2c |
| products-desktop | No tabs (همه/فعال/غیرفعال/ناموجود); no thumbnail, SKU line, sale price, stock badge, switch or ⋯ menu in rows; header subtitle is the count only | list tabs and computed columns | 6, 7 |
| products-desktop | Latin digits and «USD» prices | money and digits | 3 |
| products-desktop | No «خروجی Excel» button | Excel export is out of scope (spec §8b) | — |
| products-phone | Title and add button sit in the page under the top bar, not in the top bar itself; trash and select buttons are extra | the phone top bar is the shell's; select mode exists because cards are links | 2b |
| products-phone | Cards have no checkbox outside select mode, no thumbnail, switch, price or badges row | card content comes from list.mobile; computed columns | 6 |
| products-phone | The drawer's main button says «نمایش نتایج», not «نمایش ۹۶ محصول»; the switch row («فقط محصولات فعال») and the sort button are plain selects | the count needs a live query per change; boolean filters are a segmented control | 7 |
| products-phone | Floating selection bar has no ⋯ menu; bulk actions show as labelled buttons | the demo has bulk actions with labels | 8 |
| product-edit, order-detail | One column (max 4xl) instead of the design's main column + aside cards (status, record info, delete; customer, address, payment) | two-column layout and aside cards | 9 |
| product-edit | Section anchors as a tab strip (اطلاعات اصلی، قیمت و موجودی، تصاویر…) with counts; we show the layout's own tabs | record tabs with counts come with the two-column layout | 9 |
| product-edit | Header actions «پیش‌نمایش», «کپی», ⋯ and primary «انتشار»; header subtitle "last edited … by …" | per-record primary actions | 8 |
| product-edit | Image grid with main-image badge and alt-text warning; variants table with inline toggles; questions, files, history cards on the same page | inline presentation | 10 |
| order-detail | Status stepper at the top; items table with thumbnails and totals block; status history with notes | stepper and inline presentation | 10, 11 |
| order-detail | «چاپ فاکتور»، «چاپ برچسب پستی», tracking-code field, refund button | printing, tracking code and gateway refund are out of scope (spec §8b) | — |
| product-edit, order-detail | Save bar shows a subtitle of what changed in the design («قیمت فروش ویژه، ۲ تنوع»); ours says only «تغییرات ذخیره نشده» | the list of changed fields is not tracked per field label | 2d |
| all fa screens | Persian digits and ٬ separators are now the fa default; existing fa screenshot baselines change (release note) | spec §4 | 3 |
| palette | No key hints (G T, N) next to items; records show no status at the end; an empty query lists every place to go (the design shows a few) | keyboard shortcuts per item are not built | 5 |
| sidebar-expanded | Menu content is the demo's (no مشتری‌ها/پشتیبانی); the support badge is filled primary in the design, ours are all muted | demo content; badge emphasis is not configurable | 5 |
| products-desktop | No ⋯ row menu; the price header has no unit («قیمت (تومان)»); demo categories are Latin | row actions menu is Task 8; header units are not generated | 8 |
| products-phone | Cards have no SKU · category line (only SKU); the price unit sits after, as in the design, but the struck price is under it | the card shows the title's subline only | 6 |
