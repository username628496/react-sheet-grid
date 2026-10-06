# Progress

## Đã xong
- Khởi tạo dự án: Vite (library mode), TS strict, Vitest, Playwright, ESLint, trang demo.
- `SheetModel` thưa + `StyleTable` + unit test (16 test pass).
- `layout`: `AxisLayout` (kích thước dòng/cột thưa, offset, tra chỉ số theo pixel, visibleRange) + 11 unit test.
- Canvas renderer (lưới, header, nội dung ô, DPR), virtualization 1M × 100, freeze dòng/cột (`frozenRows`/`frozenCols`). Đo thực tế trên Chromium: 16,5ms/khung khi cuộn (khóa 60fps).
- Lõi bổ sung: `Spreadsheet` (headless), `ViewMapping`, `format`, `parseInput`, `address`.
- Chọn ô (click, kéo, Shift/Ctrl+click, header dòng/cột, góc chọn tất cả), di chuyển bằng phím (mũi tên, Ctrl+mũi tên theo khối dữ liệu, Tab, Enter, Home/End, PageUp/PageDown).
- Edit ô: gõ đè, F2, double-click, Enter/Tab/Esc, Alt+Enter xuống dòng, Delete, IME (composition).
- Command pattern + `History` (undo/redo): `SetCellsCommand`, `ResizeCommand`.
- Resize cột/dòng bằng kéo chuột (resize nhiều cột khi đang chọn cả cột).
- 20 e2e test (Chromium) và 92 unit test.
- Copy/cut/paste: ghi `text/plain` (TSV có quote) và `text/html` (`<table>` kèm style), paste ưu tiên `text/html` rồi `text/plain`. Dán lặp ô khi vùng chọn là bội số của vùng copy. Cut chỉ xóa nguồn khi paste (như Sheets), cả hai trong một bước undo. Viền đứt quanh vùng đã copy.

## Quyết định kỹ thuật
- Một `<textarea>` ẩn giữ focus mọi lúc và đồng thời là editor ô (`CellEditor.tsx` render, `EditorController` điều khiển). Gõ ký tự khi đang chọn ô chỉ đổi style textarea rồi để trình duyệt chèn ký tự mặc định, nên không mất ký tự đầu. IME vào edit qua `compositionstart`. Textarea luôn nằm đè lên ô active để cửa sổ gợi ý IME hiện đúng chỗ.
- Keymap là hàm thuần theo context (`navigating` / `editing` / `editingFormula`) và luôn trả `null` khi `isComposing` hoặc `keyCode === 229`.
- Enter khi đang chọn ô = vào chế độ sửa (giống Google Sheets); Enter khi commit = xuống ô dưới (hoặc vòng trong vùng chọn nhiều ô).
- Gõ ký tự → "enter mode" (mũi tên commit và di chuyển); F2/double-click → "edit mode" (mũi tên di chuyển con trỏ).
- Kéo resize ghi trực tiếp vào layout để xem trước, rồi lúc thả chuột trả về kích thước cũ và tạo đúng một `ResizeCommand`, nên undo chỉ một bước.
- Định dạng lên vùng quá lớn (> 50.000 ô, ví dụ cả cột) chỉ áp dụng cho ô đã có dữ liệu để không sinh hàng triệu ô.
- Cuộn: một `div` cuộn native nằm trên canvas, canvas vẽ lại theo vị trí cuộn logic. Firefox giới hạn chiều cao phần tử ~17,9M px mà 1M dòng × 21px = 21M, nên host chỉ được tối đa 8M px vật lý và `logic = vật lý × scale` (`computeScrollMetrics`).
- Vẽ theo "segment": mỗi trục có segment đóng băng và segment cuộn; vùng vẽ = tích hai trục, nên freeze không cần code riêng.
- Dữ liệu demo là bản thưa (khối dày 5000×20 + 300k ô rải rác) vì 100M ô không thể lưu trong `Map`.
- Chữ chỉ clip khi tràn ô; tràn sang ô trống bên cạnh để sau MVP.
- Sort/filter dùng `ViewMapping` (`Int32Array` viewRow → dataRow); `AxisLayout.setCount` để filter đổi số dòng hiển thị.
- `vitest` chạy môi trường `node` để đảm bảo `core/` và `formula/` không phụ thuộc DOM.
- React được đặt `external` khi build thư viện.

- `SheetModel` lưu ô trong `Map<number, Cell>` với khóa `dataRow * 16384 + dataCol` (không cấp phát string khi tra cứu). Ô rỗng và không style bị xóa khỏi map.
- `StyleTable` intern style theo khóa đã sắp xếp; id không bao giờ tái sử dụng để undo/redo giữ id cũ an toàn. Id 0 là style mặc định.
- Hàm ghi của `SheetModel` là mức thấp, chỉ command được gọi.
- `AxisLayout` chỉ lưu kích thước khác mặc định + prefix sum dựng lại lười; kích thước 0 nghĩa là ẩn. Làm việc trên tọa độ hiển thị (`viewIndex`).
- `visibleRange` ghi vào object do caller truyền để vòng vẽ không cấp phát.
- Copy nội bộ giữ nguyên `Cell` (công thức + style) nhận biết qua so sánh `text/plain` với bản đã ghi; dữ liệu từ app khác đi qua parse HTML/TSV. Parse HTML bằng regex (không cần DOM) để chạy được trong Node; ô gộp (`colspan`) chưa được mở rộng.
- `readCells` cắt theo vùng dữ liệu khi vùng chọn > 100.000 ô, để copy cả cột không tạo ma trận 1M dòng.

## Lỗi đã biết
- Firefox và WebKit chưa chạy được e2e trong môi trường này (không tải được binary Playwright). Cần chạy `pnpm exec playwright install` rồi `pnpm test:e2e` trên máy bạn.
- Double-click vào viền resize chưa tự fit độ rộng cột.
- `setSize` đánh dấu prefix sum bẩn, mỗi lần truy vấn sau đó tốn O(k) (k = số override). Cần chú ý khi kéo resize với rất nhiều override.

## Việc tiếp theo
- Formula engine: tokenizer, parser, evaluator, dependency graph.
