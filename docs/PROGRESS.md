# Progress

Toàn bộ lộ trình MVP trong CLAUDE.md (tuần 1 và tuần 2) đã xong.

## Đã xong

**Nền tảng**
- Khởi tạo dự án: Vite (library mode), TS strict, Vitest, Playwright, ESLint, trang demo.
- `SheetModel` thưa + `StyleTable` dùng chung; `AxisLayout` (kích thước dòng/cột thưa, prefix sum, tra vị trí theo pixel).
- Canvas renderer (lưới, header, nội dung ô, DPR), virtualization 1M × 100, freeze dòng/cột.
- Chọn ô (click, kéo, Shift/Ctrl+click, header dòng/cột, góc chọn tất cả), di chuyển bằng phím (mũi tên, Ctrl+mũi tên theo khối dữ liệu, Tab, Enter, Home/End, PageUp/PageDown).
- Edit ô: gõ đè, F2, double-click, Enter/Tab/Esc, Alt+Enter xuống dòng, Delete, IME (composition).
- Command pattern + `History` (undo/redo); resize cột/dòng bằng kéo chuột.

**Tính năng spreadsheet**
- Copy/cut/paste (TSV + HTML, tương thích Excel/Sheets), dán lặp ô, cut = di chuyển.
- Fill handle: chuỗi số, chuỗi chữ-số (`Item 1` → `Item 2`), lặp ô, công thức dịch tham chiếu.
- Formula engine: tokenizer, parser, printer, evaluator, dependency graph, tính lại theo thứ tự topo, phát hiện vòng. Hàm: `SUM`, `AVERAGE`, `COUNT`, `MIN`, `MAX`, `IF`, `ROUND`, `CONCAT`, `SUMIF`, `COUNTIF`, `VLOOKUP`; tham chiếu `A1`, `$A$1`, `A:A`, `1:1`; dấu `;` làm phân cách tham số.
- Định dạng: đậm, nghiêng, màu chữ, màu nền, căn lề, định dạng số; toolbar phản ánh ô đang chọn.
- Sort theo cột, filter theo giá trị (hộp thoại có tìm kiếm); ký hiệu ↑ ↓ ▾ trên header.
- Chèn/xóa dòng và cột, có cập nhật tham chiếu công thức.
- Context menu chuột phải; thanh thống kê (tổng, trung bình, đếm).

**Kiểm thử**: 625 unit test (gồm ~300 test công thức theo bảng, 80 chuỗi fuzz × 120 thao tác, 60 chuỗi fuzz chèn/xóa với oracle độc lập) và 48 e2e test chạy trên Chromium, Firefox và WebKit.

**Hiệu năng đo trên Chromium với dữ liệu demo ~400k ô trong lưới 1.000.000 × 100**: cuộn dọc và chéo 16,6ms/khung (khóa 60fps), sort 1M dòng 155ms, filter 42ms, chèn dòng 47ms, thống kê khi chọn tất cả 20ms.

## Quyết định kỹ thuật

**Kiến trúc**
- `core/` và `formula/` không phụ thuộc DOM/React. `Spreadsheet` là engine headless: model, style, mapping, layout, selection, history, formula engine. UI chỉ đọc từ đó và chỉ ghi qua `execute(command)`.
- Cuộn: một `div` cuộn native nằm trên canvas, canvas vẽ lại theo vị trí cuộn logic. Firefox giới hạn chiều cao phần tử ~17,9M px mà 1M dòng × 21px = 21M, nên host chỉ được tối đa 8M px vật lý và `logic = vật lý × scale`.
- Vẽ theo "segment": mỗi trục có segment đóng băng và segment cuộn; vùng vẽ = tích hai trục, nên freeze không cần code riêng.
- Dữ liệu demo là bản thưa (khối dày 5000×20 + 300k ô rải rác) vì 100M ô không thể lưu trong `Map`.
- Chữ chỉ clip khi tràn ô; tràn sang ô trống bên cạnh để sau MVP.

**Nhập liệu**
- Một `<textarea>` ẩn giữ focus mọi lúc và đồng thời là editor ô (`CellEditor.tsx` render, `EditorController` điều khiển). Gõ ký tự khi đang chọn ô chỉ đổi style textarea rồi để trình duyệt chèn ký tự mặc định, nên không mất ký tự đầu. IME vào edit qua `compositionstart`. Textarea luôn nằm đè lên ô active để cửa sổ gợi ý IME hiện đúng chỗ.
- Keymap là hàm thuần theo context (`navigating` / `editing` / `editingFormula`) và luôn trả `null` khi `isComposing` hoặc `keyCode === 229`.
- Enter khi đang chọn ô = vào chế độ sửa (giống Sheets); Enter khi commit = xuống ô dưới (hoặc vòng trong vùng chọn nhiều ô). Gõ ký tự → "enter mode" (mũi tên commit và di chuyển); F2/double-click → "edit mode" (mũi tên di chuyển con trỏ).
- Kéo resize ghi trực tiếp vào layout để xem trước, lúc thả chuột tạo đúng một `ResizeCommand`.

**Clipboard**
- Ghi `text/plain` (TSV có quote) và `text/html` (`<table>` kèm style), paste ưu tiên `text/html` rồi `text/plain`. Copy nội bộ giữ nguyên `Cell` (công thức + style), nhận biết qua so sánh `text/plain`. Parse HTML bằng regex (không cần DOM); ô gộp (`colspan`) chưa mở rộng.
- Cut chỉ xóa nguồn khi paste (như Sheets), cả hai trong một bước undo.

**Công thức**
- Lưu là cây AST bất biến với tham chiếu tương đối (offset), nên copy/fill chỉ chia sẻ cây; `$` lưu chỉ số tuyệt đối. Tham chiếu theo tọa độ dữ liệu (`dataRow`/`dataCol`), nên sort chỉ đổi mapping và không làm công thức trỏ sai.
- Kết quả cache trong `Cell.value`; `SheetModel.onCellChange` ghi nhận ô bị đổi (chỉ khi đang có công thức), `Spreadsheet` tính lại sau mỗi `execute`/`undo`/`redo`. Nạp dữ liệu thẳng vào model thì gọi `recalculateAll()`.
- Tính lại: BFS tìm mọi ô phụ thuộc rồi sắp xếp Kahn. Khi kẹt, Tarjan (lặp, không đệ quy) tìm các ô thật sự nằm TRÊN vòng và gán `#REF!`; các ô chỉ đọc chúng vẫn tính bình thường (`SUM` lan truyền lỗi, `COUNTIF` bỏ qua). Quy tắc ban đầu "mọi ô sau vòng đều `#REF!`" bị fuzz test chỉ ra là sai vì làm tính tăng dần và tính từ đầu cho kết quả khác nhau.
- Tham chiếu một ô khi làm đối số hàm được truyền như range 1×1 để `SUM(A1)` bỏ qua chữ giống Sheets; `IF` đánh giá lười. Công thức sai cú pháp lưu thành `#ERROR!` kèm nguyên văn để sửa lại được.
- Cut-paste công thức dùng `rebaseFormula` (giữ nguyên ô được trỏ tới), copy dùng tham chiếu tương đối.
- `toNumber("")` = 0 (theo Sheets); `COUNTIF(range,"<>x")` đếm cả ô trống.

**Sort / filter / cấu trúc**
- Sort và filter chỉ đổi `ViewMapping` (`Int32Array` viewRow → dataRow) qua một command lưu lại trạng thái trước (thứ tự, kích thước dòng) nên undo chính xác. Dòng tiêu đề (`headerRows` = số dòng đóng băng) và các dòng trống bên dưới dữ liệu được giữ nguyên; ô trống luôn nằm cuối khi sort. Filter so khớp theo văn bản hiển thị.
- Chèn/xóa dòng/cột đổi số dòng/cột, di chuyển dữ liệu, kích thước và viết lại tham chiếu (`remapFormula`): tham chiếu vào ô bị xóa thành `#REF!`, range co lại hoặc giãn ra, `A:A` giữ nguyên. Undo bằng snapshot. Khi đang sort/filter, dòng chèn vào xuất hiện đúng vị trí đang thấy (dòng dữ liệu mới nhận chỉ số mới chèn vào `order`), còn xóa chỉ xóa các dòng đang hiển thị (dòng bị lọc ẩn vẫn còn); phần dữ liệu không liên tục này dùng `deleteSetMap`.
- Cut-paste cập nhật tham chiếu: `moveReferences` dịch các tham chiếu trỏ vào ô bị cắt (ô đơn, hoặc range nằm trọn trong vùng cắt; range chỉ trùm một phần giữ nguyên như Excel/Sheets), cả ở ô khác lẫn bên trong vùng cắt, trong cùng một bước undo.
- Double-click viền cột tự fit độ rộng: đo tối đa 100 chuỗi dài nhất của cột (đo là phần chậm), giới hạn 20–600px; chọn nhiều cột nguyên thì mỗi cột tự fit theo nội dung của nó.
- Định dạng lên vùng quá lớn (> 50.000 ô, ví dụ cả cột) chỉ áp dụng cho ô đã có dữ liệu để không sinh hàng triệu ô.

**Soạn công thức**: khi gõ `=SUM(` rồi nhấn mũi tên hoặc click/kéo ô, tham chiếu được chèn vào công thức (mũi tên chỉ trỏ ô ở "enter mode", tức là text đã gõ; sau khi tự dời con trỏ hoặc mở bằng F2 là "edit mode" và mũi tên dịch con trỏ). Mỗi tham chiếu một màu, vừa trong chữ (textarea trong suốt đè lên một div nền vẽ chữ màu, tắt khi đang gõ IME để thấy gạch chân của IME) vừa viền màu trên lưới.

## Phím tắt (Mod = Cmd trên Mac, Ctrl trên Windows/Linux)

| Phím | Tác dụng |
|---|---|
| Mũi tên, Mod+mũi tên, Shift+… | Di chuyển, nhảy theo khối dữ liệu, mở rộng vùng chọn |
| Tab / Shift+Tab, Enter / Shift+Enter | Di chuyển ngang / dọc (vòng trong vùng chọn nhiều ô) |
| Home, End, Mod+Home, Mod+End, PageUp, PageDown | Về đầu/cuối dòng, đầu/cuối dữ liệu, cuộn từng trang |
| Mod+A, Mod+Space, Shift+Space | Chọn tất cả, cả cột, cả dòng |
| F2, Enter, gõ ký tự, double-click | Sửa ô |
| Enter, Tab, Esc, Alt+Enter | Lưu, lưu rồi sang phải, hủy, xuống dòng trong ô |
| Mod+Enter (khi đang sửa) | Điền nội dung đang gõ vào cả vùng chọn (công thức dịch tham chiếu) |
| Delete, Backspace | Xóa nội dung |
| Mod+C / X / V | Copy / cut / paste |
| Mod+Shift+V | Dán chỉ giá trị |
| Mod+D / Mod+R | Điền xuống / sang phải từ hàng/cột đầu của vùng chọn (một ô: lấy từ ô trên/trái) |
| Mod+Z, Mod+Y, Mod+Shift+Z | Hoàn tác, làm lại |
| Mod+B / I / U, Mod+Shift+X | Đậm, nghiêng, gạch chân, gạch ngang |
| Mod+Shift+L / E / R | Căn trái / giữa / phải |
| Mod+Shift+1 / 4 / 5 | Định dạng số `#,##0.00` / tiền tệ / phần trăm |
| Mod+\ | Xóa định dạng |
| Mod+Backspace | Cuộn tới ô đang chọn |
| Mũi tên, Shift+mũi tên, click, kéo (khi gõ công thức sau `=`, `(`, `,` hoặc toán tử) | Chèn/di chuyển tham chiếu ô, Shift hoặc kéo để thành range |
| F4 (khi gõ công thức) | Đổi tham chiếu dưới con trỏ: `A1` → `$A$1` → `A$1` → `$A1` |

Chưa có: Mod+; (ngày hiện tại), Mod+K (liên kết), Mod+T (trình duyệt giữ phím này nên chỉ dùng F4), Mod+Alt+V (dán chỉ định dạng), Mod+/ (danh sách phím tắt), Mod+Alt+= và Mod+Alt+- (chèn/xóa), Mod+Shift+L bật bộ lọc.

## Lỗi đã biết / giới hạn

- e2e đã chạy xanh trên cả 3 engine: Chromium 48/48, WebKit 46 pass + 2 skip, Firefox 46 pass + 2 skip (2 test giả lập IME qua CDP chỉ chạy trên Chromium). IME thật vẫn cần thử tay.
- Khi đang sort/filter, cut-paste chưa cập nhật tham chiếu từ ô khác tới vùng bị cắt (chỉ làm khi thứ tự dòng tự nhiên).
- Công thức tham chiếu theo tọa độ dữ liệu: khi đang sort, nhãn A1 trong công thức là vị trí dữ liệu gốc, không phải vị trí đang hiển thị.
- Chiều cao dòng gắn với vị trí hiển thị, không đi theo dữ liệu khi sort.
- Double-click fill handle chưa tự điền; ngày tháng chưa có chuỗi; double-click viền dòng chưa tự fit chiều cao.
- Một số đơn lẻ khi fill được copy (không tăng) như Sheets.
- Chữ chưa tràn sang ô trống bên cạnh; ô gộp, nhiều sheet, xlsx, find & replace... nằm ngoài MVP.
- Paste từ menu chuột phải dùng `navigator.clipboard.read()` nên trình duyệt có thể hỏi quyền (Firefox chỉ đọc được text).

## Kiểm tra thủ công cho bạn (nhất là IME, clipboard, Safari)

Chạy `pnpm dev` rồi mở http://localhost:5173/demo/ (thêm `?mode=empty` để có trang trống nhỏ).

1. **IME tiếng Việt (Telex và VNI), cả Chrome, Safari, Firefox**: chọn một ô rồi gõ ngay `viet` + `e` + `j` (Telex) hoặc `vie6t5`; ký tự đầu không được mất, cửa sổ gợi ý phải hiện cạnh ô, Enter khi đang gõ dở (đang gạch chân) không được commit ô. Thử cả khi đang sửa ô (F2) và trong công thức (`=IF(A1>1;"có";"không")`). Thử Unikey/EVKey kiểu gửi Backspace.
2. **Clipboard với Excel và Google Sheets**: copy một vùng từ Excel/Sheets rồi Ctrl/Cmd+V vào lưới (số phải thành số, ô có xuống dòng giữ nguyên); ngược lại copy từ lưới rồi dán vào Excel/Sheets (giữ đậm, nghiêng, màu). Thử cut + paste và menu chuột phải → Copy/Paste.
3. **Safari**: cuộn mượt và sắc nét trên màn hình Retina, kéo thanh cuộn dọc tới cuối (dòng 1.000.000), Cmd+C/V/Z, phím Alt gõ ký tự đặc biệt, double-click sửa ô, `<input type=color>` trên toolbar.
4. **Cuộn 1.000.000 dòng**: cuộn nhanh bằng trackpad, kéo thanh cuộn, Ctrl/Cmd+↓ tới cuối khối dữ liệu, PageDown liên tục; kiểm tra freeze dòng 1 và cột A giữ nguyên và không giật.
5. **Công thức**: gõ `=SUM(A:A)`, `=VLOOKUP(...)`, `=A1/0`, tạo vòng `A1 = B1`, `B1 = A1`; kéo fill handle công thức; chèn/xóa dòng giữa vùng được `SUM` tham chiếu.
6. **Sort/filter**: chuột phải một cột → sort, filter theo giá trị; xem ký hiệu trên header; Ctrl/Cmd+Z hoàn tác từng bước.
7. **Kéo chọn vùng ra ngoài mép** để thử tự cuộn; kéo viền header để resize; Shift+click, Ctrl/Cmd+click nhiều vùng.

## Việc tiếp theo (ngoài MVP, chỉ làm khi bạn yêu cầu)

- Chạy e2e trên Firefox/WebKit và sửa nếu có khác biệt.
- Chữ tràn sang ô trống, fill ngày tháng.
- Công thức theo vị trí hiển thị khi sort.
- Tính toán trong Web Worker cho bảng rất lớn.
