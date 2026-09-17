# HITL Interrupt/Resume 精简设计

> 状态：设计评审稿，暂不实施
> 日期：2026-09-17
> 范围：AG-UI + CopilotKit Runtime + 云端 Agent 的逻辑型 Human-in-the-Loop 交互

## 1. 结论

采用生产级主流模式：后端保存 checkpoint，通过 AG-UI 标准
`RUN_FINISHED(outcome.type="interrupt")` 结束当前 SSE；前端收集回答后，在下一次
`RunAgentInput.resume[]` 中提交结果，并用该请求返回的新 SSE 继续原回答。

在上一版方案基础上做以下收敛：

1. 不发送 `responseSchema`。AG-UI 中该字段是可选的；每次把 `fields/actions` 再翻译成一份
   JSON Schema 会形成双重描述和一致性风险。
2. 不发送 `actions`。按钮由 `kind + allowSkip + allowRevision` 确定性推导。
3. 不发送 `presentation/behavior`。Modal、Drawer、Inline、列数和宽度均由前端策略决定。
4. 常见交互不发送 `fields`；只有混合表单 `form` 才逐字段声明类型。
5. Agent 不生成 AG-UI Event。Agent 只调用四个小工具；后端 compiler 校验并生成协议对象。
6. 后端 wire 中不得出现前端产品名、React 组件名或其他客户端实现名称。

这意味着“每个属性是什么类型”仍然有严格定义，但类型定义只在固定协议中声明一次，
不需要在每个 Event 里重复携带一份 JSON Schema。

## 2. 运行边界与 ID

| ID | 含义 | HITL resume 后 |
|---|---|---|
| `sessionId` | 产品会话 | 不变 |
| `threadId` | Agent 上下文与 checkpoint 归属 | 不变 |
| `runId` | 当前一次用户问答执行 | 不变 |
| `operationId` | 前端运行主键，当前等于 `runId` | 不变 |
| `interruptId` | 一次待解决的人工交互 | 每次中断新建 |
| assistant `messageId` | 当前回答 | 不变，恢复后的内容继续追加 |
| `eventId` | 项目现有 SSE 去重/游标扩展 | 同一 run 全程唯一且单调推进 |

HITL 不创建新的 user message、assistant row 或普通对话轮次。物理上建立新的 HTTP/SSE，
逻辑上继续原 checkpoint：

```text
run R1 / assistant row M1
  -> interrupt I1
  -> resume I1
  -> run R1 / assistant row M1 continues
  -> success
```

## 3. 端到端时序

```text
Browser                  Copilot Runtime          Orchestration / Agent
   | POST agent/run R1          |                         |
   |--------------------------->| POST /ag-ui R1          |
   |<========================== SSE ======================|
   |<-- text/reasoning/events ----------------------------|
   |<-- RUN_FINISHED(outcome=interrupt, I1) --------------|
   |       当前 SSE 正常关闭                              |
   | 显示 HITL Modal/Drawer/Inline                        |
   | 用户填写并提交                                       |
   | POST agent/run R1 + resume[I1]                       |
   |--------------------------->| POST /ag-ui R1+resume   |
   |<======================== 新 SSE ======================|
   |<-- 后续 text/reasoning/events -----------------------|
   |<-- RUN_FINISHED(outcome=success) --------------------|
```

携带 resume 的 POST 本身返回 `text/event-stream`，不需要再创建一条普通用户消息。

## 4. 最小 AG-UI Interrupt Event

### 4.1 Wire 类型

```ts
type RunFinishedInterruptEvent = {
  type: 'RUN_FINISHED';
  threadId: string;
  runId: string;
  eventId?: string; // AgentDock 现有游标扩展，不属于 HITL 业务结构
  outcome: {
    type: 'interrupt';
    interrupts: HitlInterrupt[];
  };
};

type HitlInterrupt = {
  id: string;
  reason: 'human_input_required';
  message: string;
  metadata: {
    hitl: HitlSpec;
  };
  expiresAt?: string;
};
```

`interrupts` 是一个 batch，长度为 1–8。只有彼此独立、可以同时回答的问题才能放入同一
batch；存在顺序依赖的问题必须等本批 resume 后，由后端在下一次执行中再发出新的 interrupt。

### 4.2 Interrupt 属性

| 属性 | 必填 | 类型/取值 | 含义 |
|---|---:|---|---|
| `id` | 是 | 非空 string | 稳定 `interruptId`；重试期间不变 |
| `reason` | 是 | 固定 `human_input_required` | confirmation/text/choice/form 不再占用 reason 分支 |
| `message` | 是 | string，1–1000 字符 | 问题正文，同时是所有客户端的纯文本 fallback |
| `metadata.hitl` | 是 | `HitlSpec` | 最小、强类型的结构化交互描述 |
| `expiresAt` | 否 | RFC 3339 datetime | 到期后服务端拒绝 resume；P0 默认不设置 |

P0 不发送 `toolCallId`，因为当前范围是信息补充和逻辑确认，不是工具审批；也不发送
`responseSchema`，因为 resume 约束由固定的 `HitlResumePayload` 和 pending spec 共同决定。

## 5. `metadata.hitl` 判别联合类型

```ts
type HitlSpec =
  | HitlConfirmSpec
  | HitlTextSpec
  | HitlChoiceSpec
  | HitlFormSpec;

type HitlSpecBase = {
  title?: string;
  allowSkip?: boolean; // 默认 false
};

type HitlConfirmSpec = HitlSpecBase & {
  kind: 'confirm';
  allowRevision?: boolean; // 默认 false
};

type HitlTextSpec = HitlSpecBase & {
  kind: 'text';
  multiline?: boolean; // 默认 false
  label?: string;
  placeholder?: string;
  required?: boolean; // 默认 true
  maxLength?: number; // 默认 2000，上限 10000
};

type HitlChoiceSpec = HitlSpecBase & {
  kind: 'choice';
  multiple?: boolean; // 默认 false
  options: HitlOption[];
  allowOther?: boolean; // 默认 false
  required?: boolean; // 默认 true
};

type HitlFormSpec = HitlSpecBase & {
  kind: 'form';
  fields: HitlFormField[];
};

type HitlOption = {
  value: string;
  label: string;
  description?: string;
};
```

### 5.1 顶层规则

| kind | 需要的动态信息 | 前端默认呈现 | 可用动作 |
|---|---|---|---|
| `confirm` | 无额外字段 | Modal | continue；可选 revise/skip；固定 cancel |
| `text` | 输入提示和长度 | Modal 或 Inline | submit；可选 skip；固定 cancel |
| `choice` | options、是否多选/其他 | Modal | submit；可选 skip；固定 cancel |
| `form` | 2–8 个字段 | Modal；字段较多时 Drawer | submit；可选 skip；固定 cancel |

通用约束：

- `title` 最长 120 字符；缺省时前端使用本地化默认标题。
- `allowSkip` 只控制是否展示 skip；cancel 是 run 控制能力，始终存在，但关闭前端 surface
  时应二次确认。
- option 数量为 2–20，`value` 在当前交互内唯一，前端显示 `label`、回传 `value`。
- 后端不得发送 disabled option；不可选择的内容不应出现在当前候选列表。

### 5.2 为什么不再发送 actions

动作表是固定规则，不需要每次传输：

```text
confirm -> continue [+ revise] [+ skip] + cancel
其他 kind -> submit [+ skip] + cancel
```

按钮文案、颜色和顺序由前端 i18n 与设计系统决定。这样可以避免模型或后端写出不一致的
`action id / label / style / requiresFields` 组合。

## 6. 只有 form 才声明字段类型

混合表单确实需要告诉前端每个字段是什么类型，这是无法完全省略的信息；但可以限制为一个
小型判别联合，而不是任意 JSON Schema。

```ts
type HitlFormField =
  | {
      name: string;
      kind: 'text' | 'textarea';
      label: string;
      required?: boolean;
      placeholder?: string;
      maxLength?: number;
    }
  | {
      name: string;
      kind: 'number';
      label: string;
      required?: boolean;
      minimum?: number;
      maximum?: number;
    }
  | {
      name: string;
      kind: 'choice';
      label: string;
      required?: boolean;
      multiple?: boolean;
      options: HitlOption[];
      allowOther?: boolean;
    }
  | {
      name: string;
      kind: 'date' | 'datetime';
      label: string;
      required?: boolean;
    };
```

约束：

- `name` 匹配 `^[a-z][a-zA-Z0-9_]{0,63}$`，同一 form 内唯一。
- `fields` 为 2–8 个，不允许嵌套 form、对象或数组。
- 是/否问题使用 choice 的两个 option，不再单独增加 boolean 渲染分支。
- 单选/多选与输入混合使用 form；简单“其他”使用 choice 的 `allowOther=true`。
- P0 不允许 Agent 指定正则、组件名称、列数、宽度、按钮样式或错误文案。

## 7. 前端 Resume Schema

### 7.1 AG-UI ResumeEntry

```ts
type HitlResumeEntry =
  | {
      interruptId: string;
      status: 'resolved';
      payload: HitlResumePayload;
    }
  | {
      interruptId: string;
      status: 'cancelled';
    };

type HitlResumeBatch = HitlResumeEntry[];

type HitlResumePayload = {
  action: 'continue' | 'revise' | 'submit' | 'skip';
  answer?: HitlAnswer;
};

type HitlChoiceAnswer = {
  selected: string[];
  other?: string;
};

type HitlAnswer =
  | string
  | HitlChoiceAnswer
  | Record<string, string | number | HitlChoiceAnswer>;
```

#### `resume[].status` 取值与含义

`status` 是 AG-UI `ResumeEntry` 的处理结果，不是弹窗显示状态，固定只有两个取值：

| status | 含义 | payload | 是否继续当前 run |
|---|---|---|---:|
| `resolved` | 用户已经对该 interrupt 给出有效决定 | 必须携带；具体决定由 `payload.action` 表达 | 是 |
| `cancelled` | 用户明确选择停止本次 run | 不得携带 | 否 |

`resolved` 不等于“批准”。回答文本、提交选项、提交表单、`revise` 和 `skip` 都属于
`resolved`；其中 `skip` 表示用户不补充信息但允许 Agent 自行继续。`cancelled` 只表示终止
当前 run，不能用于普通关闭或暂时离开页面。

以下概念不得混用：

| 层级 | 取值 | 是否发送给后端 |
|---|---|---:|
| Run 状态 | `running / paused / success / error / cancelled` | 由运行协议维护 |
| HITL UI 状态 | `pending / submitting / resolved` | 否，仅前端渲染使用 |
| `resume[].status` | `resolved / cancelled` | 是 |

用户切换到其他 Session、刷新前仍未提交、或暂时离开页面时，不发送 resume，interrupt 继续保持
pending。弹窗不支持右上角关闭、点击遮罩关闭或 Esc 关闭；只有明确点击“停止本次任务”才生成
整批 `cancelled`。

`answer` 的合法形状由 pending interrupt 的 `kind` 确定：

| kind/action | answer |
|---|---|
| `confirm + continue` | 不得出现 |
| `confirm + revise` | string，修改意见 |
| 任意 `skip` | 不得出现 |
| `text + submit` | string |
| `choice + submit` | `HitlChoiceAnswer`；单选时 `selected.length <= 1` |
| `form + submit` | 以 field `name` 为 key 的 object |

日期返回 `YYYY-MM-DD`，datetime 返回 RFC 3339 string。缺失 optional field 表示未填写，不使用
空字符串伪装缺失值。

### 7.2 Batch 提交规则

后端一次返回的 `interrupts[]` 是同一个待回答 batch。前端必须：

1. 按 Event 中的顺序渲染全部 interrupt，并分别保存草稿和校验状态。
2. 等用户完成全部必填交互后，只发起一次 resume 请求。
3. `resume[]` 必须按原顺序覆盖当前 pending `interruptId` 集合，每个 ID 恰好出现一次。
4. 后端先校验整个数组；任一 entry 非法时整批拒绝，不恢复 checkpoint。
5. 正常提交时所有 entry 均为 `resolved`；用户取消整个 batch 时所有 entry 均为
   `cancelled`。P0 不接受 resolved/cancelled 混合 batch。

后端只有在问题彼此独立时才能把它们放入同一个 `interrupts[]`。例如“选择目标市场”和
“填写报告语言”可以同批；“先选择市场，再根据市场动态生成公司列表”必须拆成两次 interrupt。
如果多个字段本来属于同一张业务表单，应优先使用一个 `kind="form"` interrupt，而不是拆成
多个 interrupt；数组主要用于并行 graph branch、子 Agent 或其他真正独立的暂停点。

### 7.3 Resume Batch 示例

```json
{
  "threadId": "thread-1",
  "runId": "run-100",
  "state": {},
  "messages": [],
  "tools": [],
  "context": [],
  "forwardedProps": {
    "action": "hitlResponse",
    "sessionId": "session-1",
    "fab": "F15B",
    "agentId": "analysis-agent"
  },
  "resume": [
    {
      "interruptId": "int-choice",
      "status": "resolved",
      "payload": {
        "action": "submit",
        "answer": {
          "selected": ["quality", "delivery"],
          "other": "供应商稳定性"
        }
      }
    },
    {
      "interruptId": "int-note",
      "status": "resolved",
      "payload": {
        "action": "submit",
        "answer": "重点查看最近三个月"
      }
    }
  ]
}
```

取消整个 batch 时，每个 pending interrupt 都发送 cancelled，且不携带 payload：

```json
[
  { "interruptId": "int-choice", "status": "cancelled" },
  { "interruptId": "int-note", "status": "cancelled" }
]
```

skip 与 cancel 不同：skip 表示“不补充，由 Agent 自行继续”，cancel 表示终止当前 run。

### 7.4 一个 batch 只渲染一个弹窗

一次 `RUN_FINISHED(outcome=interrupt)` 中的整个 `interrupts[]` 对应一个 HITL Modal。每个
interrupt 是 Modal 正文中的一个问题区块，底部只有一组 batch 级操作按钮：

```text
┌──────────────────────────────────┐
│ 需要你的输入                      │
│                                  │
│ 1/3 请选择报告范围                │
│     ○ 摘要  ○ 完整报告            │
│                                  │
│ 2/3 请填写报告语言                │
│     [ 中文                     ]  │
│                                  │
│ 3/3 是否包含原始数据              │
│     ○ 是    ○ 否                  │
│                                  │
│ [停止本次任务]       [提交并继续]  │
└──────────────────────────────────┘
```

对应的前端结构应保持 footer 位于问题循环之外：

```tsx
<Modal
  closable={false}
  keyboard={false}
  maskClosable={false}
  footer={(
    <>
      <Button onClick={cancelBatch}>停止本次任务</Button>
      <Button type="primary" onClick={submitBatch}>提交并继续</Button>
    </>
  )}
>
  {interrupts.map((interrupt, index) => (
    <HitlQuestion
      key={interrupt.id}
      index={index}
      interrupt={interrupt}
    />
  ))}
</Modal>
```

`submitBatch` 等全部问题通过校验后一次发送完整、有序的 `resolved` 数组；`cancelBatch` 一次
生成与全部 pending interrupt 对应的 `cancelled` 数组。不得为三个问题分别创建三个 Modal，
也不得在每个问题内部放置“停止本次任务”按钮。

## 8. 后端 Event 示例

多选加自定义输入只需要以下结构：

```json
{
  "type": "RUN_FINISHED",
  "eventId": "run-100:42",
  "threadId": "thread-1",
  "runId": "run-100",
  "outcome": {
    "type": "interrupt",
    "interrupts": [
      {
        "id": "int-choice",
        "reason": "human_input_required",
        "message": "请选择需要重点分析的维度。",
        "metadata": {
          "hitl": {
            "kind": "choice",
            "title": "分析维度",
            "multiple": true,
            "allowOther": true,
            "allowSkip": true,
            "options": [
              { "value": "cost", "label": "成本" },
              { "value": "quality", "label": "质量" },
              { "value": "delivery", "label": "交付周期" }
            ]
          }
        }
      },
      {
        "id": "int-note",
        "reason": "human_input_required",
        "message": "还有哪些需要特别关注的内容？",
        "metadata": {
          "hitl": {
            "kind": "text",
            "title": "补充说明",
            "multiline": true,
            "required": true,
            "maxLength": 500
          }
        }
      }
    ]
  }
}
```

相比上一版，删除了整份 `responseSchema`、重复的 `fields`、`actions`、`presentation` 和
`behavior`。保留下来的每个字段都会改变交互语义，不再携带纯 UI 装饰信息。

混合表单示例：

```json
{
  "id": "int-01JXY2",
  "reason": "human_input_required",
  "message": "请补充报告范围。",
  "metadata": {
    "hitl": {
      "kind": "form",
      "title": "报告范围",
      "allowSkip": true,
      "fields": [
        {
          "name": "markets",
          "kind": "choice",
          "label": "目标市场",
          "multiple": true,
          "allowOther": true,
          "required": true,
          "options": [
            { "value": "china", "label": "中国" },
            { "value": "global", "label": "全球" }
          ]
        },
        {
          "name": "note",
          "kind": "textarea",
          "label": "补充说明",
          "maxLength": 500
        }
      ]
    }
  }
}
```

## 9. Agent 与 Compiler 的职责

### 9.1 Agent 只调用四个小工具

```ts
type ConfirmStepArgs = {
  message: string;
  title?: string;
  allowRevision?: boolean;
  allowSkip?: boolean;
};

type AskTextArgs = {
  message: string;
  title?: string;
  multiline?: boolean;
  required?: boolean;
  allowSkip?: boolean;
};

type AskChoiceArgs = {
  message: string;
  title?: string;
  options: Array<{ value: string; label: string; description?: string }>;
  multiple?: boolean;
  allowOther?: boolean;
  required?: boolean;
  allowSkip?: boolean;
};

type AskFormArgs = {
  message: string;
  title?: string;
  fields: HitlFormField[];
  allowSkip?: boolean;
};
```

工具名建议：

```text
confirm_step
ask_text
ask_choice
ask_form
```

Agent 不生成 `RUN_FINISHED`、ID、metadata envelope、resume schema、JSON Schema 或 UI 布局。
`ask_form` 是唯一需要逐字段声明类型的工具，而且限制在最多八个基础字段。

### 9.2 确定性 Compiler

```text
HumanInteractionCompiler
  validateToolCall(toolName, args)
  normalizeSpec(toolName, args)
  applyServerPolicy(allowSkip/allowRevision)
  createInterruptId()
  persistPendingInterrupt(spec + checkpoint)
  createRunFinishedInterruptEvent()
```

生成顺序：

1. 用 Pydantic/Zod 校验工具参数；失败最多让模型重试一次。
2. 根据工具名确定 `kind`，应用长度、数量和服务端策略限制。
3. 创建稳定 `interruptId`，持久化 pending spec 与 checkpoint。
4. 生成标准 `RUN_FINISHED(outcome=interrupt)`；不让模型手写 Event。
5. resume 时根据已保存的 pending spec 校验 `action + answer`，而不是信任客户端。

## 10. 前端渲染策略

前端按固定规则选择容器，不需要后端指定组件：

```text
confirm                         -> Modal
text                            -> Modal；低打扰场景可 Inline
choice                          -> Modal
form.fields.length <= 4         -> Modal
form.fields.length > 4          -> Drawer
```

收到 interrupt 后：

1. 保存完整 `interrupts[]` batch，operation 进入 `paused`，当前 SSE 正常结束。
2. 在原 assistant 时间线插入一个 HITL batch block，并在其中渲染全部交互。
3. 全部完成后一次性提交 `resume[]`；不增加 user message，不创建新的 assistant placeholder。
4. `runAgent({ runId, forwardedProps, resume })` 返回的新 SSE 继续 reduce 到同一个 run/row。
5. 整个 batch 改为 resolved 摘要，后续文本排在其后。

### 10.1 重新进入 Session：仅本地恢复

用户重新进入 Session 时，paused HITL 只从浏览器 IndexedDB 中保存的 run checkpoint 恢复：

```text
进入 Session
  -> 读取本地 paused checkpoint
  -> 恢复其中的 agentDock.hitl activity 与 interrupts[]
  -> 仅在当前 Session 渲染 HITL 弹窗
```

进入 Session 本身不得查询远端 run 状态、拉取远端 pending interrupt、建立恢复 SSE，或根据
`lastEventId` 补发 HITL Event。本地不存在 paused checkpoint 时不显示 HITL；不尝试从远端补齐。
只有用户提交完整 `resume[]` 后，前端才向 CopilotKit Runtime 发起远程恢复请求。

该约束专门适用于 `status=paused` 的 HITL 恢复；普通 `status=running` 的网络断线续传仍按实时
协议的游标恢复规则处理，不应被误认为 HITL 弹窗恢复。

同一 `runId` 恢复后，`eventId` 不得从头计数，否则当前 reducer 会把事件误判为重复。

## 11. 校验、幂等与 fallback

### 11.1 正常校验

- 前端用本地 `HitlSpec` 判别联合校验 Event，用对应 kind 的 answer validator 校验提交。
- 后端用同一份 validator 再次校验，并与数据库里的 pending spec 对照。
- resume 必须按原顺序完整覆盖当前 run 的 pending interrupt 集合，不能遗漏、重复或夹带未知 ID。
- 后端对 batch 做原子校验与原子状态迁移，不允许部分 interrupt 已恢复、部分仍 pending。
- `(threadId, runId, orderedInterruptIds, resumeBatchHash)` 重复提交返回相同结果。
- 首个合法 batch 获胜；后续相同 batch 返回幂等结果，不同 batch 返回
  `already_resolved/conflict`。

### 11.2 错误分层

| 错误 | 前端行为 | 后端行为 |
|---|---|---|
| Event 缺 `id/threadId/runId` | 不展示可提交表单，显示协议错误与重试 | 记录协议错误，不能创建不可恢复 checkpoint |
| `metadata.hitl` 缺失或非法 | 展示 `message + 通用 textarea + submit/cancel` | 接受 string fallback，让 Agent 解释；记录兼容告警 |
| options/fields 局部非法 | 使用同一通用文本 fallback，不猜测选项 | 同上 |
| resume 不符合 pending spec | 保留用户草稿并显示字段错误 | 返回结构化 4xx，不恢复 checkpoint |
| resume 未覆盖完整 batch | 保留所有草稿并提示完成全部问题 | 返回 `HITL_INCOMPLETE_BATCH`，不恢复 checkpoint |
| interrupt batch 已解决 | 显示已提交摘要，不再次恢复 | 返回幂等结果或 conflict |

不采用“把坏 Schema 再交给 Agent 重生 UI”的循环。协议 Event 由确定性 compiler 生成；前端遇到
兼容问题时直接使用稳定 fallback，并通过诊断接口上报。这样不会让用户陷入无限重新生成。

## 12. 与当前代码的冲突

| 当前实现 | 问题 | 后续改造 |
|---|---|---|
| `applyRunFinished` 只保留 id/message | `metadata.hitl` 丢失 | 完整保存标准 Interrupt |
| resume 仅 `{decision,input}` | 无法表达 choice/form | 改为 `{action,answer}` |
| legacy 只有 approve/reject | 与逻辑补充不匹配 | 仅保留兼容，标准 interrupt 优先 |
| `HitlMode` 八种 mode | 类型重复、组合能力弱 | 改为四种 `kind` |
| 当前自动审批 | 无法自动回答信息补充 | 移除逻辑型 HITL 自动审批 |
| 草稿仅组件 state | 刷新丢失 | 按 interruptId 持久化草稿 |
| reducer 按 eventId 去重 | resume 流重置 ID 会丢事件 | 同一 run 全程唯一递增 |

前端内部 ViewModel 名称可以保留在前端代码中，但不得进入后端 wire。

## 13. 当前依赖能力

项目当前版本：

- `@ag-ui/core/client 0.0.57`
- `@copilotkit/react-core/runtime 1.68.1`

源码确认：

- `Interrupt.message/responseSchema/expiresAt/metadata` 均为 optional；本项目 profile 仅将
  `message` 和 `metadata.hitl` 提升为业务必填。
- `Interrupt.metadata` 支持任意 record。
- `ResumeEntry.payload` 为 `any`，不会删除结构化 answer。
- `RunFinishedEvent` 原生支持 `outcome.type="interrupt"`。
- CopilotKit `useInterrupt` 可以 resolve 任意 payload 或 cancel。
- Runtime 解析 `RunAgentInput` 后可以把 `resume[]` 原样转发给上游 AG-UI Agent。

因此精简协议不需要 CustomEvent，也不需要修改 AG-UI 类型。

## 14. 实施顺序（本轮不执行）

1. 评审并冻结本文 compact schema。
2. 后端实现四个小工具、compiler、checkpoint 与 fixture。
3. 前端实现 `HitlSpec` validator、projection 和 renderer registry。
4. 接入标准 resume，确保新 SSE 继续原 assistant row。
5. 实现通用文本 fallback、草稿恢复和幂等提交。
6. 完成端到端测试后再移除 legacy `on_interrupt` 主路径。

## 15. P0 验收

- confirm：continue/revise/skip/cancel。
- 单行/多行输入。
- 单选、多选、选择加“其他”。
- 选择与输入混合 form。
- HITL 前后保持一个 user message、一个 assistant row 和同一逻辑 run。
- resume POST 返回的新 SSE 继续写入原 RuntimeRunState。
- 前后端双重校验，重复提交幂等。
- 刷新后恢复完整 pending batch 与每个 interrupt 的 draft。
- 非法/未知 metadata 使用通用文本 fallback，不白屏、不无限重生。
- backend wire 不出现前端产品名、组件名、布局或样式字段。
- legacy `on_interrupt` 只用于过渡兼容，不覆盖标准 Interrupt。
