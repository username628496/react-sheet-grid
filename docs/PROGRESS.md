# Progress

## Đã xong
- Khởi tạo dự án: Vite (library mode), TS strict, Vitest, Playwright, ESLint, trang demo.
- `SheetModel` thưa + `StyleTable` + unit test (16 test pass).
- `layout`: `AxisLayout` (kích thước dòng/cột thưa, offset, tra chỉ số theo pixel, visibleRange) + 11 unit test.
- Canvas renderer (lưới, header, nội dung ô, DPR), virtualization 1M × 100, freeze dòng/cột (`frozenRows`/`frozenCols`). Đo thực tế trên Chromium: 16,5ms/khung khi cuộn (khóa 60fps).
- Lõi bổ sung: `Spreadsheet` (headless), `ViewMapping`, `format`, `parseInput`, `address`.

## Quyết định kỹ thuật
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

## Lỗi đã biết
- `setSize` đánh dấu prefix sum bẩn, mỗi lần truy vấn sau đó tốn O(k) (k = số override). Cần chú ý khi kéo resize với rất nhiều override.

## Việc tiếp theo
- Chọn ô, kéo chọn vùng, Shift+click, chọn cả dòng/cột qua header.
