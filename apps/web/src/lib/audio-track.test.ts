import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHASES } from "@masoi/shared";
import { trackFor, type Track } from "./audio-track";

describe("trackFor", () => {
  it("mọi pha chơi được đều dùng cùng một track", () => {
    const playable = PHASES.filter((phase) => phase !== "GAME_OVER");
    const tracks = new Set(playable.map(trackFor));

    assert.deepEqual([...tracks], ["theme"]);
  });

  it("phòng chờ và pha cuối cùng trước khi kết thúc cũng là track đó", () => {
    // Hai đầu của dải LOBBY..CHECK_WIN, nêu tên hẳn ra để một lần đổi ánh xạ
    // làm hụt một đầu không lọt qua chỉ vì tập hợp ở trên vẫn có đúng một phần
    // tử.
    assert.equal(trackFor("LOBBY"), "theme");
    assert.equal(trackFor("CHECK_WIN"), "theme");
  });

  it("kết thúc ván thì tắt nhạc để tiếng win/lose vang một mình", () => {
    assert.equal(trackFor("GAME_OVER"), null);
  });

  it("không sót pha nào", () => {
    const allowed: (Track | null)[] = ["theme", null];
    for (const phase of PHASES) {
      assert.ok(allowed.includes(trackFor(phase)), phase);
    }
  });
});
