import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeaderboardView } from "@masoi/shared";
import { initialOf, myStanding, pointsRule } from "./leaderboard";

function view(over: Partial<LeaderboardView> = {}): LeaderboardView {
  return {
    entries: [],
    me: null,
    myGames: 0,
    windowDays: 30,
    minGames: 3,
    minHumans: 4,
    points: { win: 10, personalWin: 5, survived: 2 },
    generatedAt: 0,
    ...over,
  };
}

describe("myStanding", () => {
  it("ẩn danh: không nói gì", () => {
    assert.equal(myStanding(view(), false), null);
  });
  it("đăng nhập, chưa có ván tính được: mời chơi với người thật", () => {
    assert.match(myStanding(view(), true)!, /4 người thật/);
    assert.match(myStanding(view(), true)!, /3 ván/);
  });
  it("còn thiếu ván: nói còn bao nhiêu", () => {
    assert.match(myStanding(view({ myGames: 1 }), true)!, /còn 2 ván/);
  });
  it("đã lên bảng: hạng và điểm", () => {
    const me = { rank: 7, playerId: "me", nickname: "Tôi", avatarUrl: null, points: 34, games: 4, wins: 3, winRate: 0.75 };
    assert.match(myStanding(view({ me, myGames: 4 }), true)!, /hạng 7/);
    assert.match(myStanding(view({ me, myGames: 4 }), true)!, /34 điểm/);
  });
});

describe("pointsRule", () => {
  it("in đúng ba hằng số từ server, không tự bịa", () => {
    const rule = pointsRule(view({ points: { win: 7, personalWin: 3, survived: 1 } }));
    assert.match(rule, /Thắng \+7/);
    assert.match(rule, /thắng cá nhân \+3/);
    assert.match(rule, /sống sót tới cuối \+1/);
  });
});

describe("initialOf", () => {
  it("chữ cái đầu, viết hoa, giữ dấu", () => {
    assert.equal(initialOf("đức"), "Đ");
    assert.equal(initialOf("  an"), "A");
    assert.equal(initialOf(""), "?");
  });
});
