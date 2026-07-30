// ==========================================
// 1. IMPORTS
// ==========================================
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';
import { selectLatestBotAnswer } from './botReplyUtils.js';

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
        const botReplySelector = `${botMsgSelector} .sh-msg-bot`;

        const previousTexts = await page.locator(botReplySelector).allTextContents();
        const beforeCount = previousTexts.length;

        await page.fill(chatInputSelector, question);
        await page.keyboard.press('Enter');

        const deadline = Date.now() + 15000;
        let answer = null;

        while (Date.now() < deadline) {
            const currentTexts = await page.locator(botReplySelector).allTextContents();
            answer = selectLatestBotAnswer(
                currentTexts,
                beforeCount,
                previousTexts[previousTexts.length - 1]
            );

            if (answer) {
                break;
            }

            await page.waitForTimeout(500);
        }

        return (answer || '').trim();
    } catch (error) {
        console.error("❌ Lỗi khi hỏi chatbot:", error.message);
        throw error;
    }
}

// ==========================================
// 4. HÀM CHẤM ĐIỂM BẰNG GEMINI (PHIÊN BẢN BATCHING GỘP)
// ==========================================
async function judgeAnswerBatch(testPairs) {
    if (!testPairs || testPairs.length === 0) return [];

    // Biến mảng dữ liệu thành chuỗi JSON để đưa vào Prompt
    const jsonInput = JSON.stringify(testPairs.map((tp, index) => ({
        id: index,
        expected: tp.expected,
        actual: tp.actual
    })), null, 2);

    const prompt = `Bạn là chuyên gia QA Tester. Dưới đây là danh sách các cặp kết quả [Kỳ vọng] và [Thực tế] định dạng JSON.
    Hãy so sánh NGỮ NGHĨA và phân loại nhãn cho TỪNG cặp theo quy tắc:
    - [PASS]: Tỷ lệ giống >= 80%
    - [PARTIAL]: Tỷ lệ từ 50% đến 79%
    - [FAIL]: Tỷ lệ < 50%

    DỮ LIỆU ĐẦU VÀO:
    ${jsonInput}

    YÊU CẦU ĐẦU RA:
    Bạn PHẢI trả về DUY NHẤT một mảng JSON (không bọc trong markdown \`\`\`json, không giải thích thêm). Mỗi phần tử gồm:
    - "id": id tương ứng từ đầu vào
    - "judgment": Định dạng "[NHÃN] (X%) - Giải thích lý do."`;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().trim();
        
        // Dọn dẹp nếu Gemini lỡ bọc markdown
        if (text.startsWith('```json')) text = text.replace(/```json\n?/g, '');
        if (text.startsWith('```')) text = text.replace(/```\n?/g, '');
        if (text.endsWith('```')) text = text.replace(/```/g, '');

        return JSON.parse(text); // Trả về mảng kết quả
    } catch (error) {
        console.error("❌ Lỗi khi gọi Gemini Batching:", error);
        // Trả về lỗi mảng dự phòng để app không bị sập
        return testPairs.map((_, i) => ({ id: i, judgment: "[ERROR] Lỗi API Gemini" }));
    }
}

// ==========================================
// 5. HÀM CHẠY TEST CHÍNH
// ==========================================
async function writeResultToSheet(sheets, spreadsheetId, sheetName, rowNumber, actualAnswer, scoreResult) {
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!D${rowNumber}:E${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[actualAnswer, scoreResult]],
        },
    });
}

// ==========================================
// 5. HÀM CHẠY TEST CHÍNH (ĐÃ TỐI ƯU BATCHING)
// ==========================================
async function runTestCases(page, testCases, spreadsheetId, sheetName, chatInputSelector, sheets) {
    let results = { pass: 0, partial: 0, fail: 0, total: testCases.length, details: [] };
    let testPairs = [];

    // GIAI ĐOẠN 1: Tương tác Chatbot lấy tất cả câu trả lời (Không gọi Gemini ở đây)
    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];
        try {
            console.log(`\n▶ Đang lấy câu trả lời từ Bot câu ${i + 1}/${testCases.length}...`);
            const actualAnswer = await askChatbot(page, test.question, chatInputSelector);
            testPairs.push({ question: test.question, expected: test.expected, actual: actualAnswer });
            await page.waitForTimeout(500); 
        } catch (error) {
            console.error(`❌ Lỗi ở câu ${i + 1}:`, error.message);
            testPairs.push({ question: test.question, expected: test.expected, actual: "[ERROR] Bot không trả lời" });
        }
    }

    // GIAI ĐOẠN 2: Gọi Gemini 1 LẦN để chấm điểm tất cả
    console.log(`\n🤖 Đang gửi ${testPairs.length} câu cho Gemini chấm điểm chung...`);
    const judgments = await judgeAnswerBatch(testPairs);

    // GIAI ĐOẠN 3: Xử lý đếm kết quả và gom dữ liệu ghi Google Sheet
    const sheetUpdateValues = []; // Mảng chứa dữ liệu đẩy lên Sheet

    for (let i = 0; i < testPairs.length; i++) {
        const pair = testPairs[i];
        // Tìm điểm số tương ứng theo ID từ Gemini trả về
        const scoreResult = judgments.find(j => j.id === i)?.judgment || "[ERROR] Lỗi chấm điểm";

        // Đếm logic (Phiên bản chuẩn chỉnh)
        const scoreUpper = scoreResult.toUpperCase();
        if (scoreUpper.includes('[PASS]')) results.pass++;
        else if (scoreUpper.includes('[PARTIAL]')) results.partial++;
        else results.fail++;

        results.details.push({
            question: pair.question, expected: pair.expected,
            actual: pair.actual, judgment: scoreResult
        });

        // Đưa vào mảng dữ liệu Google Sheet [Thực tế, Đánh giá]
        sheetUpdateValues.push([pair.actual, scoreResult]);
        console.log(`  └ Câu ${i + 1}: ${scoreResult}`);
    }

    // GIAI ĐOẠN 4: Ghi TẤT CẢ vào Google Sheet bằng 1 lệnh duy nhất!
    try {
        console.log("\n📝 Đang ghi toàn bộ báo cáo vào Google Sheet...");
        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!D2:E${1 + sheetUpdateValues.length}`, // Quét 1 vùng lớn để ghi
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: sheetUpdateValues },
        });
        console.log("✅ Đã ghi thành công!");
    } catch (sheetError) {
        console.error("❌ Lỗi khi ghi vào Sheet:", sheetError);
    }

    return results;
}

// ==========================================
// 6. API ENDPOINT
// ==========================================
app.post('/api/run-test', async (req, res) => {
    const { targetUrl, chatbotIconSelector, chatInputSelector, sheetUrl, sheetName: requestedSheetName } = req.body;
    
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
        const sheetName = requestedSheetName || 'Trang tính1';
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
            chatInputSelector || '.sh-input-field',
            sheets
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
