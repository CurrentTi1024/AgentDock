# AgentDock 多 Session 独立订阅与并发运行架构升级方案

> 状态：方案确定，待实现  
> 日期：2026-08-27  
> 适用范围：AgentDock Browser App、CopilotKit v2 Headless、AG-UI 独立 SSE 订阅、Dexie IndexedDB  
> 首期目标：同一浏览器标签页内多个 Session 同时运行；切换页面不终止流；切回后立即看到最新结果  
> 后续目标：Orchestration 支持 `runId + afterEventId` 后启用刷新/断线续传

## 1. 最终架构决策

AgentDock 采用下面的生产架构：

```text
ChatPage（当前 Session 的视图）
        │ send / stop / HITL / A2UI action
        ▼
useAgentDockConversation（薄 facade + Zustand selector）
        │
        ▼
SessionOperationService（命令与生命周期编排）
        ├── SessionOperationStore（可观察状态）
        ├── SessionRuntimeRegistry（运行时句柄，不持久化）
        └── SessionHistoryService（Dexie 消息与 checkpoint）
                    ▲
                    │ register/unregister handle
SessionRuntimeHost（位于 CopilotKit Provider 内、Router 外）
        ├── SessionRuntimeWorker A
        │       └── useAgent + 独立 subscribe + runAgent
        ├── SessionRuntimeWorker B
        │       └── useAgent + 独立 subscribe + runAgent
        └── SessionRuntimeWorker C
                └── useAgent + 独立 subscribe + runAgent
```

核心原则只有四条：

1. **页面只展示 Session，不拥有 Agent Run。** 路由切换只能卸载页面，不能卸载正在运行的 Worker。
2. **一个活跃 Session 一个独立 Agent 实例和独立订阅。** 首期不做多路复用 WebSocket。
3. **每次 Run 在发送前由前端生成 `runId`；`operationId === runId`。** 不增加第四套业务 ID。
4. **事件按 Worker 创建时捕获的 `sessionId` 路由。** 禁止根据当前页面的 `activeSessionId` 写状态。

本方案借鉴 LobeHub 的 Operation 思路，但不照搬 PostgreSQL 和 Agent Gateway：

- 借鉴：全局 Operation、按会话上下文索引、独立 Abort/订阅、终态后台通知、短期内存保留。
- 不照搬：PostgreSQL 消息表、服务端 Gateway、Durable Object、跨设备重放。
- AgentDock 继续使用现有 Dexie 保存本地可见历史；运行中的热状态只保存活跃 Run，不保存全部 Session。

## 2. 目标与非目标

### 2.1 首期必须实现

- Session A 发送后切到 B，A 的 Agent、SSE 和事件订阅继续运行。
- B 可以同时发送；A、B 的 reducer、checkpoint、停止按钮互不影响。
- 切回 A 时直接从全局 Operation Store 读取 A 的最新流式状态。
- A 在后台完成时，最终消息写入 A 的 IndexedDB 历史，不写入当前正在看的 B。
- 每个 Session 同时最多一个 `running/paused` Run；不同 Session 可以并发。
- `stop(A)` 只停止 A；HITL/A2UI Action 只发送给所属 Session 的 Agent。
- Operation 终态后释放订阅和 Worker；历史 Session 数量不会扩大热内存。
- mock 与 http 两条路径具有相同的多 Session 行为。

### 2.2 首期明确不承诺

- 浏览器关闭后 Agent 仍在浏览器中继续执行。
- 刷新页面后自动补回网络断开期间的事件。
- 跨浏览器、跨设备接管同一个 Run。
- 同一 Session 内并发两个普通 Run。

后面三项需要 Orchestration 提供服务端运行所有权和事件日志。IndexedDB 或 PostgreSQL 本身不能替代事件源。

## 3. 当前代码诊断

### 3.1 生产订阅绑定在页面 Hook 上

当前 `useOfficialConversation` 在页面组件内调用：

```ts
const { agent } = useAgent({
  agentId: `agentdock-${sessionId}`,
  runtimeAgentId: 'orchestration',
  threadId,
});

useEffect(() => {
  const subscription = agent.subscribe(...);
  return () => subscription.unsubscribe();
}, [agent]);
```

文件：`src/features/chat/useAgentDockConversation.ts`。

`ChatPage` 的路由参数变化会卸载旧会话对应的 Hook，清理函数随即退订。因此当前架构的真正问题不是消息数据库，而是 **Run 生命周期与页面生命周期耦合**。

### 3.2 `runRef/httpRun` 只有一个页面局部槽位

生产路径的这些状态都属于当前 Hook 实例：

```ts
const [httpRun, setHttpRun] = useState<RuntimeRunState>();
const runRef = useRef<RuntimeRunState>();
const inputRef = useRef<RunAgentInput>();
const legacyInterruptIdRef = useRef<string>();
```

切换页面后它们不能作为后台运行管理器使用。它们需要迁移到全局、按 `runId/sessionId` 分槽的 Store。

### 3.3 mock `runStore` 是全局单槽

当前 `src/stores/runStore.ts` 只有：

```ts
activeInput?: RunAgentInput;
controller?: AbortController;
run?: RuntimeRunState;
```

新 Run 会 `get().controller?.abort()`，因此 Session B 会直接中止 Session A。mock 路径也必须升级为按 Session/Run 分槽，不能继续保留另一套单槽模型。

### 3.4 Dexie 已具备部分并发基础，但 timer 仍是全局的

当前 checkpoint 待写数据已经是：

```ts
Map<runId, { input; sessionId; snapshot }>
```

这是正确方向。但所有 Run 共用一个 `checkpointTimer`：A 的连续事件会不断重置 timer，可能推迟 B 的 checkpoint。终态 `flushRunCheckpoint()` 又会把所有 Run 一起 flush。

升级后必须改为 **每个 runId 一个 timer，支持按 runId flush**。

### 3.5 A2UI Action 使用全局 properties，存在并发串值

当前代码调用：

```ts
copilotkit.setProperties({
  ...copilotkit.properties,
  a2uiAction: { userAction: a2uiAction },
});
```

`copilotkit.properties` 属于整个 Provider。Session A 和 B 并发时，A 的临时 Action 可能被 B 读取。升级后必须把 A2UI Action 放入本次 Run 的 `forwardedProps.a2uiAction`，不再修改 Provider 全局属性。

## 4. ID 模型与事件最小契约

### 4.1 ID 定义

| ID | 产生方 | 生命周期 | 用途 |
|---|---|---|---|
| `sessionId` | AgentDock | 产品会话长期存在 | 本地历史、页面路由、会话隔离 |
| `threadId` | AgentDock/AG-UI Client | Agent 对话线程长期存在 | DeepAgents 上下文 |
| `runId` | AgentDock Browser | 一次 Agent 执行 | 幂等、运行状态、续传 |
| `operationId` | AgentDock 内部别名 | 与 Run 相同 | Operation Store 主键 |
| `eventId` | Orchestration/Event Hub | 一个 Run 内的事件 | 去重、断点游标 |

固定关系：

```ts
operationId === runId
```

不允许 Runtime 或 Orchestration 收到请求后另建第二个 Run ID。

### 4.2 独立订阅下后端必须返回什么

首期只要求：

1. 请求中的 `threadId`、`runId` 原样用于本次执行。
2. `RUN_STARTED` 返回标准 `threadId + runId`。
3. 每个业务事件在 `rawEvent.eventId` 中携带稳定 event ID。
4. 文本、工具、A2UI 等事件保持 AG-UI 标准关联 ID。
5. 最终返回 `RUN_FINISHED` 或 `RUN_ERROR`。

除 `RUN_STARTED/RUN_FINISHED/RUN_ERROR` 外，后续事件不必重复携带 `sessionId/threadId/runId`。因为独立 Worker 的回调已经捕获所属 Session：

```ts
const route = { sessionId, threadId };

agent.subscribe({
  onTextMessageContentEvent: ({ event }) => {
    operationService.applyEvent(route, event);
  },
});
```

### 4.3 eventId 的处理顺序

```text
收到事件
  → 从 rawEvent.eventId 取 eventId
  → 以当前 operation.processedEventIds 去重
  → reducer 成功应用
  → 更新内存 latestEventId
  → 防抖原子保存 snapshot + latestEventId
```

不能只保存一个游标而不保存对应快照。恢复时使用的是“最后一次成功落盘的 snapshot 及其 latestEventId”，因此即使进程在下一次 flush 前崩溃，后端重放旧游标之后的事件也只是产生可去重的重复，不会产生缺口。

## 5. 建议目录与模块职责

```text
src/
├── app/
│   └── providers.tsx
├── features/chat/
│   ├── runtime/
│   │   ├── SessionRuntimeHost.tsx
│   │   ├── SessionRuntimeWorker.tsx
│   │   ├── bindAgentEvents.ts
│   │   ├── sessionOperationService.ts
│   │   ├── sessionRuntimeRegistry.ts
│   │   └── types.ts
│   └── useAgentDockConversation.ts
├── stores/
│   └── sessionOperationStore.ts
└── api/session/
    └── sessionHistoryService.ts
```

职责边界：

### `sessionOperationStore.ts`

- Zustand 可观察状态。
- 保存活跃 Operation、每 Session 当前 Run、Worker 描述符。
- 只做同步状态变换，不直接调用 React Hook，不直接访问 CopilotKit。

### `sessionRuntimeRegistry.ts`

- 保存 Worker 注册的命令句柄。
- 解决普通 TypeScript Service 无法调用 `useAgent/useCopilotKit` 的问题。
- 句柄不进入 IndexedDB，不参与 Zustand devtools 序列化。

### `SessionRuntimeHost.tsx`

- 常驻在 `<CopilotKit>` 内部、`<BrowserRouter>` 外或至少路由内容之外。
- 根据 Store 中的 runtime descriptors 渲染 Worker。
- 页面切换不会卸载 Host。

### `SessionRuntimeWorker.tsx`

- 一个 Session 一个 Worker。
- 在组件顶层合法调用 `useAgent/useCopilotKit`。
- 创建独立 Agent、独立订阅，向 Registry 注册 send/stop/HITL/A2UI 命令。
- Worker 生命周期只由 Operation Service 管理，不由 ChatPage 管理。

### `sessionOperationService.ts`

- 创建 Run、同 Session 防重入、等待 Worker ready、调用命令句柄。
- 按捕获 Session 路由事件。
- 调用 reducer、checkpoint、终态持久化、清理和未读标记。

### `useAgentDockConversation.ts`

- 变成薄 facade。
- 只订阅当前 Session 的 Operation State。
- 对页面暴露现有 `send/stop/respondToHitl/sendA2uiAction/restore` API，尽量不改 ChatPage UI。

## 6. 核心数据结构

### 6.1 Operation 类型

```ts
export type OperationStatus =
  | 'booting'
  | 'running'
  | 'paused'
  | 'success'
  | 'error'
  | 'cancelled';

export interface SessionOperation {
  /** 与 runId 相同。 */
  operationId: string;
  runId: string;
  sessionId: string;
  threadId: string;

  input: RunAgentInput;
  snapshot: RuntimeRunState;
  status: OperationStatus;

  latestEventId?: string;
  legacyInterruptId?: string;
  startedAt: number;
  completedAt?: number;
  error?: { code?: string; message: string };
}

export interface SessionRuntimeDescriptor {
  sessionId: string;
  threadId: string;
  agentId: string;
  fab: string;
  group?: RunAgentInput['forwardedProps']['group'];
  status: 'booting' | 'ready' | 'disposing';
  retainUntil?: number;
}
```

不把 `AbortController`、CopilotKit Agent 或 unsubscribe function 塞进可持久化 Operation；这些非序列化对象属于 Runtime Registry/Worker。

### 6.2 Store 结构

```ts
interface SessionOperationState {
  operationsById: Record<string, SessionOperation>;
  activeRunBySession: Record<string, string | undefined>;
  runtimeBySession: Record<string, SessionRuntimeDescriptor>;
  viewingSessionId?: string;

  registerRuntime(descriptor: SessionRuntimeDescriptor): void;
  markRuntimeReady(sessionId: string): void;
  addOperation(operation: SessionOperation): void;
  updateOperation(runId: string, value: Partial<SessionOperation>): void;
  removeOperation(runId: string): void;
  setViewingSession(sessionId?: string): void;
}
```

选择器：

```ts
export const selectSessionRun = (sessionId: string) => (state: SessionOperationState) => {
  const runId = state.activeRunBySession[sessionId];
  return runId ? state.operationsById[runId]?.snapshot : undefined;
};

export const selectIsSessionBusy = (sessionId: string) => (state: SessionOperationState) => {
  const runId = state.activeRunBySession[sessionId];
  const status = runId ? state.operationsById[runId]?.status : undefined;
  return status === 'booting' || status === 'running' || status === 'paused';
};
```

约束：

```ts
// 同 Session：至多一个 running/paused
activeRunBySession[sessionId] = runId;

// 不同 Session：允许多个不同 runId
activeRunBySession['A'] = 'run-A';
activeRunBySession['B'] = 'run-B';
```

## 7. React Runtime Host 的关键代码

React Hook 不能在普通 Service 或 Zustand action 中调用。因此使用一个常驻 Host，把 React 世界的 CopilotKit Agent 转换成可调用句柄。

### 7.1 Provider 装配

```tsx
<CopilotKit ...>
  <SessionRuntimeHost />
  <ThemeProvider>
    <BrowserRouter>{children}</BrowserRouter>
  </ThemeProvider>
</CopilotKit>
```

当前 `providers.tsx` 把 `app` 作为 CopilotKit children。升级时 `SessionRuntimeHost` 必须放在同一个 Provider 内，但不能放进具体 Chat Route。

### 7.2 Host

```tsx
export function SessionRuntimeHost() {
  const descriptors = useSessionOperationStore((state) =>
    Object.values(state.runtimeBySession),
  );

  return (
    <>
      {descriptors.map((descriptor) => (
        <SessionRuntimeWorker
          key={descriptor.sessionId}
          descriptor={descriptor}
        />
      ))}
    </>
  );
}
```

不能在 Host 中对 descriptors 使用循环调用 `useAgent`；必须拆成子组件，让每个 Worker 的 Hook 调用顺序稳定。

### 7.3 Runtime Registry

```ts
export interface SessionRuntimeHandle {
  isReady(): boolean;
  send(input: RunAgentInput): Promise<void>;
  stop(runId: string): Promise<void>;
  respondToHitl(runId: string, response: HitlResponse): Promise<void>;
  sendA2uiAction(runId: string, action: A2uiAction): Promise<void>;
}

const handles = new Map<string, SessionRuntimeHandle>();
const waiters = new Map<string, Set<(handle: SessionRuntimeHandle) => void>>();

export const sessionRuntimeRegistry = {
  register(sessionId: string, handle: SessionRuntimeHandle) {
    handles.set(sessionId, handle);
    for (const resolve of waiters.get(sessionId) ?? []) resolve(handle);
    waiters.delete(sessionId);
  },

  unregister(sessionId: string, handle: SessionRuntimeHandle) {
    if (handles.get(sessionId) === handle) handles.delete(sessionId);
  },

  async whenReady(sessionId: string): Promise<SessionRuntimeHandle> {
    const current = handles.get(sessionId);
    if (current?.isReady()) return current;
    return new Promise((resolve) => {
      const set = waiters.get(sessionId) ?? new Set();
      set.add(resolve);
      waiters.set(sessionId, set);
    });
  },
};
```

生产实现还应给 `whenReady` 增加超时和 runtime descriptor 已删除检查，避免永久悬挂。

### 7.4 Worker

```tsx
function SessionRuntimeWorker({ descriptor }: Props) {
  const { sessionId, threadId } = descriptor;
  const localAgentId = `agentdock-${sessionId}`;

  const { agent, isReady } = useAgent({
    agentId: localAgentId,
    runtimeAgentId: 'orchestration',
    threadId,
  });
  const { copilotkit } = useCopilotKit();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!isReady) return;
    return bindAgentEvents(agent, {
      sessionId,
      threadId,
      onEvent: (route, event) => operationService.applyEvent(route, event),
    });
  }, [agent, isReady, sessionId, threadId]);

  useEffect(() => {
    if (!isReady) return;

    const handle: SessionRuntimeHandle = {
      isReady: () => hydratedRef.current,
      send: async (input) => {
        agent.addMessage(input.messages.at(-1) as Message);
        await copilotkit.runAgent({
          agent,
          forwardedProps: input.forwardedProps as Record<string, unknown>,
          runId: input.runId,
        });
      },
      stop: async () => copilotkit.stopAgent({ agent }),
      respondToHitl: async (runId, response) => {
        await runHitlResume({ agent, copilotkit, runId, response });
      },
      sendA2uiAction: async (actionRunId, action) => {
        await copilotkit.runAgent({
          agent,
          runId: actionRunId,
          forwardedProps: {
            ...operationService.getForwardedProps(sessionId),
            action: 'a2uiAction',
            a2uiAction: action,
          },
        });
      },
    };

    void hydrateAgentMessages(agent, sessionId).then(() => {
      hydratedRef.current = true;
      sessionRuntimeRegistry.register(sessionId, handle);
      useSessionOperationStore.getState().markRuntimeReady(sessionId);
    });

    return () => sessionRuntimeRegistry.unregister(sessionId, handle);
  }, [agent, copilotkit, isReady, sessionId]);

  return null;
}
```

必须遵守：

- `hydrateAgentMessages()` 完成前不能开始发送，否则历史重建会覆盖新用户消息。
- Worker 捕获的 `sessionId/threadId` 在整个 Worker 生命周期内不可变化；变化时使用新 key 重建 Worker。
- Worker unmount 只发生在 Operation Service 明确释放 runtime 后，不能跟随 ChatPage unmount。
- `sendA2uiAction` 不再调用全局 `copilotkit.setProperties()`。

## 8. 事件绑定与路由

把当前 `useOfficialConversation` 中的大段 `agent.subscribe()` 提取为纯辅助函数：

```ts
interface EventRoute {
  sessionId: string;
  threadId: string;
}

export function bindAgentEvents(
  agent: AbstractAgent,
  options: {
    sessionId: string;
    threadId: string;
    onEvent(route: EventRoute, event: AgUiEvent): void;
  },
) {
  const route = {
    sessionId: options.sessionId,
    threadId: options.threadId,
  } as const;

  const emit = (event: AgUiEvent) => options.onEvent(route, event);

  const subscription = agent.subscribe({
    onRunStartedEvent: ({ event }) => emit(event),
    onRunFinishedEvent: ({ event, outcome, interrupts }) => {
      emit(event);
      projectInterrupts(emit, outcome, interrupts);
    },
    onRunErrorEvent: ({ event }) => emit(event),
    onTextMessageStartEvent: ({ event }) => emit(event),
    onTextMessageContentEvent: ({ event }) => emit(event),
    onTextMessageEndEvent: ({ event }) => emit(event),
    // reasoning / tool / activity / state / step / raw 同样绑定
  });

  return () => subscription.unsubscribe();
}
```

### 8.1 Operation 解析规则

```ts
function resolveOperation(route: EventRoute, event: AgUiEvent) {
  const store = useSessionOperationStore.getState();
  const eventRunId = typeof event.runId === 'string' ? event.runId : undefined;
  const activeRunId = store.activeRunBySession[route.sessionId];
  const runId = eventRunId ?? activeRunId;

  if (!runId) return undefined;

  const operation = store.operationsById[runId];
  if (!operation || operation.sessionId !== route.sessionId) return undefined;

  // RUN_STARTED/RUN_FINISHED 携带的 runId 必须与本 Worker 当前 Operation 一致。
  if (eventRunId && activeRunId && eventRunId !== activeRunId) {
    reportProtocolMismatch({ activeRunId, eventRunId, route });
    return undefined;
  }

  return operation;
}
```

对于没有 `runId` 的普通 AG-UI 内容事件，独立 Worker 使用 `activeRunBySession[sessionId]` 路由；它是可靠的前提是同 Session 不允许两个普通 Run 并发。

严禁：

```ts
// 错误：切到 B 后，A 的事件会写进 B。
applyEvent(useUiStore.getState().activeSessionId, event);
```

## 9. 发送、接收和终态流程

### 9.1 发送

```ts
async function send(context: SessionContext, text: string) {
  const store = useSessionOperationStore.getState();
  if (selectIsSessionBusy(context.sessionId)(store)) return;

  const input = createRunInput({
    ...context,
    message: text,
    runId: crypto.randomUUID(),
  });

  const snapshot = createRunState(input.runId, input.threadId);
  snapshot.status = 'running';
  snapshot.messages[input.messages[0].id] = input.messages[0];
  snapshot.messageOrder.push(input.messages[0].id);

  store.registerRuntime({
    ...context,
    status: 'booting',
  });
  store.addOperation({
    operationId: input.runId,
    runId: input.runId,
    sessionId: context.sessionId,
    threadId: input.threadId,
    input,
    snapshot,
    status: 'booting',
    startedAt: Date.now(),
  });

  // 用户消息先进入 Store，页面立即显示；Worker 准备完成后才真正发网络请求。
  scheduleRunCheckpoint(context.sessionId, input, snapshot);

  try {
    const runtime = await sessionRuntimeRegistry.whenReady(context.sessionId);
    store.updateOperation(input.runId, { status: 'running' });
    await runtime.send(input);
  } catch (error) {
    applySyntheticRunError(input, error);
  }
}
```

`createRunInput` 现状是在函数内部生成 `runId`。实现本方案时应让它接受可选的显式 `runId`，或先调用它再以返回值中的 `input.runId` 注册 Operation；网络请求与 Operation 必须使用同一个值，不能各生成一次。

这里 `await runtime.send()` 可以持续到流终态，但它不会阻塞其他 Session，因为每次 send 都是独立 Promise，没有全局 mutex。

### 9.2 接收事件

```ts
function applyEvent(route: EventRoute, event: AgUiEvent) {
  const operation = resolveOperation(route, event);
  if (!operation) return;

  const streamed = toStreamedEvent(event);
  const next = reduceRunEvent(operation.snapshot, streamed);

  // reducer 返回同一引用表示 eventId 已处理，跳过持久化和渲染通知。
  if (next === operation.snapshot) return;

  useSessionOperationStore.getState().updateOperation(operation.runId, {
    snapshot: next,
    status: next.status,
    latestEventId: next.latestEventId,
  });

  scheduleRunCheckpoint(operation.sessionId, operation.input, next);

  if (isTerminal(next.status)) void completeOperation(operation.runId, next);
}
```

Zustand 更新可以按现有 50ms 策略做 selector 通知节流，但 `operation.snapshot` 和 checkpoint 调度必须逐事件同步推进，不能因为 React 节流而漏事件。

### 9.3 终态

```ts
async function completeOperation(runId: string, snapshot: RuntimeRunState) {
  const store = useSessionOperationStore.getState();
  const operation = store.operationsById[runId];
  if (!operation || operation.completedAt) return; // 幂等

  store.updateOperation(runId, {
    snapshot,
    status: snapshot.status,
    completedAt: Date.now(),
  });

  await flushRunCheckpoint(runId);

  if (store.viewingSessionId !== operation.sessionId) {
    await sessionHistoryService.updateSession(operation.sessionId, {
      unread: true,
    });
  }

  // 先保证页面收到终态和历史落库，再延迟释放热资源。
  scheduleOperationCleanup(runId, 30_000);
}
```

清理只删除 Operation/Worker 热状态，不删除 messages。切回已完成 Session 时，ChatPage 从 IndexedDB 渲染最终历史。

## 10. Hook 与 ChatPage 的改造

### 10.1 新 Hook

```ts
export function useAgentDockConversation(
  options: AgentDockConversationOptions,
): AgentDockConversationResult {
  const run = useSessionOperationStore(selectSessionRun(options.sessionId));

  useEffect(() => {
    useSessionOperationStore.getState().setViewingSession(options.sessionId);
    void sessionHistoryService.updateSession(options.sessionId, { unread: false });

    return () => {
      const store = useSessionOperationStore.getState();
      if (store.viewingSessionId === options.sessionId) store.setViewingSession(undefined);
    };
  }, [options.sessionId]);

  return {
    // ChatPage 当前没有消费底层 agent；后续可删除该兼容字段。
    agent: undefined,
    isReady: true,
    run,
    restore: () => operationService.restore(options),
    send: (message, sendOptions) => operationService.send(options, message, sendOptions),
    stop: () => operationService.stop(options.sessionId),
    respondToHitl: (payload) => operationService.respondToHitl(options.sessionId, payload),
    sendA2uiAction: (payload) => operationService.sendA2uiAction(options.sessionId, payload),
  };
}
```

### 10.2 ChatPage 可基本保持不变

现有页面继续使用：

```ts
const { run, send, stop, respondToHitl, sendA2uiAction } =
  useAgentDockConversation({ sessionId, threadId, agentId, fab });
```

变化点：

- `run` 不再是 Hook 局部 state，而是当前 Session selector。
- `restore()` 只负责历史/可恢复 checkpoint 装载，不创建页面所有的订阅。
- 页面 unmount 不再 unsubscribe Agent。
- `agentdock:run-persisted` 监听必须检查事件 detail 中的 `sessionId/runId`，不要所有 ChatPage 都响应全局广播。

建议把通知改成：

```ts
window.dispatchEvent(new CustomEvent('agentdock:run-persisted', {
  detail: { sessionId, runId, status },
}));
```

然后页面过滤：

```ts
if (event.detail.sessionId !== sessionId) return;
```

## 11. IndexedDB 与 checkpoint 并发改造

### 11.1 每 Run 独立防抖

替换全局 timer：

```ts
interface PendingCheckpoint {
  input: RunAgentInput;
  sessionId: string;
  snapshot: RuntimeRunState;
}

const pendingCheckpoints = new Map<string, PendingCheckpoint>();
const checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleRunCheckpoint(
  sessionId: string,
  input: RunAgentInput,
  snapshot: RuntimeRunState,
) {
  const runId = snapshot.runId;
  pendingCheckpoints.set(runId, { input, sessionId, snapshot });

  const previous = checkpointTimers.get(runId);
  if (previous) clearTimeout(previous);

  checkpointTimers.set(runId, setTimeout(() => {
    void flushRunCheckpoint(runId);
  }, CHECKPOINT_DEBOUNCE_MS));
}
```

### 11.2 按 Run flush

```ts
export async function flushRunCheckpoint(runId?: string) {
  const runIds = runId ? [runId] : [...pendingCheckpoints.keys()];

  const jobs = runIds.flatMap((id) => {
    const timer = checkpointTimers.get(id);
    if (timer) clearTimeout(timer);
    checkpointTimers.delete(id);

    const job = pendingCheckpoints.get(id);
    pendingCheckpoints.delete(id);
    return job ? [job] : [];
  });

  const results = await Promise.allSettled(
    jobs.map((job) =>
      sessionHistoryService.saveRunCheckpoint(job.sessionId, job.input, job.snapshot),
    ),
  );

  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
```

`pagehide` 调用无参数版本，终态只调用 `flushRunCheckpoint(runId)`。A 的终态不会强制 flush 或阻塞 B。

### 11.3 消息主键隔离

当前 messages 表主键是 `id`，值类似 `text:${messageId}`。如果两个 Session 的后端 message ID 不保证全局唯一，会发生跨 Session 覆盖。

生产级方案为 SessionMessageRecord 增加存储主键：

```ts
interface SessionMessageRecord {
  storageKey: string; // `${sessionId}:${kind}:${protocolId}`
  id: string;         // UI/逻辑 ID，继续是 `${kind}:${protocolId}`
  sessionId: string;
  // ...
}
```

Dexie v4：

```ts
messages:
  'storageKey,sessionId,runId,createdAt,sequence,[sessionId+sequence],[sessionId+id]'
```

迁移：

```ts
this.version(4)
  .stores({ messages: 'storageKey,...' })
  .upgrade(async (tx) => {
    await tx.table('messages').toCollection().modify((row) => {
      row.storageKey = `${row.sessionId}:${row.id}`;
    });
  });
```

这不是把上千条消息塞进 index；仍然是一条消息一行，只是主键包含 Session 边界，防止碰撞。

### 11.4 sessions 的轻量状态

可选新增：

```ts
interface SessionRecord {
  unread?: boolean;
  lastRunStatus?: 'running' | 'paused' | 'success' | 'error' | 'cancelled';
}
```

不把所有 Operation、事件或消息写入 Session record。`runningRunId` 首期也不需要；未来启用刷新续传时，recoverable pointer 已经存在 checkpoints 表。

## 12. mock 路径统一

不能继续让 mock 使用单例 `runStore.run/controller`。有两种做法，推荐第一种：

1. mock 也接入同一个 `SessionOperationService`，仅 Runtime Handle 的 transport 不同。
2. 单独把 `runStore` 改成 maps，但会长期维护两套 Operation 逻辑。

推荐 mock handle：

```ts
class MockSessionRuntimeHandle implements SessionRuntimeHandle {
  constructor(private readonly sessionId: string) {}

  async send(input: RunAgentInput) {
    const controller = new AbortController();
    mockControllers.set(input.runId, controller);

    for await (const streamed of agentRuntimeService.stream(input, {
      signal: controller.signal,
    })) {
      operationService.applyStreamedEvent(
        { sessionId: this.sessionId, threadId: input.threadId },
        streamed,
      );
    }
  }

  async stop(runId: string) {
    mockControllers.get(runId)?.abort();
  }
}
```

这样 reducer、持久化、清理、选择器和 UI 行为只有一套；生产和 mock 只在 transport handle 上分叉。

## 13. Stop、HITL、A2UI 与删除策略

### 13.1 Stop

```ts
async function stop(sessionId: string) {
  const operation = getActiveOperation(sessionId);
  if (!operation) return;

  const runtime = await sessionRuntimeRegistry.whenReady(sessionId);
  try {
    await runtime.stop(operation.runId);
  } finally {
    // 后端/Runtime stop 失败也只给本 run 合成 CANCELLED。
    applySyntheticCancelled(operation);
  }
}
```

不允许保存一个全局 AbortController，也不允许 `stop(B)` 调用 A 的 Agent。

### 13.2 HITL

- paused Operation 和 Worker 必须保留，不能执行 30 秒终态清理。
- `pendingInterrupts` 属于该 Session Worker 的 Agent 实例。
- legacy interrupt ID 保存到 `SessionOperation.legacyInterruptId`，不再放页面 `useRef`。
- HITL resume 仍是同一个 Thread 的后续 Run；具体是否复用原 `runId` 以 AG-UI/CopilotKit resume 语义为准，但必须建立新的/明确的 Operation 关联，不能覆盖其他 Session。

### 13.3 A2UI Action

- Action 必须携带所属 `sessionId/threadId` 和新的 `runId`。
- 新的 Action `runId` 由 Operation Service 在调用 Worker 前生成并注册；Worker 不得再次生成另一个 ID。
- `forwardedProps` 中包含 `action: 'a2uiAction'` 与 `a2uiAction` payload。
- 移除 `copilotkit.setProperties` 临时全局写入。
- A2UI Action 也受“同 Session 单活跃 Run”门禁；需要注入当前 Run 时必须由产品明确成队列/interrupt，首期不静默并发。

### 13.4 删除运行中的 Session

生产行为固定为：

```text
用户删除 Session
  → 若 running/paused，先显示确认
  → stop 对应 Operation
  → 等本地终态落库/超时
  → 删除 sessions/messages/checkpoints
  → 释放 Worker 和 Operation
```

不得先删数据库再让后台事件继续写入，否则 Session 会被事件重新制造成孤儿消息。

## 14. 后台完成与未读提示

Operation 完成时比较：

```ts
viewingSessionId === operation.sessionId
```

- 正在查看：刷新历史，不标未读。
- 不在查看：`sessions.unread = true`，侧栏显示完成点/状态。
- 用户切回：读取历史并清除 unread。

不要通过 `document.visibilityState` 判断具体 Session；页面可见不代表用户正在看该 Session。

## 15. 未来断点续传

首期架构已经保留全部必要字段，但在后端接口可用前不自动调用。

### 15.1 推荐请求

```http
POST /runs/resume
Content-Type: application/json

{
  "threadId": "thread-A",
  "runId": "run-A1",
  "afterEventId": "1723870000000-000042"
}
```

响应继续输出标准 AG-UI SSE。

### 15.2 前端恢复

```text
读取 sessionId 的 recoverable checkpoint
  → 用 checkpoint.snapshot 恢复 Operation
  → 创建 SessionRuntimeWorker
  → 订阅建立后请求 runId + latestEventId
  → reducer 用 processedEventIds 去重重叠事件
  → 收到 RUN_FINISHED/RUN_ERROR 后正常终态落库
```

后端不需要 `MESSAGES_SNAPSHOT` 才能恢复，因为本地 checkpoint snapshot 是恢复基线，服务端只补 `latestEventId` 后的增量事件。

### 15.3 必须满足的服务端语义

- `eventId` 在同一个 runId 内稳定有序。
- `afterEventId` 是 exclusive cursor：只返回其后的事件。
- 同 runId 的 resume 只订阅/重放，不重新启动 Agent。
- 能明确返回 running/terminal/not-found，不能用“没有事件”猜测已经结束。
- terminal event 也保存在事件日志中。

在这些条件满足前，刷新后继续沿用当前安全策略：陈旧 running checkpoint 转 cancelled，不自动重发整轮。

## 16. 并发、容量与资源策略

### 16.1 首期并发规则

- 同一 Session：1 个 active Run。
- 不同 Session：允许并发。
- 建议增加 `MAX_ACTIVE_SESSION_RUNS = 4` 或由 feature flag 配置。
- 达到上限时发送进入显式队列或提示用户；不能偷偷停止最早 Run。

### 16.2 内存边界

- Store 只保留 running/paused 与刚完成 30 秒的 Operation。
- `rawEvents` 继续最多 100 条。
- `processedEventIds` 当前最多 5000 条；终态后随 Operation 一起释放。
- Worker 只为活跃/短期保留 Session 存在。
- 历史消息只在 ChatPage 按页读取，不加载全部 Session。

### 16.3 清理条件

Worker 可以释放的前提：

```text
Operation 已 terminal
AND checkpoint/messages 已成功持久化
AND 不存在 pending HITL
AND 没有 queued action
AND retainUntil 已到
```

网络错误但后端是否仍在运行不明确时，首期标记 error 并释放本地流；未来有 status API 后再区分 `detached/running`。

## 17. 分阶段实施计划

### Phase 0：测试锁定现状

新增失败测试，先证明当前问题：

- A 运行时切换 B，A 的订阅被卸载。
- mock 执行 B 会 abort A。
- A/B checkpoint 的全局 timer 相互推迟。
- 相同 messageId 在 A/B IndexedDB 中发生覆盖。

### Phase 1：Operation Store 与持久化并发安全

修改/新增：

- 新增 `src/stores/sessionOperationStore.ts`。
- 新增 `src/features/chat/runtime/types.ts`。
- `sessionHistoryService.ts` 改为 per-run timer 与 scoped flush。
- `run-persisted` 事件增加 `sessionId/runId/status` detail。
- Dexie v4 增加 `storageKey`，完成旧数据迁移。

此阶段不切换生产 Hook，只建立基础能力并通过测试。

### Phase 2：Runtime Host 与生产独立订阅

修改/新增：

- 新增 `SessionRuntimeHost.tsx`。
- 新增 `SessionRuntimeWorker.tsx`。
- 新增 `sessionRuntimeRegistry.ts`。
- 新增 `bindAgentEvents.ts`，迁移当前全部 subscribe handler。
- `providers.tsx` 挂载 Host。

验证两个 Worker 可以同时持有不同 `useAgent` 实例和订阅。

### Phase 3：Operation Service 与 Hook 切换

- 新增 `sessionOperationService.ts`。
- 把 `runRef/inputRef/legacyInterruptIdRef` 迁移进 Operation。
- 重写 `useAgentDockConversation.ts` 为 facade。
- ChatPage 继续消费相同结果接口，只调整持久化事件过滤和 viewing session 注册。
- 移除页面 unmount 时对 Agent 的 unsubscribe 所有权。

### Phase 4：mock 统一与 A2UI/HITL

- 删除 `runStore` 单槽或改为同一个 Operation Service 的 mock adapter。
- A2UI Action 从全局 properties 迁至 forwardedProps。
- HITL pending/legacy interrupt 按 Session 隔离。
- stop、删除 Session、错误重试按 Session 验证。

### Phase 5：体验与保护

- 侧栏显示 running/completed/unread。
- 增加最大并发数与显式队列/提示。
- Operation 30 秒 GC、Worker 生命周期日志和诊断面板。
- feature flag 灰度：`multiSessionRuns`。

### Phase 6：后端支持后启用 resume

- 新增 `RuntimeResumeService` 或 Runtime Adapter 的 `connect` 映射。
- 使用 `runId + afterEventId`。
- 恢复 checkpoint snapshot 后重放增量。
- 增加断网、刷新、重复事件、terminal 重放测试。

## 18. 测试方案

### 18.1 Store/Service 单测

必须覆盖：

1. A/B 同时 start 后 `activeRunBySession` 各自独立。
2. A 的 Event 永远只更新 A snapshot。
3. 普通 Event 无 runId 时由 A Worker 捕获上下文路由。
4. `RUN_STARTED.runId` 与 active run 不一致时拒绝写入并上报。
5. 同 Session 第二次 send 被拒绝；不同 Session send 被允许。
6. stop(A) 只调用 A handle。
7. A terminal 不 flush B 的 pending checkpoint。
8. eventId 重复时 reducer 不重复追加 delta。
9. A/B 相同 messageId 在 Dexie 中都存在。
10. terminal complete 多次调用只落库/通知一次。

### 18.2 React 集成测试

使用 fake CopilotKit Agent：

```text
进入 A → send A → A 输出一半
切到 B → send B
B 输出一半
A 在后台继续并完成
切回 A → 看到 A 完整结果
B 仍处于 running/随后完成
```

额外覆盖：

- 切页不会调用 A subscription.unsubscribe。
- A terminal + GC 后才 unsubscribe。
- paused HITL 切页后仍能回到 A 批准。
- A2UI Action 的 payload 不出现在 B 请求中。

### 18.3 浏览器 E2E

网络面板验收：

- A、B 各有一个独立 `/api/copilotkit` run 请求。
- 两个 SSE 响应同时保持 open。
- 路由切换不触发 stop/abort。
- 每条请求拥有不同 runId，threadId 分别属于对应 Session。
- 后台完成后 IndexedDB messages 行的 sessionId 正确。

### 18.4 回归命令

```bash
pnpm run test
pnpm run typecheck
pnpm run build
```

## 19. 可观测性

日志统一携带：

```ts
{
  sessionId,
  threadId,
  runId,
  eventId,
  eventType,
  runtimeStatus,
}
```

建议事件：

- `runtime_worker_created`
- `runtime_worker_ready`
- `operation_started`
- `operation_event_applied`
- `operation_event_duplicate`
- `operation_protocol_mismatch`
- `operation_completed`
- `operation_checkpoint_failed`
- `runtime_worker_disposed`

默认生产日志不输出 event payload、用户消息或 reasoning，只输出 ID 和状态。

## 20. 验收标准

首期完成的定义：

- [ ] A、B、C 三个 Session 可以同时运行。
- [ ] 任意切换 20 次，不出现流中止、消息串 Session 或重复回答。
- [ ] 后台 Session 完成后切回，结果无需重新请求即可显示。
- [ ] 同 Session 快速连发仍只有一个 Run。
- [ ] stop/HITL/A2UI Action 只影响目标 Session。
- [ ] 终态结果写 messages，checkpoint 中不保留终态快照。
- [ ] 运行热状态在完成后释放，1000 个历史 Session 不产生 1000 个 Worker。
- [ ] A/B checkpoint 防抖互不影响。
- [ ] 相同 messageId 不会跨 Session 覆盖。
- [ ] mock 与 http 行为一致。
- [ ] 所有单测、类型检查与 build 通过。

## 21. 一句话实现边界

首期真正要实现的是：

> 把 CopilotKit Agent 的运行与订阅从 ChatPage 移到 Provider 下的常驻 SessionRuntimeWorker；用 `runId` 作为 Operation 主键，用 Worker 启动时捕获的 `sessionId` 路由全部后续 AG-UI 事件，用每 Run 独立 checkpoint 把最终结果落到对应 Session。

这足以完成同标签页多 Session 真并发。刷新/断点续传只需在该架构上增加服务端 `runId + afterEventId` 重放，不需要再次推翻前端状态模型。
