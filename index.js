// ==========================================
// 1. IMPORTS
// ==========================================
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

// ==========================================
// 2. KHỞI TẠO ỨNG DỤNG & CẤU HÌNH
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Khởi tạo Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// Khởi tạo Google Sheets API
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        // Dòng replace này cực kỳ quan trọng để sửa lỗi xuống dòng của key trên server
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ==========================================
// ==========================================
// 3. HÀM TƯƠNG TÁC CHATBOT (ĐÃ NÂNG CẤP)
// ==========================================
async function askChatbot(page, question, chatInputSelector = '.sh-input-field') {
    try {
        const botMsgSelector = '.sh-msg-wrapper.bot';
        
        // Đếm số lượng câu trả lời của bot ĐANG CÓ trên màn hình trước khi hỏi
        const beforeCount = await page.locator(botMsgSelector).count();

        // Nhập câu hỏi và bấm Enter
        await page.fill(chatInputSelector, question);
        await page.keyboard.press('Enter');

        // KIÊN NHẪN CHỜ ĐỢI: Chờ đến khi số lượng tin nhắn của bot tăng thêm ít nhất 1
        await page.waitForFunction(
            (args) => document.querySelectorAll(args.selector).length > args.count,
            { selector: botMsgSelector, count: beforeCount },
            { timeout: 15000 } // Chờ tối đa 15s cho mỗi câu
        );

        // Chờ thêm 1 giây để hiệu ứng UI (nếu có) hiển thị chữ xong hẳn
        await page.waitForTimeout(1000);

        // Lúc này mới được lấy nội dung của cái tin nhắn mới nhất
        const answer = await page.textContent(`${botMsgSelector}:last-child .sh-msg-bot`);
        return answer.trim();
        
    } catch (error) {
        console.error("❌ Lỗi khi hỏi chatbot:", error.message);
        throw error;
    }
}

// ==========================================
// 4. HÀM CHẤM ĐIỂM BẰNG GEMINI
// ==========================================
async function judgeAnswer(expected, actual) {
    if (!expected) return "[SKIP] Không có kết quả kỳ vọng";
    
    const prompt = `Bạn là một chuyên gia kiểm thử phần mềm (QA Tester).
    Hãy so sánh câu trả lời thực tế của Chatbot với kết quả kỳ vọng và đánh giá mức độ khớp nhau về mặt NGỮ NGHĨA.
    
    Kỳ vọng: "${expected}"
    Thực tế: "${actual}"
    
    Nhiệm vụ của bạn:
    1. Phân tích và ước lượng mức độ giống nhau về mặt ý nghĩa (từ 0% đến 100%).
    2. Phân loại nhãn dựa trên tỷ lệ % theo quy tắc:
       - [PASS]: Nếu tỷ lệ >= 80%
       - [PARTIAL]: Nếu tỷ lệ từ 50% đến 79%
       - [FAIL]: Nếu tỷ lệ < 50%
    3. Định dạng đầu ra (một dòng duy nhất):
    [NHÃN] (X%) - Giải thích ngắn gọn lý do.
    
    Ví dụ: [PARTIAL] (60%) - Bot có báo giá gói 500 số nhưng quên cung cấp thông tin liên hệ.`;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error("Lỗi khi gọi Gemini:", error);
        return "[ERROR] Lỗi API Gemini";
    }
}

// ==========================================
// 5. HÀM CHẠY TEST CHÍNH
// ==========================================
async function runTestCases(page, testCases, spreadsheetId, sheetName, chatInputSelector) {
    let results = { pass: 0, partial: 0, fail: 0, total: testCases.length, details: [] };

    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];
        const rowNumber = i + 2; // Bắt đầu từ hàng 2
        
        try {
            console.log(`\n▶ Câu ${i + 1}: ${test.question}`);
            
            const actualAnswer = await askChatbot(page, test.question, chatInputSelector);
            const scoreResult = await judgeAnswer(test.expected, actualAnswer);
            
            // Cập nhật kết quả
            if (scoreResult.includes('[PASS]')) results.pass++;
            else if (scoreResult.includes('[PARTIAL]')) results.partial++;
            else results.fail++;

            results.details.push({
                question: test.question,
                expected: test.expected,
                actual: actualAnswer,
                judgment: scoreResult
            });

            // Ghi vào Google Sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `${sheetName}!D${rowNumber}:E${rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[actualAnswer, scoreResult]],
                },
            });

            console.log(`  └ Kết quả: ${scoreResult}`);
            await page.waitForTimeout(1000);
            
        } catch (error) {
            console.error(`Lỗi ở câu ${i + 1}:`, error.message);
            results.fail++;
        }
    }

    return results;
}

// ==========================================
// 6. API ENDPOINT
// ==========================================
app.post('/api/run-test', async (req, res) => {
    const { targetUrl, chatbotIconSelector, chatInputSelector, sheetUrl } = req.body;
    
    // Validate inputs
    if (!targetUrl || !sheetUrl) {
        return res.status(400).json({ error: "targetUrl và sheetUrl là bắt buộc!" });
    }

    // Tách ID Google Sheet
    const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = sheetIdMatch ? sheetIdMatch[1] : null;

    if (!spreadsheetId) {
        return res.status(400).json({ error: "Link Google Sheet không hợp lệ!" });
    }

    console.log(`🚀 Bắt đầu test cho: ${targetUrl}`);
    let browser;
    
    try {
        const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
        // Đọc dữ liệu từ Google Sheet
        const sheetName = 'Trang tính1';
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!B2:C`,
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(400).json({ error: "Không tìm thấy dữ liệu trên Sheet!" });
        }

        // Chuyển đổi dữ liệu thành test cases
        const testCases = rows.map(row => ({
            question: row[0] || '',
            expected: row[1] || ''
        })).filter(tc => tc.question);

        // Khởi động browser
        // Khởi động browser với chế độ tối ưu RAM
    browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Cực kỳ quan trọng: Vô hiệu hóa phân vùng bộ nhớ chung, chống tràn RAM trên Linux
            '--disable-gpu',           // Tắt xử lý đồ họa vì mình chỉ chạy ngầm
            '--single-process',        // Ép chạy trên 1 tiến trình duy nhất
            '--no-zygote'              // Tắt các tiến trình con không cần thiết
        ] 
    });
        // 2. THÊM DÒNG NÀY VÀO (Để mở page)
         const page = await browser.newPage(); // Mở một tab mới
        // 3. Cho tab đó truy cập vào trang web đích
        // THÊM ĐOẠN NÀY VÀO: Chặn tải hình ảnh, CSS, video, font chữ để tiết kiệm 70% RAM
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'stylesheet', 'media', 'font'].includes(type)) {
            route.abort(); // Từ chối tải
        } else {
            route.continue(); // Cho phép tải HTML, JS, API (để Chatbot hoạt động)
        }
    });
        // domcontentloaded sẽ giúp nó tải xong khung web là dừng, không chờ mấy cái script quảng cáo chạy ẩn nữa
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Mở chatbot
        if (chatbotIconSelector) {
            await page.waitForSelector(chatbotIconSelector, { timeout: 10000 });
            await page.click(chatbotIconSelector);
            console.log("✅ Đã mở chatbot");
            await page.waitForTimeout(2000);
        }

        // Chạy các test cases
        const results = await runTestCases(
            page, 
            testCases, 
            spreadsheetId, 
            sheetName, 
            chatInputSelector || '.sh-input-field'
        );

        res.json({ 
            status: "success", 
            message: "Kiểm thử hoàn tất!", 
            data: results 
        });

    } catch (error) {
        console.error("❌ Lỗi:", error);
        res.status(500).json({ 
            status: "error", 
            message: error.message 
        });
    } finally {
        if (browser) await browser.close();
        console.log("Đã đóng trình duyệt, giải phóng RAM.");
    }
});

// ==========================================
// 7. KHỞI ĐỘNG SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Backend hoạt động tại http://localhost:${PORT}`);
});
