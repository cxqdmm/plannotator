/**
 * 需求卡文档（doc/管家审批与需求卡-方案.html）：one Markdown document — the six-section
 * body from `notes`, the context section from `contexts`, and the same renderer everywhere.
 */
import { describe, expect, test } from "bun:test";
import {
  REQUIREMENT_CARD_SECTIONS,
  missingRequirementCardSections,
  renderRequirementCard,
  requirementCardBody,
  requirementCardGuide,
  requirementCardTemplate,
} from "./requirement-card";
import type { RequirementContext } from "./requirements-types";

const contexts: RequirementContext[] = [
  { id: "ctx_1", kind: "link", name: "PRD", ref: "https://example.com/prd", by: null, created_at: "2026-11-26T00:00:00Z" },
  { id: "ctx_2", kind: "file", name: "登录页截图.png", ref: "/data/requirements/contexts/req_1/shot.png", image: true, by: "管家", created_at: "2026-11-26T00:00:00Z" },
];

describe("the requirement-card document", () => {
  test("the template carries the six fixed sections and their hints", () => {
    const template = requirementCardTemplate();
    for (const section of REQUIREMENT_CARD_SECTIONS) expect(template).toContain(`## ${section.heading}`);
    expect(requirementCardGuide()).toContain("背景 / 为什么");
    expect(requirementCardGuide()).toContain(REQUIREMENT_CARD_SECTIONS[0]!.hint);
  });

  test("missing sections are named; a plain note is background only; the full template misses none", () => {
    expect(missingRequirementCardSections("")).toHaveLength(6);
    expect(missingRequirementCardSections("旧版太慢，先重排结构。")).toEqual(["目标", "范围", "约束", "验收", "开放问题"]);
    expect(missingRequirementCardSections(requirementCardTemplate())).toEqual([]);
    expect(requirementCardBody("旧版太慢")).toStartWith("## 背景 / 为什么");
    expect(requirementCardBody("## 目标\n更快")).toBe("## 目标\n更快");
    // An empty body shows the whole six-section skeleton, never a bare card.
    for (const section of REQUIREMENT_CARD_SECTIONS) expect(requirementCardBody("")).toContain(`## ${section.heading}`);
  });

  test("the rendered card is the document the session receives: title, meta, body, contexts, start", () => {
    const card = renderRequirementCard({
      id: "req_01J",
      title: "登录页改版",
      notes: "## 背景 / 为什么\n旧版太慢\n\n## 目标\n- 首屏更快",
      stage: "design-review",
      priority: "medium",
      project: { id: "prj_1", name: "web", root: "/work/web" },
      agent: "opencode",
      contexts,
    });
    expect(card).toStartWith("# 需求卡：登录页改版");
    expect(card).toContain("**需求 ID**：`req_01J`");
    expect(card).toContain("**阶段**：设计评审");
    expect(card).toContain("**优先级**：中");
    expect(card).toContain("**项目**：web（`/work/web`）");
    expect(card).toContain("**执行 agent**：OpenCode");
    expect(card).toContain("## 背景 / 为什么\n旧版太慢");
    expect(card).toContain("## 相关上下文");
    expect(card).toContain("- 链接：https://example.com/prd —— PRD");
    expect(card).toContain("- 文件：/data/requirements/contexts/req_1/shot.png —— 登录页截图.png");
    expect(card).toContain("## 开始吧");
    expect(card).toContain("无需再 link");
  });

  test("no contexts means no empty context section", () => {
    const card = renderRequirementCard({ id: "req_1", title: "x", notes: "", stage: "design", priority: "none", contexts: [] });
    expect(card).not.toContain("## 相关上下文");
    expect(card).toContain("**优先级**：无");
  });
});
