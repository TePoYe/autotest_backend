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
async function runTestCases(page, testCases, spreadsheetId, sheetName, chatInputSelector, sheets, sendEvent) {
    let results = { pass: 0, partial: 0, fail: 0, total: testCases.length, details: [] };
    let testPairs = [];

    // GIAI ĐOẠN 1: Tương tác Chatbot lấy tất cả câu trả lời (Không gọi Gemini ở đây)
    for (let i = 0; i < testCases.length; i++) {
        const test = testCases[i];
        try {
            // 📢 PHÁT LOA: Báo cho Frontend biết đang chạy câu nào
            sendEvent({ type: "progress", message: `Đang lấy câu trả lời câu ${i + 1}/${testCases.length}...` });

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
    sendEvent({ type: "progress", message: `🤖 Đang gửi ${testPairs.length} câu cho AI Gemini chấm điểm...` });
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
        sendEvent({ type: "progress", message: `📝 Đang ghi báo cáo vào Google Sheet...` });
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
// 6. API ENDPOINT (SSE STREAMING)
// ==========================================
app.post('/api/run-test', async (req, res) => {
    // 1. Cấu hình Headers cho phép truyền dữ liệu liên tục (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Hàm tiện ích để gửi dữ liệu về Giao diện ngay lập tức
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // BẢO TOÀN LOGIC CŨ: Nhận requestedSheetName từ Frontend
    const { targetUrl, chatbotIconSelector, chatInputSelector, sheetUrl, sheetName: requestedSheetName } = req.body;
    
    if (!targetUrl || !sheetUrl) {
        sendEvent({ type: "error", message: "targetUrl và sheetUrl là bắt buộc!" });
        return res.end();
    }

    const sheetIdMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = sheetIdMatch ? sheetIdMatch[1] : null;

    if (!spreadsheetId) {
        sendEvent({ type: "error", message: "Link Google Sheet không hợp lệ!" });
        return res.end();
    }

    sendEvent({ type: "progress", message: "🚀 Đang khởi động trình duyệt ẩn..." });
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
        
        sendEvent({ type: "progress", message: "📄 Đang đọc dữ liệu kịch bản từ Google Sheet..." });
        
        // BẢO TOÀN LOGIC CŨ: Cho phép truyền tên Sheet động
        const sheetName = requestedSheetName || 'Trang tính1';
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!B2:C`,
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            sendEvent({ type: "error", message: "Không tìm thấy dữ liệu trên Sheet!" });
            return res.end();
        }

        const testCases = rows.map(row => ({
            question: row[0] || '',
            expected: row[1] || ''
        })).filter(tc => tc.question);

        browser = await chromium.launch({ 
            headless: true, 
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', '--disable-gpu',           
                '--single-process', '--no-zygote'              
            ] 
        });
        
        const page = await browser.newPage();
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'stylesheet', 'media', 'font'].includes(type)) route.abort();
            else route.continue();
        });
        
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        if (chatbotIconSelector) {
            await page.waitForSelector(chatbotIconSelector, { timeout: 10000 });
            await page.click(chatbotIconSelector);
            await page.waitForTimeout(2000);
        }

        // Truyền thêm hàm sendEvent vào runTestCases
        const results = await runTestCases(
            page, testCases, spreadsheetId, sheetName, 
            chatInputSelector || '.sh-input-field', sheets, sendEvent
        );

        // Phát loa báo cáo thành công và gửi toàn bộ dữ liệu cuối cùng
        sendEvent({ type: "success", message: "Kiểm thử hoàn tất!", data: results });

    } catch (error) {
        console.error("❌ Lỗi:", error);
        sendEvent({ type: "error", message: error.message });
    } finally {
        if (browser) await browser.close();
        res.end(); // 🛑 Kết thúc luồng stream
    }
});

// ==========================================
// 7. KHỞI ĐỘNG SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Backend hoạt động tại http://localhost:${PORT}`);
});
