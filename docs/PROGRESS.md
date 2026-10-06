# Progress

## Đã xong
- Khởi tạo dự án: Vite (library mode), TS strict, Vitest, Playwright, ESLint, trang demo.
- `SheetModel` thưa + `StyleTable` + unit test (16 test pass).

## Quyết định kỹ thuật
- `vitest` chạy môi trường `node` để đảm bảo `core/` và `formula/` không phụ thuộc DOM.
- React được đặt `external` khi build thư viện.

- `SheetModel` lưu ô trong `Map<number, Cell>` với khóa `dataRow * 16384 + dataCol` (không cấp phát string khi tra cứu). Ô rỗng và không style bị xóa khỏi map.
- `StyleTable` intern style theo khóa đã sắp xếp; id không bao giờ tái sử dụng để undo/redo giữ id cũ an toàn. Id 0 là style mặc định.
- Hàm ghi của `SheetModel` là mức thấp, chỉ command được gọi.

## Lỗi đã biết
- Chưa có.

## Việc tiếp theo
- `layout`: kích thước dòng/cột, prefix sum, tra vị trí theo pixel.
