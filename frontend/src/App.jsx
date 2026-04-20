import React, { useEffect, useMemo, useState } from "react";

import { exportIcs, extractNotice, getConfig, getHistory, getSamples, saveTodos, uploadImage, validateTodos } from "./api.js";
import {
  applyQuadrantOverrides,
  calculateProgress,
  describeAiExtractor,
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
  const [appConfig, setAppConfig] = useState(null);
  const [messages, setMessages] = useState([
    { id: "intro", role: "assistant", text: "把通知、截图文字或需要确认的信息发给我，我会整理成待办和待确认项。" },
  ]);

  useEffect(() => {
    getSamples().then(setSamples).catch(() => setSamples([]));
    getConfig().then(setAppConfig).catch(() => setAppConfig(null));
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
            text: `已提取 ${data.items.length} 个事项，发现 ${data.validation.issues.length} 条风险或待确认信息。`,
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
      const data = await uploadImage(file);
      if (target === "assistant") {
        setMessages((current) => [...current, { id: `upload-${Date.now()}`, role: "user", text: `上传截图：${file.name}` }]);
        await handleExtract(data.text, true);
      } else {
        setInput(data.text);
        setSourceType("截图文字");
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
          <span>Harness</span>
          <p>结构化上下文、外部工具、验证反馈</p>
          <strong>{describeAiExtractor(appConfig)}</strong>
        </div>
      </aside>

      <section className="workspace">
        {error && <div className="error-banner">{error}</div>}
        {activePage === "todos" && (
          <TodoPage
            now={now}
            progress={progress}
            input={input}
            setInput={setInput}
            sourceType={sourceType}
            setSourceType={setSourceType}
            samples={samples}
            applySample={applySample}
            result={result}
            history={history}
            isLoading={isLoading}
            onExtract={() => handleExtract()}
            onSave={handleSave}
            onUpload={(event) => handleUpload(event)}
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
          <div className="section-title">
            <h2>新通知处理</h2>
            <span>输入 → AI 提取 → 自动验证</span>
          </div>
          <div className="source-row">
            {SOURCE_TYPES.map((type) => (
              <button key={type} className={props.sourceType === type ? "selected" : ""} onClick={() => props.setSourceType(type)}>
                {type}
              </button>
            ))}
          </div>
          <textarea
            value={props.input}
            onChange={(event) => props.setInput(event.target.value)}
            placeholder="粘贴微信群通知、短信、课程公告或 OCR 文本..."
          />
          <div className="sample-row">
            {props.samples.map((sample) => (
              <button key={sample.title} onClick={() => props.applySample(sample)}>
                {sample.title}
              </button>
            ))}
          </div>
          <div className="action-row">
            <label className="file-button">
              上传截图 OCR
              <input type="file" accept="image/*" onChange={props.onUpload} />
            </label>
            <button className="primary" onClick={props.onExtract} disabled={props.isLoading}>
              {props.isLoading ? "处理中..." : "AI 提取"}
            </button>
          </div>
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
          <span>文本交流 / 截图 OCR / 事项确认</span>
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
              上传截图 OCR
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
  if (!item.materials?.length) missing.push("缺材料");
  if (!item.contacts?.length) missing.push("缺联系人");
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
          <dt>材料</dt>
          <dd>{item.materials?.length ? item.materials.join("、") : "待确认"}</dd>
        </div>
        <div>
          <dt>联系人</dt>
          <dd>{item.contacts?.length ? item.contacts.map((contact) => contact.name).join("、") : "待确认"}</dd>
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

function EmptyState({ text = "还没有事项。先粘贴一条通知，或选择演示样例。" }) {
  return <div className="empty-state">{text}</div>;
}
