# Progress

## Đã xong
- Khởi tạo dự án: Vite (library mode), TS strict, Vitest, Playwright, ESLint, trang demo.
- `SheetModel` thưa + `StyleTable` + unit test (16 test pass).
- `layout`: `AxisLayout` (kích thước dòng/cột thưa, offset, tra chỉ số theo pixel, visibleRange) + 11 unit test.

## Quyết định kỹ thuật
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
- Canvas renderer: lưới, header, nội dung ô, hỗ trợ DPR.
