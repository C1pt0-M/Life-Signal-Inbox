import React, { useEffect, useMemo, useState } from "react";

import {
  configureAi,
  exportIcs,
  extractNotice,
  getConfig,
  getHistory,
  getSamples,
  saveTodos,
  uploadImageAndExtract,
  validateTodos,
} from "./api.js";
import {
  applyQuadrantOverrides,
  buildAiConfigPayload,
  buildManualTodoItem,
  calculateProgress,
  describeAiExtractor,
  formatAssistantExtraction,
  formatDateTime,
  formatFullNow,
  groupByQuadrant,
  QUADRANTS,
  serializeContacts,
  serializeMaterials,
  updateEditableItem,
  updateQuadrantOverride,
} from "./taskUtils.js";

const SOURCE_TYPES = ["微信群", "短信", "课程通知", "社区公告", "报名信息", "截图文字"];
const QUADRANT_STORAGE_KEY = "life-signal-inbox-quadrants";
const DEFAULT_MANUAL_FORM = {
  title: "",
  date: todayInputValue(),
  startTime: "09:00",
  endTime: "10:00",
  recurrence: "none",
  location: "",
  notes: "",
  quadrant: "important_not_urgent",
};

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export default function App() {
  const [activePage, setActivePage] = useState("todos");
  const [now, setNow] = useState(new Date());
  const [samples, setSamples] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [sourceType, setSourceType] = useState("微信群");
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState("2026-04-20");
  const [draggedItemId, setDraggedItemId] = useState("");
  const [quadrantOverrides, setQuadrantOverrides] = useState(loadQuadrantOverrides);
  const [manualForm, setManualForm] = useState(DEFAULT_MANUAL_FORM);
  const [appConfig, setAppConfig] = useState(null);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiConfigMessage, setAiConfigMessage] = useState("");
  const [aiConfigForm, setAiConfigForm] = useState({
    provider: "openai-compatible",
    api_key: "",
    model: "gpt-4o-mini",
    base_url: "https://api.openai.com/v1",
  });
  const [messages, setMessages] = useState([
    { id: "intro", role: "assistant", text: "把通知、截图文字或需要确认的信息发给我，我会整理成待办和待确认项。" },
  ]);

  useEffect(() => {
    getSamples().then(setSamples).catch(() => setSamples([]));
    getConfig()
      .then((config) => {
        setAppConfig(config);
        syncAiConfigForm(config);
      })
      .catch(() => setAppConfig(null));
    refreshHistory();
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(QUADRANT_STORAGE_KEY, JSON.stringify(quadrantOverrides));
  }, [quadrantOverrides]);

  const visibleItems = useMemo(
    () => applyQuadrantOverrides([...(result?.items || []), ...history], quadrantOverrides),
    [result, history, quadrantOverrides]
  );
  const progress = calculateProgress(history);
  const grouped = groupByQuadrant(visibleItems);

  async function refreshHistory() {
    try {
      setHistory(await getHistory());
    } catch {
      setHistory([]);
    }
  }

  function syncAiConfigForm(config) {
    const extractor = config?.ai_extractor;
    if (!extractor?.enabled) return;
    setAiConfigForm((current) => ({
      ...current,
      provider: extractor.provider || current.provider,
      model: extractor.model || current.model,
      base_url: extractor.base_url || current.base_url,
      api_key: "",
    }));
  }

  async function handleAiConfigSubmit(event) {
    event.preventDefault();
    const payload = buildAiConfigPayload(aiConfigForm);
    if (!payload.api_key) {
      setAiConfigMessage("请填写模型密钥，提交后只保存在后端运行内存中。");
      return;
    }
    setIsLoading(true);
    setError("");
    setAiConfigMessage("");
    try {
      const data = await configureAi(payload);
      setAppConfig(data);
      setAiConfigForm((current) => ({ ...current, api_key: "" }));
      setAiConfigMessage("模型配置已启用，本次后端运行期间生效。");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExtract(text = input, fromAssistant = false) {
    if (!text.trim()) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await extractNotice({
        text,
        source_type: sourceType,
        current_date: "2026-04-19",
        timezone: "Asia/Shanghai",
      });
      setResult(data);
      if (fromAssistant) {
        const stamp = Date.now();
        setMessages((current) => [
          ...current,
          { id: `user-${stamp}`, role: "user", text },
          {
            id: `assistant-${stamp}`,
            role: "assistant",
            text: formatAssistantExtraction(data),
          },
        ]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    if (!result?.items?.length) return;
    setIsLoading(true);
    setError("");
    try {
      await saveTodos(result.items.map((item) => ({ ...item, status: "todo" })));
      setResult(null);
      setInput("");
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    if (!manualForm.title.trim()) {
      setError("请先填写事件。");
      return;
    }
    if (!manualForm.date || !manualForm.startTime) {
      setError("请选择日期和开始时间。");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const item = buildManualTodoItem(manualForm, { timezone: "Asia/Shanghai" });
      await saveTodos([item]);
      setManualForm((current) => ({ ...DEFAULT_MANUAL_FORM, date: current.date }));
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleEditItem(itemId, patch) {
    setResult((current) => {
      if (!current) return current;
      const items = updateEditableItem(current.items, itemId, patch);
      return {
        ...current,
        items,
        context: current.context ? { ...current.context, recognized_items: items } : current.context,
      };
    });
  }

  async function handleRevalidate() {
    if (!result?.items?.length) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await validateTodos(result.items);
      setResult((current) => (current ? { ...current, validation: data.validation } : current));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpload(event, target = "input") {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await uploadImageAndExtract(file, {
        source_type: "截图文字",
        current_date: "2026-04-19",
        timezone: "Asia/Shanghai",
      });
      const extractedText = data.ocr?.text || "";
      setResult(data);
      setInput(extractedText);
      setSourceType("截图文字");
      if (target === "assistant") {
        const stamp = Date.now();
        const detectedType = data.json_debug?.ocr_preprocess?.detected_type;
        const assistantText =
          detectedType === "timetable"
            ? `已识别为课表类截图。OCR 文本存在行列丢失，建议核对课程时间后再加入待办。\n\n${formatAssistantExtraction(data)}`
            : formatAssistantExtraction(data);
        setMessages((current) => [
          ...current,
          { id: `upload-${stamp}`, role: "user", text: `上传截图：${file.name}` },
          { id: `assistant-${stamp}`, role: "assistant", text: assistantText },
        ]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      event.target.value = "";
      setIsLoading(false);
    }
  }

  function applySample(sample) {
    setInput(sample.text);
    setSourceType(sample.source_type);
    setActivePage("todos");
  }

  function moveItemToQuadrant(itemId, quadrant) {
    setQuadrantOverrides((current) => updateQuadrantOverride(current, itemId, quadrant));
    setDraggedItemId("");
  }

  return (
    <main className="app-shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark">LS</span>
          <div>
            <strong>Life Signal Inbox</strong>
            <small>生活信号收件箱</small>
          </div>
        </div>
        <nav>
          <button className={activePage === "todos" ? "active" : ""} onClick={() => setActivePage("todos")}>
            待办清单
          </button>
          <button className={activePage === "quadrants" ? "active" : ""} onClick={() => setActivePage("quadrants")}>
            四象限规划
          </button>
          <button className={activePage === "assistant" ? "active" : ""} onClick={() => setActivePage("assistant")}>
            AI 助手
          </button>
        </nav>
        <div className="rail-note">
          <span>AI 模型设置</span>
          <p>可在前端临时配置，也可读取 backend/.env。</p>
          <strong>{describeAiExtractor(appConfig)}</strong>
          <button className="rail-config-button" onClick={() => setAiConfigOpen((current) => !current)}>
            {aiConfigOpen ? "收起配置" : "前端配置模型"}
          </button>
          {aiConfigOpen && (
            <form className="ai-config-form" onSubmit={handleAiConfigSubmit}>
              <label>
                服务类型
                <input
                  value={aiConfigForm.provider}
                  onChange={(event) => setAiConfigForm((current) => ({ ...current, provider: event.target.value }))}
                />
              </label>
              <label>
                模型名称
                <input
                  value={aiConfigForm.model}
                  onChange={(event) => setAiConfigForm((current) => ({ ...current, model: event.target.value }))}
                />
              </label>
              <label>
                接口地址
                <input
                  value={aiConfigForm.base_url}
                  onChange={(event) => setAiConfigForm((current) => ({ ...current, base_url: event.target.value }))}
                />
              </label>
              <label>
                模型密钥
                <input
                  type="password"
                  value={aiConfigForm.api_key}
                  placeholder="只在本次后端运行期间生效"
                  onChange={(event) => setAiConfigForm((current) => ({ ...current, api_key: event.target.value }))}
                />
              </label>
              <button type="submit" disabled={isLoading}>
                {isLoading ? "保存中..." : "保存配置"}
              </button>
              {aiConfigMessage && <p>{aiConfigMessage}</p>}
            </form>
          )}
        </div>
      </aside>

      <section className="workspace">
        {error && <div className="error-banner">{error}</div>}
        {activePage === "todos" && (
          <TodoPage
            now={now}
            progress={progress}
            manualForm={manualForm}
            setManualForm={setManualForm}
            result={result}
            history={history}
            isLoading={isLoading}
            onManualSubmit={handleManualSubmit}
            onSave={handleSave}
            onExport={exportIcs}
            onJson={() => setJsonOpen(true)}
            onEditItem={handleEditItem}
            onRevalidate={handleRevalidate}
          />
        )}
        {activePage === "quadrants" && (
          <QuadrantPage
            now={now}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            grouped={grouped}
            draggedItemId={draggedItemId}
            setDraggedItemId={setDraggedItemId}
            onMoveItem={moveItemToQuadrant}
          />
        )}
        {activePage === "assistant" && (
          <AssistantPage
            messages={messages}
            result={result}
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            onSend={() => handleExtract(input, true)}
            onUpload={(event) => handleUpload(event, "assistant")}
          />
        )}
      </section>

      {jsonOpen && (
        <div
          className="modal-backdrop"
          role="button"
          tabIndex={0}
          aria-label="关闭 JSON 弹窗"
          onClick={(event) => {
            if (event.target === event.currentTarget) setJsonOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter") setJsonOpen(false);
          }}
        >
          <section className="json-modal" role="dialog" aria-modal="true">
            <header>
              <h2>结构化 JSON</h2>
              <button onClick={() => setJsonOpen(false)}>关闭</button>
            </header>
            <pre>{JSON.stringify(result || { history }, null, 2)}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

function loadQuadrantOverrides() {
  try {
    const raw = window.localStorage.getItem(QUADRANT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function TodoPage(props) {
  const allItems = [...(props.result?.items || []), ...props.history];
  return (
    <div className="page-stack">
      <header className="page-top">
        <div>
          <span className="eyebrow">当前时间</span>
          <h1>{formatFullNow(props.now)}</h1>
          <p>Asia/Shanghai</p>
        </div>
        <div className="progress-box">
          <span>今日完成</span>
          <strong>
            {props.progress.done}/{props.progress.total}
          </strong>
          <div className="progress-track">
            <i style={{ width: `${props.progress.percent}%` }} />
          </div>
          <small>{props.progress.percent}%</small>
        </div>
      </header>

      <section className="todo-layout">
        <div className="input-panel">
          <ManualTodoForm
            form={props.manualForm}
            setForm={props.setManualForm}
            isLoading={props.isLoading}
            onSubmit={props.onManualSubmit}
          />
          {props.result?.ocr && <OcrSummary ocr={props.result.ocr} />}
          {props.result && <ValidationPanel result={props.result} />}
          {props.result && (
            <ConfirmationEditor
              items={props.result.items}
              pendingConfirmations={props.result.validation.pending_confirmations}
              isLoading={props.isLoading}
              onEditItem={props.onEditItem}
              onRevalidate={props.onRevalidate}
            />
          )}
        </div>

        <div className="todo-panel">
          <div className="section-title">
            <h2>待办事项</h2>
            <span>{allItems.length} 个生活信号</span>
          </div>
          <div className="toolbar">
            <button onClick={props.onSave} disabled={!props.result?.items?.length}>
              加入待办清单
            </button>
            <button onClick={props.onExport}>导出 ICS</button>
            <button onClick={props.onJson}>查看 JSON</button>
          </div>
          <div className="todo-list">
            {allItems.length ? allItems.map((item) => <TaskRow key={item.id} item={item} />) : <EmptyState />}
          </div>
        </div>
      </section>
    </div>
  );
}

function ManualTodoForm({ form, setForm, isLoading, onSubmit }) {
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="manual-form" onSubmit={onSubmit}>
      <div className="section-title">
        <h2>手动添加待办</h2>
        <span>事件 / 时间 / 重复 / 四象限</span>
      </div>
      <label className="wide">
        事件
        <input value={form.title} placeholder="例如：程序设计基础" onChange={(event) => update("title", event.target.value)} />
      </label>
      <div className="manual-grid">
        <label>
          日期
          <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} />
        </label>
        <label>
          开始
          <input type="time" value={form.startTime} onChange={(event) => update("startTime", event.target.value)} />
        </label>
        <label>
          结束
          <input type="time" value={form.endTime} onChange={(event) => update("endTime", event.target.value)} />
        </label>
      </div>
      <label className="wide">
        是否重复
        <select value={form.recurrence} onChange={(event) => update("recurrence", event.target.value)}>
          <option value="none">不重复</option>
          <option value="daily">每天这个时段</option>
          <option value="weekdays">每个工作日</option>
          <option value="holidays">每个节假日（初版按周末）</option>
        </select>
      </label>
      <label className="wide">
        地点
        <input value={form.location} placeholder="可选，例如：博达校区1号教学楼" onChange={(event) => update("location", event.target.value)} />
      </label>
      <label className="wide">
        备注
        <textarea value={form.notes} placeholder="可选，例如：带电脑、提前10分钟到" onChange={(event) => update("notes", event.target.value)} />
      </label>
      <label className="wide">
        四象限
        <select value={form.quadrant} onChange={(event) => update("quadrant", event.target.value)}>
          {Object.entries(QUADRANTS).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.title}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" type="submit" disabled={isLoading}>
        {isLoading ? "保存中..." : "加入待办清单"}
      </button>
    </form>
  );
}

function ConfirmationEditor({ items, pendingConfirmations, isLoading, onEditItem, onRevalidate }) {
  const pendingIds = new Set(pendingConfirmations.map((item) => item.item_id));
  const editableItems = items.filter((item) => pendingIds.has(item.id));
  if (!editableItems.length) {
    return (
      <section className="confirmation-editor clean">
        <strong>待确认项</strong>
        <p>当前结构化结果没有待确认字段。</p>
      </section>
    );
  }

  return (
    <section className="confirmation-editor">
      <div className="editor-head">
        <div>
          <strong>待确认项编辑</strong>
          <p>补齐字段后重新验证，再加入待办清单。</p>
        </div>
        <button onClick={onRevalidate} disabled={isLoading}>
          {isLoading ? "验证中..." : "重新验证"}
        </button>
      </div>
      {editableItems.map((item) => (
        <article key={item.id}>
          <label>
            标题
            <input value={item.title || ""} onChange={(event) => onEditItem(item.id, { title: event.target.value })} />
          </label>
          <label>
            时间
            <input
              value={item.time?.start || ""}
              placeholder="2026-04-20T09:00:00+08:00"
              onChange={(event) => onEditItem(item.id, { start: event.target.value })}
            />
          </label>
          <label>
            地点
            <input value={item.location || ""} onChange={(event) => onEditItem(item.id, { location: event.target.value })} />
          </label>
          <label>
            材料
            <input
              value={serializeMaterials(item.materials)}
              placeholder="身份证、水杯"
              onChange={(event) => onEditItem(item.id, { materialsText: event.target.value })}
            />
          </label>
          <label>
            联系人
            <input
              value={serializeContacts(item.contacts)}
              placeholder="王老师 13800138000"
              onChange={(event) => onEditItem(item.id, { contactsText: event.target.value })}
            />
          </label>
        </article>
      ))}
    </section>
  );
}

function QuadrantPage({ now, selectedDate, setSelectedDate, grouped, draggedItemId, setDraggedItemId, onMoveItem }) {
  return (
    <div className="page-stack">
      <header className="page-top">
        <div>
          <span className="eyebrow">当前时间</span>
          <h1>{formatFullNow(now)}</h1>
          <p>把提取后的事项按重要性和紧急度整理。</p>
        </div>
        <label className="date-picker">
          <span>选择规划日期</span>
          <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
      </header>
      <div className="drag-hint">拖动事项卡片到任意象限，调整后的规划会保存在本机浏览器。</div>
      <section className="quadrant-grid">
        {Object.entries(QUADRANTS).map(([key, meta]) => (
          <div
            className={`quadrant ${meta.tone} ${draggedItemId ? "drop-ready" : ""}`}
            key={key}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const itemId = event.dataTransfer.getData("text/plain") || draggedItemId;
              onMoveItem(itemId, key);
            }}
          >
            <header>
              <h2>{meta.title}</h2>
              <span>{grouped[key].length} 项</span>
            </header>
            <div className="quadrant-items">
              {grouped[key].map((item) => (
                <article
                  className={draggedItemId === item.id ? "dragging" : ""}
                  draggable
                  key={item.id}
                  onDragStart={(event) => {
                    setDraggedItemId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => setDraggedItemId("")}
                >
                  <strong>{item.title}</strong>
                  <span>{formatDateTime(item.time?.start)}</span>
                </article>
              ))}
              {!grouped[key].length && <div className="drop-empty">拖到这里</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function AssistantPage({ messages, result, input, setInput, isLoading, onSend, onUpload }) {
  return (
    <div className="assistant-layout">
      <section className="chat-panel">
        <header className="section-title">
          <h2>AI 助手</h2>
          <span>文本交流 / 截图提取 / 事项确认</span>
        </header>
        <div className="message-list">
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              {message.text}
            </div>
          ))}
        </div>
        <div className="assistant-input">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入通知、问题或需要确认的信息..." />
          <div className="action-row">
            <label className="file-button">
              上传截图并提取
              <input type="file" accept="image/*" onChange={onUpload} />
            </label>
            <button className="primary" onClick={onSend} disabled={isLoading}>
              {isLoading ? "整理中..." : "发送并提取"}
            </button>
          </div>
        </div>
      </section>
      <aside className="structure-panel">
        <header className="section-title">
          <h2>结构化结果</h2>
          <span>便于调试和确认</span>
        </header>
        {result ? (
          <>
            {result.ocr && <OcrSummary ocr={result.ocr} />}
            <ValidationPanel result={result} />
            <pre>{JSON.stringify(result.items[0] || {}, null, 2)}</pre>
          </>
        ) : (
          <EmptyState text="提取后会在这里显示 JSON、可信度和待确认项。" />
        )}
      </aside>
    </div>
  );
}

function TaskRow({ item }) {
  const missing = [];
  if (!item.location) missing.push("缺地点");
  const note = item.notes || (item.materials?.length ? `材料：${item.materials.join("、")}` : "");
  return (
    <article className="task-row">
      <div>
        <strong>{item.title}</strong>
        <p>{item.evidence}</p>
      </div>
      <dl>
        <div>
          <dt>时间</dt>
          <dd>{formatDateTime(item.time?.start)}</dd>
        </div>
        <div>
          <dt>地点</dt>
          <dd>{item.location || "待确认"}</dd>
        </div>
        <div>
          <dt>重复</dt>
          <dd>{item.recurrence?.label || "不重复"}</dd>
        </div>
        <div>
          <dt>备注</dt>
          <dd>{note || "无"}</dd>
        </div>
      </dl>
      <div className="task-meta">
        <span className="confidence">可信度 {Math.round((item.confidence || 0) * 100)}%</span>
        <span>{item.source_type}</span>
        {missing.map((chip) => (
          <em key={chip}>{chip}</em>
        ))}
      </div>
    </article>
  );
}

function ValidationPanel({ result }) {
  return (
    <section className="validation-panel">
      <div>
        <strong>质量评分 {result.validation.score}</strong>
        <span>{result.validation.has_blockers ? "需要确认后执行" : "可加入待办清单"}</span>
      </div>
      <ul>
        {result.validation.issues.length ? (
          result.validation.issues.map((issue) => <li key={`${issue.item_id}-${issue.type}-${issue.message}`}>{issue.message}</li>)
        ) : (
          <li>没有发现明显冲突或缺失字段。</li>
        )}
      </ul>
    </section>
  );
}

function OcrSummary({ ocr }) {
  return (
    <section className="ocr-summary">
      <div>
        <strong>截图识别与理解</strong>
        <span>识别可信度 {Math.round((ocr.confidence || 0) * 100)}%</span>
      </div>
      <p>{ocr.text || "没有识别出文字"}</p>
    </section>
  );
}

function EmptyState({ text = "还没有事项。先粘贴一条通知，或选择演示样例。" }) {
  return <div className="empty-state">{text}</div>;
}
