export const DEMO_PLAN_CONTENT = `# 实施计划：实时协作

## 背景

本提案为 Plannotator 编辑器引入实时协作编辑，让多位评审者可以同时标注同一份计划，并以亚秒级延迟看到彼此的光标和编辑。我们的目标是**生产级并发**：每份文档最多 50 位活跃协作者，端到端「编辑到可见」延迟在 95 分位下低于 150ms。实现采用操作变换（operational transform），运行在专用的 Node.js 网关上；网关对客户端使用 \`WebSocket\`，对存储层使用 \`gRPC\`。完整理由和发布计划见[技术设计文档](https://docs.example.com/realtime-v2)。编辑器入口是 [App.tsx](packages/editor/App.tsx)，服务端配置位于 [server/index.ts](packages/server/index.ts)。

第一阶段的运行时参数：

\`\`\`typescript
export const COLLAB_CONFIG = {
  maxCollaborators: 50,
  heartbeatIntervalMs: 5_000,
  operationBatchSize: 32,
  gateway: "wss://collab.plannotator.ai",
} as const;
\`\`\`

### 配置参考

| 参数 | 值 | 说明 |
| --- | --- | --- |
| \`maxCollaborators\` | 50 | 每份文档的硬性上限，超过后网关拒绝新的加入请求 |
| \`heartbeatIntervalMs\` | 5 000 ms | 心跳间隔；连续三次未收到心跳即触发重连 |
| \`operationBatchSize\` | 32 | 合并进单个 WebSocket 帧的最大操作数 |
| \`gateway\` | \`wss://collab.plannotator.ai\` | 区域边缘端点；客户端按延迟路由 |

### 关键文件

| 文件 | 作用 |
| --- | --- |
| \`packages/editor/App.tsx\` | 编辑器入口 |
| \`packages/shared/resolve-file.ts\` | 路径解析 |
| \`packages/fake/nope.ts\` | 应当静默失败 |
| \`package.json\` | 根配置 |

## 概述
使用 _**[WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)**_ 和 *[操作变换](https://en.wikipedia.org/wiki/Operational_transformation)* 为编辑器添加实时协作功能。核心渲染逻辑位于 \`packages/ui/components/Viewer.tsx:140-180\`，块解析器位于 \`packages/ui/utils/parser.ts:261-286\`。

## 第一阶段：基础设施

### WebSocket 服务器
搭建一个处理并发连接的 WebSocket 服务器：

\`\`\`typescript
const server = new WebSocketServer({ port: 8080 });

server.on('connection', (socket, request) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, socket);

  socket.on('message', (data) => {
    broadcast(sessionId, data);
  });
});
\`\`\`

### 客户端连接
- 文档加载时建立持久连接
  - 使用认证令牌初始化 WebSocket
  - 每 30 秒发送一次心跳 ping/pong
  - 处理连接状态变化（connecting、open、closing、closed）
- 实现带指数退避的重连逻辑
  - 初始延迟 1 秒
  - 每次重试延迟翻倍（最长 30 秒）
  - 连接成功后重置延迟
- 优雅处理离线状态
  - 将本地更改排队到 IndexedDB
  - 在界面中显示离线指示
  - 重连后同步排队的更改

### 数据库 Schema

\`\`\`sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role VARCHAR(50) DEFAULT 'editor',
  cursor_position JSONB,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_collaborators_document ON collaborators(document_id);
\`\`\`

## 第二阶段：操作变换

> 关键洞察是：需要针对并发操作变换操作，才能保持一致性。

关键要求：
- 插入对插入的变换
  - 相同位置：用用户 ID 做确定性排序
  - 不同位置：调整较后操作的偏移量
- 插入对删除的变换
  - 删除之前插入：无需改动
  - 在删除范围内插入：需要特殊处理
    - 方案 A：把插入移到删除起始位置
    - 方案 B：完全丢弃这次插入
  - 删除之后插入：调整插入位置
- 删除对删除的变换
  - 不重叠：调整位置
  - 重叠：合并或拆分操作
- 在变换之间保持光标位置
  - 把光标当作零宽插入操作来跟踪
  - 每次变换后更新光标位置

### 变换实现

\`\`\`typescript
interface Operation {
  type: 'insert' | 'delete';
  position: number;
  content?: string;
  length?: number;
  userId: string;
  timestamp: number;
}

class OperationalTransform {
  private pendingOps: Operation[] = [];
  private history: Operation[] = [];

  transform(op1: Operation, op2: Operation): [Operation, Operation] {
    if (op1.type === 'insert' && op2.type === 'insert') {
      if (op1.position <= op2.position) {
        return [op1, { ...op2, position: op2.position + (op1.content?.length || 0) }];
      } else {
        return [{ ...op1, position: op1.position + (op2.content?.length || 0) }, op2];
      }
    }

    if (op1.type === 'delete' && op2.type === 'delete') {
      // Complex delete vs delete transformation
      const op1End = op1.position + (op1.length || 0);
      const op2End = op2.position + (op2.length || 0);

      if (op1End <= op2.position) {
        return [op1, { ...op2, position: op2.position - (op1.length || 0) }];
      }
      // ... more cases
    }

    return [op1, op2];
  }

  apply(doc: string, op: Operation): string {
    if (op.type === 'insert') {
      return doc.slice(0, op.position) + op.content + doc.slice(op.position);
    } else {
      return doc.slice(0, op.position) + doc.slice(op.position + (op.length || 0));
    }
  }
}
\`\`\`

## 第三阶段：界面更新

1. 实时显示协作者光标
   - 将光标渲染为彩色竖线
   - 在光标上方添加名字标签
   - 平滑地为光标移动添加动画
2. 显示在线状态指示
   - 在页眉中显示头像堆叠
   - 用下拉菜单列出全部协作者
     - 显示在线/离开状态
     - 显示最近活动时间
     - 允许 @ 提及协作者
3. 添加冲突解决界面
   - 高亮冲突区域
   - 显示 Diff 对比面板
   - 提供合并选项：
     - 采用我的版本
     - 采用对方的版本
     - 手动合并
4. 为每位用户实现撤销/重做栈
   - 按用户 ID 跟踪操作
   - 只允许撤销自己的更改
   - 在侧栏中显示撤销历史

### 光标的 React 组件

\`\`\`tsx
import React, { useEffect, useState } from 'react';
import { useCollaboration } from '../hooks/useCollaboration';

interface CursorOverlayProps {
  documentId: string;
  containerRef: React.RefObject<HTMLDivElement>;
}

export const CursorOverlay: React.FC<CursorOverlayProps> = ({
  documentId,
  containerRef
}) => {
  const { collaborators, currentUser } = useCollaboration(documentId);
  const [positions, setPositions] = useState<Map<string, DOMRect>>(new Map());

  useEffect(() => {
    const updatePositions = () => {
      const newPositions = new Map<string, DOMRect>();
      collaborators.forEach(collab => {
        if (collab.userId !== currentUser.id && collab.cursorPosition) {
          const rect = getCursorRect(containerRef.current, collab.cursorPosition);
          if (rect) newPositions.set(collab.userId, rect);
        }
      });
      setPositions(newPositions);
    };

    const interval = setInterval(updatePositions, 50);
    return () => clearInterval(interval);
  }, [collaborators, currentUser, containerRef]);

  return (
    <>
      {Array.from(positions.entries()).map(([userId, rect]) => (
        <div
          key={userId}
          className="absolute pointer-events-none transition-all duration-75"
          style={{
            left: rect.left,
            top: rect.top,
            height: rect.height,
          }}
        >
          <div className="w-0.5 h-full bg-blue-500 animate-pulse" />
          <div className="absolute -top-5 left-0 px-1.5 py-0.5 bg-blue-500
                          text-white text-xs rounded whitespace-nowrap">
            {collaborators.find(c => c.userId === userId)?.userName}
          </div>
        </div>
      ))}
    </>
  );
};
\`\`\`

### 配置

\`\`\`json
{
  "collaboration": {
    "enabled": true,
    "maxCollaborators": 10,
    "cursorColors": ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"],
    "syncInterval": 100,
    "reconnect": {
      "maxAttempts": 5,
      "backoffMultiplier": 1.5,
      "initialDelay": 1000
    }
  }
}
\`\`\`

---

## 发布前检查清单

- [ ] 基础设施就绪
  - [x] WebSocket 服务器已部署
  - [x] 数据库迁移已应用
  - [ ] 负载均衡器已配置
    - [ ] SSL 证书已安装
    - [ ] 健康检查已启用
      - [ ] /health 端点返回 200
      - [ ] /ready 端点检查数据库连接
        - [ ] 主数据库
        - [ ] 只读副本
          - [ ] us-east-1 副本
          - [ ] eu-west-1 副本
- [ ] 安全审计完成
  - [x] 认证流程已评审
  - [ ] 限流已实现
    - [x] 匿名用户 100 次请求/分钟
    - [ ] 已认证用户 1000 次请求/分钟
  - [ ] 输入清洗已验证
- [x] 文档已更新
  - [x] API 参考已生成
  - [x] 集成指南已撰写
  - [ ] 视频教程已录制

### API 端点

| 方法 | 端点 | 说明 | 认证 |
|--------|----------|-------------|------|
| GET | /api/documents | 列出所有文档 | 需要 |
| POST | /api/documents | 创建新文档 | 需要 |
| GET | /api/documents/:id | 获取文档 | 需要 |
| PUT | /api/documents/:id | 更新文档 | 所有者/编辑者 |
| DELETE | /api/documents/:id | 删除文档 | 仅所有者 |
| POST | /api/documents/:id/share | 分享文档 | 仅所有者 |
| GET | /api/documents/:id/collaborators | 列出协作者 | 需要 |

### 性能目标

| 指标 | 目标 | 当前 | 状态 |
|--------|--------|---------|--------|
| WebSocket 延迟 | < 50ms | 42ms | 符合预期 |
| 首个光标出现时间 | < 200ms | 310ms | **有风险** |
| 并发用户/文档 | 50 | 25 | 进行中 |
| 操作变换 | < 5ms | 3ms | 符合预期 |
| 重连时间 | < 2s | 1.8s | 符合预期 |

### 混合列表样式

* 第 0 级的星号项
  - 第 1 级的短横线项
    * 第 2 级的星号项
      - 第 3 级的短横线项
        * 第 4 级的星号项
          - 合理的最大深度
1. 编号项
   - 编号下的子项
   - 另一个子项
     1. 嵌套的编号列表
     2. 第二个嵌套编号

---

## 附录：图表

### 架构

\`\`\`mermaid
flowchart LR
    subgraph Client["Client Browser"]
        UI[React UI] --> OT[OT Engine]
        OT <--> WS[WebSocket Client]
    end

    subgraph Server["Backend"]
        WSS[WebSocket Server] <--> OTS[OT Transform]
        OTS <--> DB[(PostgreSQL)]
    end

    WS <--> WSS
\`\`\`

### 服务依赖（Graphviz）

\`\`\`graphviz
digraph CollaborationStack {
  rankdir=LR;
  node [shape=box, style="rounded"];

  Browser [label="Client Browser"];
  API [label="WebSocket API"];
  OT [label="OT Engine"];
  Redis [label="Presence Cache"];
  Postgres [label="PostgreSQL"];

  Browser -> API;
  API -> OT;
  OT -> Redis;
  OT -> Postgres;
}
\`\`\`

---

## 第四阶段：文件更改

### 修改的文件

核心连接逻辑位于 \`packages/ui/components/InlineMarkdown.tsx\`，负责渲染行内 token。检测工具位于 \`packages/shared/code-file.ts\`，弹出式查看器通过 \`packages/ui/hooks/useCodeFilePopout.ts\` 接入。

服务端方面，更新 packages/server/index.ts 以注册新的 WebSocket 路由，并更新 packages/server/reference-handlers.ts 以提供文件解析端点。编辑器入口 \`packages/editor/App.tsx\` 需要包裹协作 provider。

### 构建与部署

- 更新 \`Dockerfile\`，暴露新的 WebSocket 端口
- 运行 \`package.json\` 中的构建流水线脚本
- \`.env\`、\`README.md\` 等配置文件无需改动
- \`npm install\`、\`bun run build\` 等命令保持不变

**目标：** 下个冲刺发布 MVP
`;
