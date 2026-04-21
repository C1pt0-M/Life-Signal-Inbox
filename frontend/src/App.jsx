import React, { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";

import {
  configureAi,
  deleteTodo,
  exportIcs,
  extractNotice,
  getConfig,
  getHistory,
  getSamples,
  saveTodos,
  updateTodo,
  uploadImageAndExtract,
  validateTodos,
} from "./api.js";
import {
  buildAiConfigPayload,
  buildCalendarMonth,
  buildExtractionPayload,
  buildManualTodoItem,
  buildSaveableAssistantItems,
  buildTodoUpdate,
  calculateProgress,
  calculateTodoOverview,
  describeAiExtractor,
  expandCalendarItems,
  filterTodoItems,
  formatAssistantExtraction,
  formatDateTime,
  formatFullNow,
  getCalendarDayItems,
  getDueReminders,
  getImageFileFromClipboardEvent,
  groupByQuadrant,
  QUADRANTS,
  serializeContacts,
  serializeMaterials,
  splitTodoItems,
  todayInTimezone,
  updateEditableItem,
} from "./taskUtils.js";

const SOURCE_TYPES = ["微信群", "短信", "课程通知", "社区公告", "报名信息", "截图文字"];
const DEFAULT_MANUAL_FORM = {
  title: "",
  date: todayInputValue(),
  startTime: "09:00",
  endTime: "10:00",
  recurrence: "none",
  location: "",
  notes: "",
  reminder: "0",
  quadrant: "important_not_urgent",
};
const REMINDER_OPTIONS = [
  { value: "0", label: "不提醒" },
  { value: "5", label: "提前5分钟" },
  { value: "15", label: "提前15分钟" },
  { value: "30", label: "提前30分钟" },
  { value: "60", label: "提前1小时" },
  { value: "1440", label: "提前1天" },
];
const DEFAULT_TODO_FILTERS = {
  query: "",
  status: "all",
  quadrant: "all",
  timeScope: "all",
};

function todayInputValue() {
  return todayInTimezone();
}

function currentCalendarCursor() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
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
  const [selectedDate, setSelectedDate] = useState(todayInputValue());
  const [calendarCursor, setCalendarCursor] = useState(() => currentCalendarCursor());
  const [selectedCalendarEntry, setSelectedCalendarEntry] = useState(null);
  const [calendarEditMode, setCalendarEditMode] = useState(false);
  const [todoFilters, setTodoFilters] = useState(DEFAULT_TODO_FILTERS);
  const [draggedItemId, setDraggedItemId] = useState("");
  const [manualForm, setManualForm] = useState(DEFAULT_MANUAL_FORM);
  const [editingTodo, setEditingTodo] = useState(null);
  const [editForm, setEditForm] = useState(DEFAULT_MANUAL_FORM);
  const [activeReminder, setActiveReminder] = useState(null);
  const [seenReminderKeys, setSeenReminderKeys] = useState(() => new Set());
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
    { id: "intro", role: "assistant", text: "把凌乱的通知、截图或想法发给我，我会帮你分拣成清晰的待办事项。" },
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
    const checkReminders = () => {
      const due = getDueReminders(history, new Date(), seenReminderKeys);
      if (!due.length) return;
      const [next] = due;
      setActiveReminder(next);
      setSeenReminderKeys((current) => new Set([...current, next.reminder_key]));
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [history, seenReminderKeys]);

  const visibleItems = useMemo(
    () => [...(result?.items || []), ...history],
    [result, history]
  );
  const progress = calculateProgress(history);
  const todoOverview = useMemo(() => calculateTodoOverview(history, now), [history, now]);
  const filteredHistory = useMemo(() => filterTodoItems(history, todoFilters, now), [history, todoFilters, now]);
  const quadrantEntries = useMemo(
    () => expandCalendarItems(visibleItems, selectedDate, selectedDate).map((entry) => entry.item),
    [visibleItems, selectedDate]
  );
  const grouped = groupByQuadrant(quadrantEntries);
  const calendarDays = useMemo(() => buildCalendarMonth(calendarCursor.year, calendarCursor.month), [calendarCursor]);
  const calendarEntries = useMemo(
    () => expandCalendarItems(history, calendarDays[0]?.iso, calendarDays[calendarDays.length - 1]?.iso),
    [history, calendarDays]
  );

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
      const data = await extractNotice(buildExtractionPayload(text, sourceType));
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

  async function handleAssistantSave() {
    if (!result?.items?.length) return;
    setIsLoading(true);
    setError("");
    try {
      const items = buildSaveableAssistantItems(result.items);
      await saveTodos(items);
      await refreshHistory();
      const stamp = Date.now();
      setMessages((current) => [
        ...current,
        {
          id: `assistant-save-${stamp}`,
          role: "assistant",
          text: `已加入待办清单：${items.length} 个事项。`,
        },
      ]);
      setResult(null);
      setInput("");
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

  function startEditTodo(item) {
    setEditingTodo(item);
    setEditForm(todoToForm(item));
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingTodo) return;
    setIsLoading(true);
    setError("");
    try {
      await updateTodo(buildTodoUpdate(editingTodo, editForm));
      setEditingTodo(null);
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCalendarEditSubmit(event) {
    event.preventDefault();
    if (!selectedCalendarEntry) return;
    setIsLoading(true);
    setError("");
    try {
      await updateTodo(buildTodoUpdate(selectedCalendarEntry.item, editForm));
      setCalendarEditMode(false);
      setSelectedCalendarEntry(null);
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleTodo(item) {
    const nextStatus = item.status === "done" ? "todo" : "done";
    setIsLoading(true);
    setError("");
    try {
      await updateTodo({ ...item, status: nextStatus });
      await refreshHistory();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteTodo(item) {
    setIsLoading(true);
    setError("");
    try {
      await deleteTodo(item.id);
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCalendarToggle(item) {
    await handleToggleTodo(item);
    setSelectedCalendarEntry(null);
  }

  async function handleCalendarDelete(item) {
    await handleDeleteTodo(item);
    setSelectedCalendarEntry(null);
  }

  function handleCalendarEdit(item) {
    setEditForm(todoToForm(item));
    setCalendarEditMode(true);
  }

  function closeCalendarDetail() {
    setSelectedCalendarEntry(null);
    setCalendarEditMode(false);
  }

  function shiftCalendarMonth(offset) {
    setCalendarCursor((current) => {
      const next = new Date(current.year, current.month - 1 + offset, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
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

  async function handleImageFile(file, target = "assistant") {
    if (!file) return;
    setIsLoading(true);
    setError("");
    try {
      const data = await uploadImageAndExtract(file, {
        source_type: "截图文字",
        current_date: todayInTimezone(),
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
      setIsLoading(false);
    }
  }

  async function handleUpload(event, target = "assistant") {
    const file = event.target.files?.[0];
    await handleImageFile(file, target);
    event.target.value = "";
  }

  async function handleAssistantPaste(event) {
    const file = getImageFileFromClipboardEvent(event);
    if (!file) return;
    event.preventDefault();
    await handleImageFile(file, "assistant");
  }

  function applySample(sample) {
    setInput(sample.text);
    setSourceType(sample.source_type);
    setActivePage("todos");
  }

  async function moveItemToQuadrant(itemId, quadrant) {
    const item = visibleItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setDraggedItemId("");
    if (item.source_type !== "手动添加" && result?.items?.some((candidate) => candidate.id === itemId)) {
      setResult((current) => {
        if (!current) return current;
        const items = current.items.map((candidate) => (candidate.id === itemId ? { ...candidate, quadrant } : candidate));
        return { ...current, items, context: current.context ? { ...current.context, recognized_items: items } : current.context };
      });
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await updateTodo({ ...item, quadrant });
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="fabric-header">
        <div className="fabric-brand">
          Woven & Weft
          <small>Life Signal Inbox</small>
        </div>
        <nav className="fabric-nav">
          <button className={activePage === "todos" ? "active" : ""} onClick={() => setActivePage("todos")}>
            待办清单
          </button>
          <button
            className={activePage === "quadrants" ? "active" : ""}
            onClick={() => {
              setSelectedDate(todayInputValue());
              setActivePage("quadrants");
            }}
          >
            四象限规划
          </button>
          <button className={activePage === "calendar" ? "active" : ""} onClick={() => setActivePage("calendar")}>
            日历总览
          </button>
          <button className={activePage === "assistant" ? "active" : ""} onClick={() => setActivePage("assistant")}>
            信号分拣台
          </button>
        </nav>
      </header>

      <section className="workspace">
        {error && <div className="error-banner">{error}</div>}
        {activePage === "todos" && (
          <TodoPage
            now={now}
            progress={progress}
            overview={todoOverview}
            filters={todoFilters}
            setFilters={setTodoFilters}
            manualForm={manualForm}
            setManualForm={setManualForm}
            result={result}
            history={filteredHistory}
            totalCount={history.length}
            isLoading={isLoading}
            onManualSubmit={handleManualSubmit}
            editingTodo={editingTodo}
            editForm={editForm}
            setEditForm={setEditForm}
            onEditSubmit={handleEditSubmit}
            onCancelEdit={() => setEditingTodo(null)}
            onToggleTodo={handleToggleTodo}
            onEditTodo={startEditTodo}
            onDeleteTodo={handleDeleteTodo}
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
        {activePage === "calendar" && (
          <CalendarPage
            cursor={calendarCursor}
            days={calendarDays}
            entries={calendarEntries}
            onPreviousMonth={() => shiftCalendarMonth(-1)}
            onNextMonth={() => shiftCalendarMonth(1)}
            onToday={() => setCalendarCursor(currentCalendarCursor())}
            onSelectEntry={(entry) => {
              setSelectedCalendarEntry(entry);
              setCalendarEditMode(false);
            }}
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
            onPaste={handleAssistantPaste}
            onSave={handleAssistantSave}
          />
        )}
      </section>
      {activeReminder && <ReminderToast item={activeReminder} onClose={() => setActiveReminder(null)} />}
      {selectedCalendarEntry && (
        <CalendarDetailModal
          entry={selectedCalendarEntry}
          editMode={calendarEditMode}
          editForm={editForm}
          setEditForm={setEditForm}
          isLoading={isLoading}
          onClose={closeCalendarDetail}
          onToggle={() => handleCalendarToggle(selectedCalendarEntry.item)}
          onEdit={() => handleCalendarEdit(selectedCalendarEntry.item)}
          onEditSubmit={handleCalendarEditSubmit}
          onDelete={() => handleCalendarDelete(selectedCalendarEntry.item)}
        />
      )}

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
              <button className="btn-fabric btn-fabric-secondary" onClick={() => setJsonOpen(false)}>
                <span className="btn-bg"></span>关闭
              </button>
            </header>
            <pre>{JSON.stringify(result || { history }, null, 2)}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

function todoToForm(item) {
  const start = item.time?.start || "";
  const end = item.time?.end || "";
  return {
    title: item.title || "",
    date: start ? start.slice(0, 10) : todayInputValue(),
    startTime: start ? start.slice(11, 16) : "09:00",
    endTime: end ? end.slice(11, 16) : "10:00",
    recurrence: item.recurrence?.type || "none",
    reminder: String(item.reminder?.minutes_before ?? 0),
    location: item.location || "",
    notes: item.notes || "",
    quadrant: item.quadrant || "important_not_urgent",
    status: item.status || "todo",
  };
}

function TodoPage(props) {
  const allItems = props.history;
  const sections = splitTodoItems(allItems);
  return (
    <div className="page-stack">
      <header className="page-top">
        <div>
          <span className="eyebrow">当前时间</span>
          <h1>{formatFullNow(props.now)}</h1>
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
          {props.editingTodo && (
            <EditTodoForm
              form={props.editForm}
              setForm={props.setEditForm}
              isLoading={props.isLoading}
              onSubmit={props.onEditSubmit}
              onCancel={props.onCancelEdit}
            />
          )}
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
          <TodoOverview overview={props.overview} activeScope={props.filters.timeScope} setFilters={props.setFilters} />
          <div className="section-title">
            <h2>待办事项</h2>
            <span>{allItems.length}/{props.totalCount} 个生活信号</span>
          </div>
          <TodoFilterBar filters={props.filters} setFilters={props.setFilters} />
          <div className="toolbar">
            <button className="btn-fabric" onClick={props.onSave} disabled={!props.result?.items?.length}>
              <span className="btn-bg"></span>
              加入待办清单
            </button>
            <button className="btn-fabric btn-fabric-secondary" onClick={props.onExport}>
              <span className="btn-bg"></span>
              导出 ICS
            </button>
            <button className="btn-fabric btn-fabric-secondary" onClick={props.onJson}>
              <span className="btn-bg"></span>
              查看 JSON
            </button>
          </div>
          <div className="todo-list">
            {allItems.length ? (
              <>
                <TodoSection
                  title="待完成"
                  items={sections.pending}
                  emptyText="没有待完成事项。"
                  onToggle={props.onToggleTodo}
                  onEdit={props.onEditTodo}
                  onDelete={props.onDeleteTodo}
                />
                <TodoSection
                  title="已完成"
                  items={sections.completed}
                  emptyText="完成事项会显示在这里。"
                  onToggle={props.onToggleTodo}
                  onEdit={props.onEditTodo}
                  onDelete={props.onDeleteTodo}
                />
              </>
            ) : (
              <EmptyState text="还没有事项。先手动添加一个待办。" />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function TodoOverview({ overview, activeScope, setFilters }) {
  const cards = [
    { key: "today", label: "今天", value: overview.today },
    { key: "overdue", label: "逾期", value: overview.overdue },
    { key: "week", label: "本周待办", value: overview.week },
  ];
  return (
    <section className="todo-overview">
      {cards.map((card) => (
        <button
          className={`btn-fabric btn-fabric-secondary ${activeScope === card.key ? "active" : ""}`}
          key={card.key}
          onClick={() => setFilters((current) => ({ ...current, timeScope: current.timeScope === card.key ? "all" : card.key }))}
        >
          <span className="btn-bg"></span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', zIndex: 1, position: 'relative' }}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        </button>
      ))}
    </section>
  );
}

function TodoFilterBar({ filters, setFilters }) {
  function update(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="todo-filter-bar">
      <input value={filters.query} placeholder="搜索事件、地点、备注" onChange={(event) => update("query", event.target.value)} />
      <select value={filters.status} onChange={(event) => update("status", event.target.value)}>
        <option value="all">全部状态</option>
        <option value="todo">待完成</option>
        <option value="done">已完成</option>
      </select>
      <select value={filters.quadrant} onChange={(event) => update("quadrant", event.target.value)}>
        <option value="all">全部象限</option>
        {Object.entries(QUADRANTS).map(([key, meta]) => (
          <option key={key} value={key}>
            {meta.title}
          </option>
        ))}
      </select>
      <select value={filters.timeScope} onChange={(event) => update("timeScope", event.target.value)}>
        <option value="all">全部时间</option>
        <option value="today">今天</option>
        <option value="overdue">逾期</option>
        <option value="week">本周待办</option>
        <option value="no_time">无时间</option>
      </select>
      <button className="btn-fabric btn-fabric-secondary" onClick={() => setFilters(DEFAULT_TODO_FILTERS)}>
        <span className="btn-bg"></span>重置
      </button>
    </section>
  );
}

function TodoSection({ title, items, emptyText, onToggle, onEdit, onDelete }) {
  return (
    <section className="todo-section">
      <header>
        <h3>{title}</h3>
        <span>{items.length} 项</span>
      </header>
      {items.length ? (
        items.map((item) => <TaskRow key={item.id} item={item} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />)
      ) : (
        <div className="section-empty">{emptyText}</div>
      )}
    </section>
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
        提前提醒
        <select value={form.reminder || "0"} onChange={(event) => update("reminder", event.target.value)}>
          {REMINDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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
      <button className="btn-fabric" type="submit" disabled={isLoading}>
        <span className="btn-bg"></span>
        {isLoading ? "保存中..." : "加入待办清单"}
      </button>
    </form>
  );
}

function EditTodoForm({ form, setForm, isLoading, onSubmit, onCancel }) {
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="manual-form edit-form" onSubmit={onSubmit}>
      <div className="section-title">
        <h2>修改待办</h2>
        <span>保存后同步到清单</span>
      </div>
      <label className="wide">
        事件
        <input value={form.title} onChange={(event) => update("title", event.target.value)} />
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
        提前提醒
        <select value={form.reminder || "0"} onChange={(event) => update("reminder", event.target.value)}>
          {REMINDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        地点
        <input value={form.location} onChange={(event) => update("location", event.target.value)} />
      </label>
      <label className="wide">
        备注
        <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} />
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
      <div className="form-actions">
        <button className="btn-fabric" type="submit" disabled={isLoading}>
          <span className="btn-bg"></span>
          {isLoading ? "保存中..." : "保存修改"}
        </button>
        <button className="btn-fabric btn-fabric-secondary" type="button" onClick={onCancel}>
          <span className="btn-bg"></span>
          取消
        </button>
      </div>
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
        <button className="btn-fabric" onClick={onRevalidate} disabled={isLoading}>
          <span className="btn-bg"></span>
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
        <label className="date-picker" style={{ background: 'transparent', boxShadow: 'none' }}>
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

function CalendarPage({ cursor, days, entries, onPreviousMonth, onNextMonth, onToday, onSelectEntry }) {
  const today = todayInputValue();
  return (
    <div className="page-stack">
      <header className="page-top">
        <div>
          <span className="eyebrow">日历总览</span>
          <h1>{cursor.year}年{cursor.month}月</h1>
          <p>每一天只显示事件标题，点击事件查看详情。</p>
        </div>
        <div className="calendar-controls">
          <button className="btn-fabric btn-fabric-secondary" onClick={onPreviousMonth}>
            <span className="btn-bg"></span>上个月
          </button>
          <button className="btn-fabric btn-fabric-secondary" onClick={onToday}>
            <span className="btn-bg"></span>回到本月
          </button>
          <button className="btn-fabric btn-fabric-secondary" onClick={onNextMonth}>
            <span className="btn-bg"></span>下个月
          </button>
        </div>
      </header>
      <section className="calendar-board">
        <div className="calendar-weekdays">
          {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="calendar-grid">
          {days.map((day) => {
            const dayEntries = getCalendarDayItems(day.iso, entries);
            return (
              <article
                className={`calendar-day ${day.inCurrentMonth ? "" : "outside"} ${day.iso === today ? "today" : ""}`}
                key={day.iso}
              >
                <header>
                  <strong>{day.day}</strong>
                  {day.iso === today && <span>今天</span>}
                </header>
                <div className="calendar-events">
                  {dayEntries.slice(0, 4).map((entry) => (
                    <button
                      className={entry.item.status === "done" ? "done" : ""}
                      key={entry.id}
                      onClick={() => onSelectEntry(entry)}
                      title={entry.item.title}
                    >
                      {entry.item.title}
                    </button>
                  ))}
                  {dayEntries.length > 4 && <em>+{dayEntries.length - 4} 项</em>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CalendarDetailModal({ entry, editMode, editForm, setEditForm, isLoading, onClose, onToggle, onEdit, onEditSubmit, onDelete }) {
  const item = entry.item;
  const note = item.notes || (item.materials?.length ? item.materials.join("、") : "无");
  return (
    <div
      className="modal-backdrop"
      role="button"
      tabIndex={0}
      aria-label="关闭日历详情"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter") onClose();
      }}
    >
      <section className="calendar-detail" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>{entry.date}</span>
            <h2>{item.title}</h2>
          </div>
          <button className="btn-fabric btn-fabric-secondary" onClick={onClose}>
            <span className="btn-bg"></span>
            关闭
          </button>
        </header>
        {editMode ? (
          <EditTodoForm form={editForm} setForm={setEditForm} isLoading={isLoading} onSubmit={onEditSubmit} onCancel={onClose} />
        ) : (
          <>
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
                <dt>提醒</dt>
                <dd>{item.reminder?.label || "不提醒"}</dd>
              </div>
              <div>
                <dt>四象限</dt>
                <dd>{QUADRANTS[item.quadrant]?.title || "重要但不紧急"}</dd>
              </div>
              <div>
                <dt>备注</dt>
                <dd>{note}</dd>
              </div>
            </dl>
            <div className="detail-actions">
              <button className="btn-fabric" onClick={onToggle}>
                <span className="btn-bg"></span>
                {item.status === "done" ? "取消完成" : "标记完成"}
              </button>
              <button className="btn-fabric btn-fabric-secondary" onClick={onEdit}>
                <span className="btn-bg"></span>
                修改
              </button>
              <button className="btn-fabric btn-fabric-secondary" onClick={onDelete}>
                <span className="btn-bg"></span>
                删除
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function AssistantPage({ messages, result, input, setInput, isLoading, onSend, onUpload, onPaste, onSave }) {
  return (
    <div className="assistant-layout">
      <section className="chat-panel">
        <header className="section-title">
          <h2>信号分拣台</h2>
          <span>投放杂绪，自动织就清晰的待办清单</span>
        </header>
        <div className="message-list">
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              {message.text}
            </div>
          ))}
        </div>
        <div className="assistant-input">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={onPaste}
            placeholder="输入通知、问题或需要确认的信息；也可以直接粘贴截图。"
          />
          <div className="action-row">
            <label className="file-button">
              上传截图并提取
              <input type="file" accept="image/*" onChange={onUpload} />
            </label>
            <button className="btn-fabric" onClick={onSend} disabled={isLoading}>
              <span className="btn-bg"></span>
              {isLoading ? "整理中..." : "发送并提取"}
            </button>
          </div>
        </div>
      </section>
      <aside className="structure-panel">
        <header className="section-title">
          <h2>分拣清单（预览）</h2>
          <span>便于核对提取出的结构化细节</span>
        </header>
        {result ? (
          <>
            {result.ocr && <OcrSummary ocr={result.ocr} />}
            <ValidationPanel result={result} />
            <div className="assistant-result-actions">
              {result.items?.length ? (
                <button className="btn-fabric" onClick={onSave}>
                  <span className="btn-bg"></span>
                  {isLoading ? "加入中..." : "加入待办清单"}
                </button>
              ) : (
                <button className="btn-fabric btn-fabric-secondary" disabled>
                  <span className="btn-bg"></span>
                  没有可加入事项
                </button>
              )}
              <span>{result.items?.length || 0} 个事项待加入</span>
            </div>
            <pre>{JSON.stringify(result.items[0] || {}, null, 2)}</pre>
          </>
        ) : (
          <EmptyState text="提取后会在这里显示 JSON、可信度和待确认项。" />
        )}
      </aside>
    </div>
  );
}

function TaskRow({ item, onToggle, onEdit, onDelete }) {
  const completeButtonRef = useRef(null);
  const missing = [];
  if (!item.location) missing.push("缺地点");
  const note = item.notes || (item.materials?.length ? `材料：${item.materials.join("、")}` : "");
  const evidenceText = item.kind === "schedule_course" ? "" : item.evidence;

  async function handleToggleClick() {
    const shouldReward = item.status !== "done";
    if (shouldReward) fireLocalReward(completeButtonRef.current);
    await onToggle(item);
  }

  return (
    <article className={`task-row ${item.status === "done" ? "completed" : ""}`}>
      <button
        ref={completeButtonRef}
        className="complete-toggle"
        aria-label={item.status === "done" ? "取消完成" : "标记完成"}
        onClick={handleToggleClick}
      />
      <div>
        <strong>{item.title}</strong>
        {evidenceText && <p>{evidenceText}</p>}
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
          <dt>提醒</dt>
          <dd>{item.reminder?.label || "不提醒"}</dd>
        </div>
      </dl>
      {note && <p className="task-note">备注：{note}</p>}
      <div className="task-meta">
        <span className="confidence">可信度 {Math.round((item.confidence || 0) * 100)}%</span>
        <span>{item.source_type}</span>
        {missing.map((chip) => (
          <em key={chip}>{chip}</em>
        ))}
      </div>
      <div className="task-actions">
        <button className="btn-fabric btn-fabric-secondary" onClick={() => onEdit(item)}>
          <span className="btn-bg"></span>
          修改
        </button>
        <button className="btn-fabric btn-fabric-secondary" onClick={() => onDelete(item)}>
          <span className="btn-bg"></span>
          删除
        </button>
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

function ReminderToast({ item, onClose }) {
  return (
    <section className="reminder-toast" role="status">
      <div>
        <strong>事项提醒</strong>
        <span>{item.reminder?.label || "提醒"}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{formatDateTime(item.time?.start)} · {item.location || "地点待确认"}</p>
      {item.notes && <p>{item.notes}</p>}
      <button className="btn-fabric btn-fabric-secondary" onClick={onClose} style={{ marginTop: '12px' }}>
        <span className="btn-bg"></span>
        知道了
      </button>
    </section>
  );
}

function fireLocalReward(target) {
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const x = (rect.left + rect.width / 2) / window.innerWidth;
  const y = (rect.top + rect.height / 2) / window.innerHeight;
  confetti({
    particleCount: 18,
    spread: 42,
    startVelocity: 18,
    ticks: 90,
    scalar: 0.65,
    origin: { x, y },
    colors: ["#267a57", "#d9a927", "#2d6f9f", "#f3f7ef"],
    disableForReducedMotion: true,
  });
}
