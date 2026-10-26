# Open differences from the design

Differences between the real admin and the approved design that are not fixed yet. Each is fixed, or accepted by the user at the next checkpoint (accepted ones move to spec §8b).

| Screen | What differs | Why | Task |
|---|---|---|---|
| sidebar-expanded | Sections come from Nest modules, not the owner's menu; no top-level «داشبورد»/«تنظیمات» links, no count pills, no «پیشرفته» section | menu content is Task 5 | 5 |
| palette | Items have no icons; groups are "go to / create / records" instead of the design's records, actions (افزودن محصول، ساخت کد تخفیف، تغییر تم) and go-to with key hints | palette groups are Task 5 | 5 |
| dashboard-light (top bar) | No notification bell | nest-my-admin has no notifications feature; the bell is left out (not in spec §8b yet) — ask at checkpoint A | 2b |
| phone-drawer | Sections are expanded by default; the design shows them collapsed | collapsed-by-default comes with the menu | 5 |
| products-desktop | Set filter chips have a small × to remove them; the design has none | removing one filter in one click (the chip row is the only place desktop shows active filters) — ask at checkpoint A | 2c |
| products-desktop | Set chips stay in schema order; the design shows the set «دسته‌بندی» chip first | a chip that moves while set remounts and closes its popover mid-choice | 2c |
| products-desktop | No tabs (همه/فعال/غیرفعال/ناموجود); no thumbnail, SKU line, sale price, stock badge, switch or ⋯ menu in rows; header subtitle is the count only | list tabs and computed columns | 6, 7 |
| products-desktop | Latin digits and «USD» prices | money and digits | 3 |
| products-desktop | No «خروجی Excel» button | Excel export is out of scope (spec §8b) | — |
| products-phone | Title and add button sit in the page under the top bar, not in the top bar itself; trash and select buttons are extra | the phone top bar is the shell's; select mode exists because cards are links | 2b |
| products-phone | Cards have no checkbox outside select mode, no thumbnail, switch, price or badges row | card content comes from list.mobile; computed columns | 6 |
| products-phone | The drawer's main button says «نمایش نتایج», not «نمایش ۹۶ محصول»; the switch row («فقط محصولات فعال») and the sort button are plain selects | the count needs a live query per change; boolean filters are a segmented control | 7 |
| products-phone | Floating selection bar has no ⋯ menu; bulk actions show as labelled buttons | the demo has bulk actions with labels | 8 |
