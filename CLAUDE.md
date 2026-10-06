# CLAUDE.md

Tài liệu này hướng dẫn Claude Code làm việc trong dự án. Đọc toàn bộ file này trước khi bắt đầu mỗi phiên làm việc.

**Ngôn ngữ:** Trả lời và giải thích bằng tiếng Việt. Code, tên biến, tên file, commit message viết bằng tiếng Anh.

---

## 1. Tổng quan dự án

Xây dựng **React spreadsheet grid** (thư viện component) với trải nghiệm giống Google Sheets cho các thao tác hằng ngày.

- Lưới vẽ bằng **canvas**. Các phần tương tác (ô đang edit, menu, toolbar, tooltip) dùng **DOM** nổi phía trên.
- Mô hình dữ liệu là **lưới ô tự do** kiểu spreadsheet (không phải mỗi dòng là một bản ghi).
- Mục tiêu hiệu năng: cuộn mượt 60fps với 1.000.000 dòng × 100 cột.
- Thời hạn MVP: **2 tuần** (xem mục 8).

## 2. Tech stack

- React 18+, TypeScript (`strict: true`)
- Vite (library mode để build package, dev server cho trang demo)
- Vitest cho unit test, Playwright cho e2e (Chromium, Firefox, WebKit)
- pnpm
- Không dùng UI framework hay CSS framework cho phần lưới.

**Không thêm dependency mới khi chưa hỏi ý kiến tôi.** Nếu cần, hãy giải thích lý do và đề xuất phương án không dùng thư viện trước.

## 3. Lệnh thường dùng

```bash
pnpm install
pnpm dev          # chạy trang demo tại /demo
pnpm test         # unit test (Vitest)
pnpm test:e2e     # e2e test (Playwright)
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm build        # build thư viện
```

Sau mỗi thay đổi, chạy `pnpm typecheck && pnpm test`. Trước khi báo hoàn thành một tính năng, chạy thêm `pnpm test:e2e`.

## 4. Cấu trúc thư mục

```
src/
  core/
    model/        # SheetModel, Cell, StyleTable, Workbook (nhiều sheet)
    commands/     # Command pattern: SetCellValue, InsertRows, Paste, Sort...
    history/      # Undo/redo stack
    selection/    # SelectionModel: các range + ô active
    mapping/      # Ánh xạ tọa độ hiển thị <-> tọa độ dữ liệu (sort, filter, ẩn)
    layout/       # Kích thước dòng/cột, prefix sum, tra vị trí theo pixel
  formula/
    tokenizer.ts
    parser.ts     # Tạo AST
    evaluator.ts
    dependency.ts # Dependency graph, tính lại theo thứ tự topo, phát hiện vòng
    functions/    # Mỗi nhóm hàm một file: math.ts, logic.ts, lookup.ts, text.ts
  render/
    CanvasRenderer.ts
    layers/       # grid, cells, headers, selection, fill handle
    textMeasure.ts
    viewport.ts
  input/
    keymap.ts     # Bảng phím tắt theo context
    KeyboardController.ts
    MouseController.ts
    clipboard.ts  # TSV + text/html, tương thích Excel/Sheets
    ime.ts        # Xử lý composition (gõ tiếng Việt)
  react/
    DataGrid.tsx  # Component công khai
    CellEditor.tsx
    ContextMenu.tsx
    Toolbar.tsx
  index.ts        # Public API
demo/             # Trang demo để thử thủ công
tests/
  unit/
  e2e/
docs/
  PROGRESS.md     # Tiến độ và quyết định kỹ thuật
```

## 5. Nguyên tắc kiến trúc (bắt buộc)

1. **Một nguồn dữ liệu duy nhất.** Mọi dữ liệu nằm trong `core/model`. Renderer, formula engine, selection chỉ đọc từ model, không giữ bản sao.
2. **Mọi thay đổi đi qua command.** Không sửa model trực tiếp từ UI. Mỗi command phải có `apply()` và `invert()` để undo/redo hoạt động. Một thao tác người dùng (ví dụ paste vùng 100 ô) là **một** bước undo.
3. **Tách tọa độ hiển thị và tọa độ dữ liệu.** Sort, filter, ẩn dòng chỉ thay đổi `mapping`, không di chuyển dữ liệu thật. Đặt tên biến rõ ràng: `viewRow`/`viewCol` và `dataRow`/`dataCol`. Không bao giờ dùng lẫn.
4. **Dữ liệu thưa.** Chỉ lưu ô có nội dung. Định dạng lưu trong `StyleTable` dùng chung, mỗi ô chỉ lưu `styleId`.
5. **React chỉ là lớp vỏ.** Không đưa dữ liệu ô hay trạng thái cuộn vào React state. Lưới được vẽ bằng code imperative qua `requestAnimationFrame`. React dùng cho editor, menu, toolbar.
6. **Core không phụ thuộc React và DOM.** `core/` và `formula/` phải chạy được trong Node (để test) và trong Web Worker.
7. **Công thức lưu tham chiếu dạng tương đối** (offset so với ô chứa công thức, kiểu R1C1). Chỉ chuyển sang dạng A1 khi hiển thị.

## 6. Quy tắc render canvas

- Luôn nhân kích thước canvas theo `devicePixelRatio`, nếu không chữ sẽ mờ trên màn hình Retina.
- Chỉ vẽ vùng nhìn thấy. Gom nhiều thay đổi vào một lần vẽ trong `requestAnimationFrame`.
- Vẽ đường lưới ở tọa độ `x + 0.5` để nét 1px sắc.
- Cache kết quả `measureText` theo (font, text).
- Cắt chữ (clip) trong phạm vi ô. Chữ tràn sang ô trống bên cạnh như Sheets chỉ làm sau MVP.
- Không tạo object mới trong vòng lặp vẽ.

## 7. Bàn phím, IME, clipboard

- Focus luôn nằm trên một `<textarea>` ẩn để nhận phím và sự kiện `paste`/`copy`/`cut`.
- Khi `event.isComposing === true` hoặc `keyCode === 229`: **không** xử lý phím tắt. Đây là điều kiện để gõ tiếng Việt (Telex/VNI) không bị lỗi.
- Gõ ký tự khi đang chọn ô (chưa edit) phải chuyển sang chế độ edit **mà không mất ký tự đầu**, kể cả khi gõ bằng IME.
- Dùng `event.key` cho ký tự, `event.code` chỉ khi cần vị trí phím vật lý.
- Mac dùng `Meta`, Windows/Linux dùng `Ctrl`. Gọi chung là `Mod` trong keymap.
- Clipboard: ghi cả `text/plain` (TSV) và `text/html` (`<table>`). Khi paste, ưu tiên đọc `text/html` rồi mới đến `text/plain`.
- Keymap phụ thuộc context: `navigating`, `editing`, `editingFormula`. Cùng một phím có hành vi khác nhau theo context.

## 8. Lộ trình MVP 2 tuần

Đánh dấu `[x]` khi xong và cập nhật `docs/PROGRESS.md`.

### Tuần 1: Nền tảng
- [x] Khởi tạo dự án (Vite, TS strict, Vitest, Playwright, trang demo)
- [x] `SheetModel` thưa + `StyleTable` + unit test
- [ ] `layout`: kích thước dòng/cột, tra vị trí theo pixel
- [ ] Canvas renderer: lưới, header, nội dung ô, hỗ trợ DPR
- [ ] Virtualization + cuộn mượt với 1.000.000 × 100 ô (dữ liệu demo sinh ngẫu nhiên)
- [ ] Freeze dòng tiêu đề và cột đầu
- [ ] Chọn ô, kéo chọn vùng, Shift+click, chọn cả dòng/cột qua header
- [ ] Di chuyển bằng phím: mũi tên, Tab, Enter, Ctrl+mũi tên, Home/End, PageUp/PageDown
- [ ] Edit ô: gõ đè, F2, double-click, Enter/Esc, Delete, **IME tiếng Việt**
- [ ] Command pattern + undo/redo
- [ ] Resize cột/dòng bằng kéo chuột

### Tuần 2: Tính năng spreadsheet
- [ ] Copy/cut/paste trong grid và với Excel/Google Sheets
- [ ] Fill handle: copy giá trị và chuỗi số đơn giản
- [ ] Formula engine: tokenizer, parser, evaluator, dependency graph
- [ ] Hàm: `SUM`, `AVERAGE`, `COUNT`, `MIN`, `MAX`, `IF`, `ROUND`, `CONCAT`, `SUMIF`, `COUNTIF`, `VLOOKUP`
- [ ] Copy/fill công thức với tham chiếu tương đối và `$` tuyệt đối
- [ ] Định dạng: đậm, nghiêng, màu chữ, màu nền, căn lề, định dạng số cơ bản
- [ ] Sort theo cột, filter đơn giản theo giá trị
- [ ] Chèn/xóa dòng và cột (có cập nhật tham chiếu công thức)
- [ ] Context menu chuột phải
- [ ] Thanh thống kê khi chọn vùng số (tổng, trung bình, đếm)

### Ngoài phạm vi MVP (không làm khi chưa được yêu cầu)
Merge cell, nhiều sheet, nhập/xuất xlsx, find & replace, pivot, biểu đồ, định dạng có điều kiện, data validation, comment, cộng tác thời gian thực, hàm mảng.

## 9. Quy tắc test

- Mọi tính năng mới phải có test. Viết test cùng lúc với code, không để sau.
- **Formula:** mỗi hàm có bảng test case gồm cả trường hợp lỗi (`#DIV/0!`, `#VALUE!`, `#REF!`, `#N/A`) và ép kiểu. Kết quả mong đợi lấy theo hành vi của Google Sheets.
- **Command:** với mỗi command, test rằng `apply()` rồi `invert()` trả model về đúng trạng thái ban đầu.
- **Fuzz test:** sinh ngẫu nhiên chuỗi thao tác (set value, chèn/xóa dòng, sort, paste, undo, redo) và kiểm tra: model không hỏng, undo hết thì quay về trạng thái ban đầu, công thức không trỏ sai.
- **E2E (Playwright):** chọn vùng, di chuyển bằng phím, edit, copy/paste, undo. Chạy trên cả 3 engine trình duyệt.
- Không sửa hoặc xóa test để cho pass. Nếu test sai, giải thích lý do trước khi sửa.

## 10. Quy trình làm việc của Claude

1. **Lập kế hoạch trước khi code.** Với mỗi tính năng, trình bày ngắn: file nào thay đổi, cách làm, rủi ro. Chờ tôi đồng ý nếu thay đổi lớn hoặc ảnh hưởng kiến trúc.
2. **Làm từng bước nhỏ.** Mỗi bước phải chạy được và pass test trước khi sang bước tiếp.
3. **Chạy `pnpm typecheck && pnpm test` sau mỗi thay đổi.** Tự sửa lỗi cho đến khi pass.
4. **Đề xuất commit** sau mỗi bước hoàn chỉnh, với message rõ ràng (`feat:`, `fix:`, `test:`, `refactor:`).
5. **Cập nhật `docs/PROGRESS.md`:** việc đã xong, quyết định kỹ thuật và lý do, lỗi đã biết, việc tiếp theo.
6. **Cuối mỗi tính năng,** liệt kê những gì tôi cần tự thử bằng tay trên trình duyệt (đặc biệt IME, clipboard, Safari).
7. Khi không chắc về hành vi mong muốn, **hỏi lại**, đừng đoán.

## 11. Quy ước code

- Không dùng `any`. Dùng kiểu cụ thể hoặc `unknown` kèm kiểm tra.
- Hàm thuần (pure) cho logic trong `core/` và `formula/` khi có thể.
- Tên file: `PascalCase.ts` cho class/component, `camelCase.ts` cho module hàm.
- Không để `console.log` trong code commit.
- Comment giải thích **tại sao**, không giải thích **cái gì**.
- Code hiệu năng cao (render, layout) được phép viết kiểu imperative, nhưng phải có comment giải thích tối ưu.

## 12. Định nghĩa "hoàn thành" cho một tính năng

- [ ] Typecheck và lint không lỗi
- [ ] Unit test và e2e test pass
- [ ] Hành vi khớp với Google Sheets cho các trường hợp thông thường
- [ ] Không làm tụt hiệu năng cuộn trên dữ liệu 1.000.000 dòng
- [ ] Đã cập nhật `docs/PROGRESS.md`
- [ ] Đã liệt kê các bước kiểm tra thủ công cho tôi
