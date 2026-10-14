# Denglish Vocabulary (iPhone)

App sổ từ vựng của Denglish chạy hẳn trên điện thoại: thẻ lật vuốt trái / phải /
lên xen kẽ thẻ gõ từ (chỉ hiện nghĩa, gõ lại từ tiếng Anh), nhắc ôn đúng lúc theo
5 cấp như Mochi, AI (Gemini) soạn phiên âm, nghĩa, ví dụ, ảnh minh hoạ. Ôn được
cả khi máy tính tắt hay mất mạng.

Mở: https://tranthanhduongpiano-ai.github.io/denglish-vocab/

## Cài lên iPhone

1. Mở địa chỉ trên bằng **Safari** → nút **Chia sẻ** → **Thêm vào MH chính**.
2. Mở app từ biểu tượng Denglish vừa tạo.
3. Trên máy tính: Denglish → ⚙ Cài đặt → **☁ Sổ từ trên iPhone** → **Hiện mã cài
   đặt cho iPhone**. Trong app bấm **📷 Quét mã cài đặt** và quét mã đó.

## Dữ liệu nằm ở đâu

- **Trên iPhone** (bộ nhớ của app): sổ từ, lịch ôn, ảnh, giọng đọc đã tải.
- **Kho GitHub riêng tư** (`denglish-data`): bản sao để đồng bộ với Denglish trên
  máy tính — thẻ (`cards/`), ảnh (`img/`), giọng đọc mẫu Oxford (`audio/`), số từ
  ôn mỗi ngày (`stats/`).
- Mã truy cập GitHub và khoá Gemini chỉ lưu trên iPhone, **không** nằm trong kho
  này. Kho này chỉ chứa mã nguồn app.

Gộp dữ liệu hai máy: mỗi thẻ có mốc sửa đổi, bản nào sửa sau thì thắng; thẻ xoá
ở máy này cũng bị xoá ở máy kia.

## Mã nguồn

| File | Việc |
|---|---|
| `index.html`, `app.css` | Khung trang, giao diện |
| `js/app.js` | Giao diện: bảng ôn, thêm từ, sổ từ, thẻ lật vuốt, cài đặt, quét mã |
| `js/typecard.js`, `typecard.css` | Thẻ gõ từ — dùng chung với trang Vocabulary trên laptop, sửa thì chép sang `dictation-app/static` |
| `js/store.js` | Sổ từ và lịch ôn 5 cấp (giống `vocab.py` của Denglish) |
| `js/sync.js` | Đồng bộ với kho GitHub riêng tư |
| `js/ai.js`, `js/prompts.js` | Gemini soạn thẻ, tách từ trong file ghi chú |
| `js/parse.js` | Tách từ theo dòng; đọc `.md` `.txt` `.docx` `.pdf` |
| `js/images.js`, `js/audio.js` | Ảnh minh hoạ, phát âm |
| `js/db.js` | Lưu trong máy (IndexedDB) |
| `sw.js` | Chạy offline |
