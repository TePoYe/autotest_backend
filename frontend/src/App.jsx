import React, { useState, useRef, useEffect } from "react";
import {
  Bot,
  Globe,
  MousePointerClick,
  MessageSquare,
  Sheet,
  Lightbulb,
  Play,
  Loader2,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  ChevronRight,
  Circle,
  Wand2,
} from "lucide-react";

const LOG_STYLES = {
  info: "text-slate-400",
  success: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-rose-400",
};

// Kịch bản mẫu để người dùng nạp nhanh và thử các nút chức năng
const SAMPLE_SCENARIO = {
  url: "https://demo-shop.example.com",
  iconSelector: "#chatbot-icon",
  inputSelector: ".chat-input",
  sheetUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
};

function StatusDot({ active }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${
          active ? "bg-emerald-500" : "bg-slate-300"
        }`}
      />
    </span>
  );
}

function FieldLabel({ icon: Icon, children }) {
  return (
    <label className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 mb-1.5">
      <Icon className="w-3.5 h-3.5 text-slate-400" />
      {children}
    </label>
  );
}

export default function App() {
  const [form, setForm] = useState({
    url: "",
    iconSelector: "",
    inputSelector: "",
    sheetUrl: "",
  });
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [visibleLogs, setVisibleLogs] = useState([]);
  const [results, setResults] = useState(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleLogs]);

  const handleChange = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const loadSample = () => {
    if (status === "running") return;
    setForm(SAMPLE_SCENARIO);
  };

  const pushLog = (text, type = "info", icon = "▶") => {
    setVisibleLogs((prev) => [
      ...prev,
      {
        text,
        type,
        icon,
        time: new Date().toLocaleTimeString("vi-VN", { hour12: false }),
      },
    ]);
  };

  const runTest = async () => {
    if (status === "running") return;

    setVisibleLogs([]);
    setResults(null);
    setStatus("running");

    pushLog("Đang gửi yêu cầu kiểm thử đến API...", "info", "🌐");

    try {
      const response = await fetch("https://autotest-backend-sior.onrender.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: form.url,
          chatbotIconSelector: form.iconSelector,
          chatInputSelector: form.inputSelector,
          sheetUrl: form.sheetUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`Máy chủ trả về lỗi HTTP ${response.status}`);
      }

      pushLog("Đã nhận phản hồi từ máy chủ, đang xử lý dữ liệu...", "info", "📄");

      const result = await response.json();

      if (result.status !== "success" || !result.data) {
        throw new Error("Phản hồi API không đúng định dạng mong đợi");
      }

      pushLog("Kiểm thử hoàn tất thành công", "success", "✅");

      setResults({
        pass: result.data.pass ?? 0,
        partial: result.data.partial ?? 0,
        fail: result.data.fail ?? 0,
      });
      setStatus("done");
    } catch (err) {
      pushLog(
        `Lỗi khi gọi API: ${err.message || "Không thể kết nối đến máy chủ"}`,
        "error",
        "❌"
      );
      setStatus("error");
    }
  };

  const isRunning = status === "running";
  const canRun = form.url.trim().length > 0 && !isRunning;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 font-sans">
      {/* Thanh trên cùng */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-200">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight tracking-tight">
                BotTester Hub
              </h1>
              <p className="text-[11px] text-slate-400 leading-tight">
                Bảng điều khiển kiểm thử tự động nội bộ
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200">
            <StatusDot active={isRunning} />
            <span className="text-xs font-medium text-slate-600">
              {isRunning
                ? "Đang chạy kiểm thử"
                : status === "done"
                ? "Lần chạy gần nhất đã hoàn tất"
                : status === "error"
                ? "Lần chạy gần nhất bị lỗi"
                : "Đang chờ"}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* CỘT TRÁI: Cấu hình */}
          <section className="lg:col-span-2">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start justify-between gap-3 mb-0.5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Cấu hình kiểm thử
                </h2>
                <button
                  onClick={loadSample}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-indigo-600 hover:text-indigo-700 disabled:text-slate-300 disabled:cursor-not-allowed shrink-0"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Nạp kịch bản mẫu
                </button>
              </div>
              <p className="text-[13px] text-slate-400 mb-5">
                Trỏ trình chạy đến chatbot và bảng dữ liệu kịch bản của bạn.
              </p>

              <div className="space-y-4">
                <div>
                  <FieldLabel icon={Globe}>Địa chỉ Website đích</FieldLabel>
                  <input
                    type="text"
                    value={form.url}
                    onChange={handleChange("url")}
                    placeholder="https://example.com"
                    disabled={isRunning}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 transition"
                  />
                </div>

                <div>
                  <FieldLabel icon={MousePointerClick}>
                    CSS Selector của icon Chatbot
                  </FieldLabel>
                  <input
                    type="text"
                    value={form.iconSelector}
                    onChange={handleChange("iconSelector")}
                    placeholder="#chatbot-icon"
                    disabled={isRunning}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono placeholder:text-slate-400 placeholder:font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 transition"
                  />
                </div>

                <div>
                  <FieldLabel icon={MessageSquare}>
                    CSS Selector của ô nhập chat
                  </FieldLabel>
                  <input
                    type="text"
                    value={form.inputSelector}
                    onChange={handleChange("inputSelector")}
                    placeholder=".chat-input"
                    disabled={isRunning}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono placeholder:text-slate-400 placeholder:font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 transition"
                  />
                </div>

                <div>
                  <FieldLabel icon={Sheet}>URL Google Sheet (dữ liệu kịch bản)</FieldLabel>
                  <input
                    type="text"
                    value={form.sheetUrl}
                    onChange={handleChange("sheetUrl")}
                    placeholder="https://docs.google.com/spreadsheets/..."
                    disabled={isRunning}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 transition"
                  />
                </div>

                {/* Hộp thông tin */}
                <div className="flex gap-2.5 bg-indigo-50 border border-indigo-100 rounded-lg px-3.5 py-3">
                  <Lightbulb className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] leading-relaxed text-indigo-900">
                    <span className="font-medium">Mẹo:</span> Nhấn{" "}
                    <kbd className="px-1 py-0.5 rounded bg-white border border-indigo-200 text-[11px] font-mono">
                      F12
                    </kbd>{" "}
                    để mở DevTools → chuột phải vào phần tử → Copy → Copy
                    selector.
                  </p>
                </div>

                {/* Nút hành động */}
                <button
                  onClick={runTest}
                  disabled={!canRun}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all shadow-sm ${
                    !canRun && !isRunning
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : isRunning
                      ? "bg-indigo-500 text-white cursor-wait"
                      : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.99] shadow-indigo-200"
                  }`}
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Đang chạy kiểm thử...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Bắt đầu kiểm thử tự động
                    </>
                  )}
                </button>
                {!form.url.trim() && (
                  <p className="text-[11px] text-slate-400 text-center -mt-2">
                    Nhập URL đích hoặc bấm "Nạp kịch bản mẫu" để bắt đầu.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* CỘT PHẢI: Trạng thái trực tiếp & kết quả */}
          <section className="lg:col-span-3 flex flex-col gap-6">
            {/* Terminal */}
            <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-800 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/40">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  <span className="ml-2 flex items-center gap-1.5 text-slate-400 text-xs font-mono">
                    <Terminal className="w-3.5 h-3.5" />
                    bottester-runner
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot active={isRunning} />
                  <span className="text-[11px] font-mono text-slate-500">
                    {isRunning
                      ? "đang chạy"
                      : status === "done"
                      ? "đã xong"
                      : status === "error"
                      ? "lỗi"
                      : "chờ"}
                  </span>
                </div>
              </div>

              <div className="log-scroll p-4 h-[380px] overflow-y-auto font-mono text-[12.5px] leading-relaxed">
                {visibleLogs.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                    <Sparkles className="w-6 h-6 text-slate-700" />
                    <p className="text-slate-500 text-sm">
                      Nhật ký console sẽ hiển thị tại đây khi bắt đầu kiểm thử.
                    </p>
                  </div>
                )}
                {visibleLogs.map((log, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-0.5 animate-[fadeIn_0.2s_ease-out]"
                  >
                    <span className="text-slate-600 shrink-0">{log.time}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />
                    <span className={LOG_STYLES[log.type]}>
                      <span className="mr-1.5">{log.icon}</span>
                      {log.text}
                    </span>
                  </div>
                ))}
                {isRunning && (
                  <div className="flex items-center gap-2 py-1 text-slate-500">
                    <span className="w-1.5 h-3.5 bg-indigo-400 animate-pulse inline-block" />
                  </div>
                )}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Thẻ tổng kết */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  Tổng kết kết quả
                </h2>
                {results && (
                  <span className="text-[11px] font-medium text-slate-400">
                    Dữ liệu từ API
                  </span>
                )}
              </div>

              {!results ? (
                <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                  <Circle className="w-5 h-5 text-slate-300" />
                  <p className="text-[13px] text-slate-400">
                    {status === "error"
                      ? "Không lấy được kết quả do lỗi kết nối API."
                      : "Kết quả sẽ hiển thị sau khi hoàn tất một lần kiểm thử."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-4 flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
                      {results.pass}
                    </span>
                    <span className="text-[11.5px] font-medium text-emerald-600">
                      Đạt
                    </span>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-4 flex flex-col items-center gap-1.5">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <span className="text-2xl font-semibold text-amber-700 tabular-nums">
                      {results.partial}
                    </span>
                    <span className="text-[11.5px] font-medium text-amber-600">
                      Một phần
                    </span>
                  </div>
                  <div className="rounded-lg bg-rose-50 border border-rose-100 px-4 py-4 flex flex-col items-center gap-1.5">
                    <XCircle className="w-5 h-5 text-rose-400" />
                    <span className="text-2xl font-semibold text-rose-700 tabular-nums">
                      {results.fail}
                    </span>
                    <span className="text-[11.5px] font-medium text-rose-600">
                      Không đạt
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .log-scroll {
          scrollbar-width: thin;
          scrollbar-color: #475569 #0f172a;
        }
        .log-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .log-scroll::-webkit-scrollbar-track {
          background: #0f172a;
        }
        .log-scroll::-webkit-scrollbar-thumb {
          background-color: #475569;
          border-radius: 9999px;
          border: 2px solid #0f172a;
        }
        .log-scroll::-webkit-scrollbar-thumb:hover {
          background-color: #64748b;
        }
      `}</style>
    </div>
  );
}