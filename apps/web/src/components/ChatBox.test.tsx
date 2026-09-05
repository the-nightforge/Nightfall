import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ChatMessage } from "@masoi/shared";
import type { ChatComposerState } from "@/lib/chat-channels";
import type { QuickPhrase } from "@/lib/quick-phrases";

/**
 * Khung chat: nhắc tên bằng "@", chip câu nhanh, và tô sáng câu gọi mình.
 *
 * Luật thuần đã có test ở `lib/chat-mention.test.ts` và `lib/quick-phrases.test.ts`;
 * ở đây kiểm phần chỉ DOM mới trả lời được: popover có mở đúng lúc không, bàn
 * phím có đi qua nó trước khi tới nút Gửi không, và con trỏ có về đúng chỗ.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN: ChatComposerState = { canSend: true, channel: "day", placeholder: "Chat…", reason: "" };
const NAMES = ["Hoàng Anh", "Mai Chi", "An"];
const PHRASES: QuickPhrase[] = [
  { label: "Tôi là dân", text: "Tôi là dân" },
  { label: "Nghi @", text: "Nghi @", wantsMention: true },
];

function message(over: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", channel: "day", playerId: "a", playerName: "An", text: "", at: 1, ...over };
}

async function mount(props: { messages?: ChatMessage[]; draftControlled?: boolean } = {}) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ChatBox } = await import("./ChatBox");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const sent: string[] = [];
  let draft = "";

  const render = async () => {
    await act(async () => {
      root.render(
        React.createElement(ChatBox, {
          messages: props.messages ?? [],
          onSend: (t: string) => void sent.push(t),
          composer: OPEN,
          mentionNames: NAMES,
          meName: "Tôi",
          quickPhrases: PHRASES,
          ...(props.draftControlled
            ? {
                draft,
                onDraftChange: (d: string) => {
                  draft = d;
                  void render();
                },
              }
            : {}),
        }),
      );
    });
  };
  await render();

  const input = () => host.querySelector<HTMLInputElement>("input")!;
  const listbox = () => host.querySelector<HTMLElement>('[role="listbox"]');
  const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.textContent);

  return {
    host,
    sent,
    input,
    listbox,
    options,
    type: async (value: string) => {
      const el = input();
      await act(async () => {
        // React đọc value qua setter gốc của prototype, không qua thuộc tính instance.
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(el, value);
        el.setSelectionRange(value.length, value.length);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    key: async (key: string) => {
      await act(async () => {
        input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
      await act(async () => {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      });
    },
    clickChip: async (label: string) => {
      const chip = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Câu nhanh"] button')].find(
        (b) => b.textContent === label,
      )!;
      await act(async () => chip.click());
      await act(async () => {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("ChatBox: nhắc tên", () => {
  it("gõ '@h' mở popover với tên khớp; không có @ thì không có popover", async () => {
    const v = await mount();
    await v.type("nghi ");
    assert.equal(v.listbox(), null);
    await v.type("nghi @h");
    assert.ok(v.listbox());
    assert.deepEqual(v.options(), ["@Hoàng Anh"]);
    assert.equal(v.input().getAttribute("aria-expanded"), "true");
    await v.cleanup();
  });

  it("Enter khi popover mở thì CHỌN tên, không gửi; con trỏ đứng sau dấu cách", async () => {
    const v = await mount();
    await v.type("@");
    assert.deepEqual(v.options(), ["@Hoàng Anh", "@Mai Chi", "@An"]);
    await v.key("ArrowDown");
    await v.key("Enter");
    assert.deepEqual(v.sent, []);
    assert.equal(v.input().value, "@Mai Chi ");
    assert.equal(v.input().selectionStart, "@Mai Chi ".length);
    assert.equal(v.listbox(), null);
    await v.cleanup();
  });

  it("Escape đóng popover cho đúng cái @ này; Enter sau đó gửi bình thường", async () => {
    const v = await mount();
    await v.type("@a");
    assert.ok(v.listbox());
    await v.key("Escape");
    assert.equal(v.listbox(), null);
    await v.key("Enter");
    assert.deepEqual(v.sent, ["@a"]);
    await v.cleanup();
  });
});

describe("ChatBox: câu nhanh", () => {
  it("chip chèn vào ô trống, không gửi", async () => {
    const v = await mount();
    await v.clickChip("Tôi là dân");
    assert.equal(v.input().value, "Tôi là dân");
    assert.deepEqual(v.sent, []);
    await v.cleanup();
  });

  it("chip 'Nghi @' mở luôn popover tên", async () => {
    const v = await mount();
    await v.clickChip("Nghi @");
    assert.equal(v.input().value, "Nghi @");
    assert.ok(v.listbox());
    await v.cleanup();
  });

  it("bản nháp do trang giữ (điện thoại) vẫn nhận chip", async () => {
    const v = await mount({ draftControlled: true });
    await v.clickChip("Tôi là dân");
    assert.equal(v.input().value, "Tôi là dân");
    await v.cleanup();
  });
});

describe("ChatBox: tô sáng câu gọi mình", () => {
  it("'@Tôi' và tên đứng đầu câu được đánh dấu; câu khác thì không", async () => {
    const v = await mount({
      messages: [
        message({ id: "1", text: "@Tôi nghi ai?" }),
        message({ id: "2", text: "Tôi nghĩ sao?" }),
        message({ id: "3", text: "hôm nay yên" }),
      ],
    });
    const marked = v.host.querySelectorAll('[data-calls-me="true"]');
    assert.equal(marked.length, 2);
    await v.cleanup();
  });
});
