import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CLAUSE_SEPARATORS,
  ROLE_PHRASES,
  asciiForm,
  hasNegation,
  plainForm,
  roleAtStart,
} from "@masoi/game-engine";
import { prisma } from "../src/db";

/**
 * Đào alias vai từ chat đã lưu.
 *
 * KHÔNG sửa parser và KHÔNG tự thêm gì vào `ROLE_PHRASES`. Đầu ra là một tờ đề
 * xuất cho người đọc: "những token này đứng đúng chỗ tên vai nên đứng, mà bảng
 * hiện tại không hiểu". Việc quyết định cái nào là alias thật là việc của người
 * duyệt, vì một alias sai không chỉ bỏ sót - nó DỰNG RA bằng chứng giả và ghim
 * vĩnh viễn vào belief của bot.
 *
 * Mọi phép chuẩn hoá, tách mệnh đề, loại phủ định và tra bảng vai đều gọi thẳng
 * hàm của `chat-analysis`. Đây là điều kiện để tờ đề xuất nói thật: một parser
 * thứ hai viết ở đây sẽ trôi lệch, và lúc đó nó đề xuất những alias mà parser
 * thật vốn đã hiểu, hoặc bỏ sót đúng những alias parser thật đang trượt.
 *
 * Chạy:  npm run mine-aliases -- --limit 500
 */

interface Options {
  limit: number;
  top: number;
  out: string;
  seed: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    limit: 500,
    top: 30,
    out: "reports/alias-proposal.md",
    seed: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Thiếu giá trị cho ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--top") options.top = Number(next());
    else if (arg === "--out") options.out = next();
    else if (arg === "--no-seed") options.seed = false;
    else throw new Error(`Tham số lạ: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error("--limit phải là số nguyên dương");
  }
  if (!Number.isInteger(options.top) || options.top <= 0) {
    throw new Error("--top phải là số nguyên dương");
  }
  return options;
}

/**
 * Mẫu neo: chỗ mà token NGAY SAU nó gần như luôn là một cái tên vai.
 *
 * Cùng tinh thần bảo thủ với `parseClause`: chỉ nhận ở ĐẦU mệnh đề, để "ai bảo
 * tôi là sói" không bị đọc thành một lời tự nhận. Dạng không dấu được thử song
 * song vì người chat game bỏ dấu liên tục.
 */
const HEAD_ANCHORS = ["tôi là ", "mình là ", "tui là ", "t là ", "em là ", "nhận "];

/**
 * Neo "X là": bất kỳ mệnh đề nào có ` là ` ở giữa.
 *
 * Phần TRƯỚC neo phải ngắn - đó là hình dạng của một chủ ngữ là tên người. Bỏ
 * ràng buộc đó thì "cái điều mà tôi nghĩ là" cũng thành một lời gán vai, và tờ
 * đề xuất sẽ đầy động từ.
 */
const SUBJECT_ANCHOR = " là ";
/*
 * HAI token, không phải ba. Ba đủ chỗ cho "ai bảo tôi", tức neo này sẽ đọc một
 * lời tự nhận ra từ giữa một câu HỎI - đúng cái mà `afterMarker` của parser cố
 * tình không cho phép. Hai vẫn ôm trọn hình dạng thật của chủ ngữ là tên người:
 * "p4", "thằng An", "bạn Chi".
 */
const MAX_SUBJECT_TOKENS = 2;

/**
 * Từ đứng sau neo nhưng chắc chắn không phải tên vai.
 *
 * Cố ý NGẮN và chỉ gồm từ chức năng. Danh sách này không nằm trên đường chạy
 * của bot, nên một lần bỏ sót ở đây chỉ tốn của người duyệt một dòng phải lướt
 * qua, chứ không tạo ra bằng chứng giả trong ván.
 */
const NOISE_TOKENS = new Set(
  [
    "ai", "gì", "người", "ng", "cái", "con", "thằng", "đứa", "một", "này", "đó",
    "kia", "vậy", "thế", "sao", "đang", "sẽ", "bị", "được", "phải", "nên", "mà",
    "thì", "của", "với", "cho", "ok", "đúng", "sai", "chắc", "thật", "giả",
    "nhất", "rồi", "nữa", "luôn", "quá", "lắm", "tôi", "mình", "tui", "em",
    "anh", "chị", "bạn", "nay", "hôm", "ngày", "đêm", "phe", "team", "cùng",
    "vẫn", "còn", "hết", "gà", "noob",
  ].map(asciiForm),
);

interface Candidate {
  /** Dạng không dấu - khoá gom nhóm. */
  key: string;
  /** Các dạng có dấu đã gặp, để người duyệt thấy người ta gõ thế nào. */
  forms: Map<string, number>;
  count: number;
  anchors: Map<string, number>;
  examples: MinedMessage[];
}

export interface MinedMessage {
  text: string;
  channel: string;
  round: number;
}

/**
 * Token vai ứng viên, cắt từ đoạn ngay sau neo.
 *
 * 2-gram đi KÈM 1-gram chứ không thay nó, vì `ROLE_PHRASES` có cả hai cỡ: "sói"
 * một tiếng và "thiên thần hộ mệnh" ba tiếng. Không đếm 2-gram thì "bảo kê"
 * mãi mãi hiện ra thành "bảo"; không đếm 1-gram thì "tt" chìm trong "tt nè".
 */
function candidateGrams(rest: string): string[] {
  const tokens = rest.split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const first = tokens[0]!;
  if (NOISE_TOKENS.has(asciiForm(first))) return [];
  const grams = [first];
  const second = tokens[1];
  if (second !== undefined && !NOISE_TOKENS.has(asciiForm(second))) {
    grams.push(`${first} ${second}`);
  }
  return grams;
}

/** Đoạn nằm sau neo, khi mệnh đề bắt đầu bằng neo đó (thử cả hai dạng). */
function afterHeadAnchor(plain: string, ascii: string, anchor: string): string | null {
  if (plain.startsWith(anchor)) return plain.slice(anchor.length).trim();
  const asciiAnchor = `${asciiForm(anchor)} `;
  if (ascii.startsWith(asciiAnchor)) return ascii.slice(asciiAnchor.length).trim();
  return null;
}

/** Đoạn nằm sau ` là `, khi vế trước nó ngắn như một cái tên. */
function afterSubjectAnchor(plain: string): string | null {
  const index = plain.indexOf(SUBJECT_ANCHOR);
  if (index <= 0) return null;
  const subject = plain.slice(0, index).split(" ").filter(Boolean);
  if (subject.length === 0 || subject.length > MAX_SUBJECT_TOKENS) return null;
  return plain.slice(index + SUBJECT_ANCHOR.length).trim();
}

function record(
  table: Map<string, Candidate>,
  gram: string,
  anchor: string,
  message: MinedMessage,
): void {
  const key = asciiForm(gram);
  if (key === "") return;
  const existing = table.get(key) ?? {
    key,
    forms: new Map<string, number>(),
    count: 0,
    anchors: new Map<string, number>(),
    examples: [] as MinedMessage[],
  };
  existing.count += 1;
  existing.forms.set(gram, (existing.forms.get(gram) ?? 0) + 1);
  existing.anchors.set(anchor, (existing.anchors.get(anchor) ?? 0) + 1);
  // Ba ví dụ là đủ để người duyệt thấy ngữ cảnh; giữ thêm chỉ làm tờ đề xuất
  // dài ra mà không nói thêm điều gì.
  if (existing.examples.length < 3 && !existing.examples.some((e) => e.text === message.text)) {
    existing.examples.push(message);
  }
  table.set(key, existing);
}

/**
 * Nhân THUẦN của công cụ: chat vào, bảng ứng viên ra.
 *
 * Tách khỏi phần đọc DB và ghi file để test được mà không cần Postgres.
 */
export function mineAliases(messages: readonly MinedMessage[]): Candidate[] {
  const table = new Map<string, Candidate>();

  for (const message of messages) {
    for (const raw of message.text.split(CLAUSE_SEPARATORS)) {
      const plain = plainForm(raw);
      const ascii = asciiForm(raw);
      if (plain === "") continue;
      // Đúng cái sàng mà parser dùng: mệnh đề phủ định thì ý nghĩa đảo ngược.
      if (hasNegation({ plain, ascii })) continue;

      /*
       * Khoá theo ĐOẠN CẮT ĐƯỢC, không theo neo. "tôi là tt" khớp cả neo đầu
       * câu lẫn neo "X là" (chủ ngữ "tôi" cũng ngắn), và đếm hai lần sẽ thổi
       * phồng đúng những alias phổ biến nhất - tức làm hỏng chính con số mà
       * người duyệt dựa vào. Neo đầu câu thử trước nên nó giữ nhãn.
       */
      const hits = new Map<string, string>();
      for (const anchor of HEAD_ANCHORS) {
        const rest = afterHeadAnchor(plain, ascii, anchor);
        if (rest && !hits.has(rest)) hits.set(rest, anchor.trim());
      }
      const subject = afterSubjectAnchor(plain);
      if (subject && !hits.has(subject)) hits.set(subject, "X là");

      for (const [rest, anchor] of hits) {
        // Parser hiện tại đã hiểu đoạn này rồi thì không có gì để đề xuất.
        if (roleAtStart({ plain: rest, ascii: asciiForm(rest) })) continue;
        for (const gram of candidateGrams(rest)) record(table, gram, anchor, message);
      }
    }
  }

  /*
   * Tần suất trước; hoà thì cụm DÀI đứng trên. Vế thứ hai theo đúng quy ước của
   * `ROLE_PHRASES` ("cụm dài đứng trước"): `bảo kê` và `bảo` luôn hoà nhau vì
   * cái sau là tiền tố của cái trước, và người duyệt cần thấy cụm đầy đủ trước
   * khi thấy mẩu cụt của nó.
   */
  return [...table.values()].sort(
    (a, b) => b.count - a.count || b.key.length - a.key.length || a.key.localeCompare(b.key),
  );
}

/**
 * 24 câu slang để công cụ có gì mà chạy khi DB còn trắng.
 *
 * Đây là dữ liệu MỒI, không phải dữ liệu thật, và tờ đề xuất nói rõ điều đó
 * ngay ở đầu trang. Nguồn slang thật là chat của người thật - chính vì vậy mà
 * ván không có BOT nào cũng được lưu.
 */
const SEED_MESSAGES = [
  "tôi là tt nhé, soi ra thằng 3 là sói rồi",
  "mình là tt luôn, ai counter thì lên",
  "t là tt, đêm qua soi ra p2",
  "nhận pt đây, tối qua cứu p5",
  "mình là pt nè, hết bình cứu rồi",
  "tôi là bv, đêm nay che cho tt",
  "nhận bv, tối qua đỡ cho p1",
  "tôi là sw, đừng treo tôi",
  "p4 là sw đó, nó tự nhận rồi",
  "mình là ts, treo tôi là chết theo một mạng",
  "tôi là ts nhé, cẩn thận",
  "nhận cupid, tôi ghép p2 với p6",
  "tôi là bà đồng, tối qua hỏi p3",
  "mình là lm nha, mọi người tin đi",
  "nhận lm, đêm qua rảy nước thánh",
  "tôi là thợ săn tập sự, chờ tt chết đã",
  "p7 là hộ vệ, đừng nghi nó",
  "tôi là bảo kê của làng, tin tôi đi",
  "mình là bd, ban đêm không dậy",
  "nhận dl, tôi chỉ là dân đen thôi",
  "tôi là thầy bói, soi p8 ra dân",
  "p2 là ma cà rồng chứ không phải sói đâu",
  "mình là tiên tri tập sự, tt chính chết rồi",
  "tôi là sát thủ, mục tiêu của tôi là p5",
];

/** Ván MỒI: một dòng `GameResult` để treo chat, nhận diện bằng `gameId`. */
const SEED_GAME_ID = "seed-alias-mining";

async function seedIfEmpty(): Promise<number> {
  const existing = await prisma.matchChatMessage.count();
  if (existing > 0) return 0;

  const now = Date.now();
  await prisma.gameResult.create({
    data: {
      gameId: SEED_GAME_ID,
      roomCode: "SEEDS",
      round: 3,
      winner: "village",
      playerRoles: Array.from({ length: 8 }, (_, index) => ({
        id: `seed-p${index + 1}`,
        name: `Mồi ${index + 1}`,
        role: "VILLAGER",
        alive: true,
      })),
      durationSec: 600,
      chat: {
        create: SEED_MESSAGES.map((text, index) => ({
          seq: index,
          channel: "day",
          actorId: `seed-p${(index % 8) + 1}`,
          actorName: `Mồi ${(index % 8) + 1}`,
          text,
          round: Math.floor(index / 8) + 1,
          phase: "DAY_DISCUSSION",
          createdAt: new Date(now + index * 1_000),
        })),
      },
    },
  });
  return SEED_MESSAGES.length;
}

export function formatProposal(
  candidates: readonly Candidate[],
  options: Pick<Options, "limit" | "top">,
  scanned: number,
  seeded: number,
): string {
  const lines: string[] = [];
  lines.push("# Đề xuất alias vai - vòng 1");
  lines.push("");
  lines.push(`Sinh bởi \`npm run mine-aliases -- --limit ${options.limit}\`.`);
  lines.push(
    `Quét ${scanned} tin nhắn đã lưu; ${candidates.length} ứng viên; hiện top ${options.top}.`,
  );
  if (seeded > 0) {
    lines.push("");
    lines.push(
      `> **Dữ liệu MỒI.** Bảng chat trống nên script đã tự nạp ${seeded} câu slang để có gì mà chạy. ` +
        "Những con số dưới đây KHÔNG phải tần suất thật - chạy lại sau khi đã có ván thật rồi hãy duyệt.",
    );
  }
  lines.push("");
  lines.push("## Đây là ĐỀ XUẤT, không phải thay đổi");
  lines.push("");
  lines.push(
    "Script này KHÔNG đụng vào `ROLE_PHRASES`. Một alias sai không chỉ làm bot bỏ sót - " +
      "nó DỰNG RA một lời tự nhận vai chưa từng có và ghim vĩnh viễn vào belief. " +
      "Thêm alias là việc của người duyệt, từng dòng một.",
  );
  lines.push("");
  lines.push("## Quy tắc an toàn khi duyệt");
  lines.push("");
  lines.push(
    "1. **Alias ≤2 ký tự (`tt`, `pt`, `bv`, `sw`, `ts`, `lm`...) chỉ được khớp NGAY SAU một neo " +
      "tự nhận vai** (`tôi là`, `mình là`, `X là`, `nhận`). CẤM khớp tự do giữa câu: `ts` nằm " +
      "trong `ts nào cũng được`, và `bv` là hai chữ cái người ta gõ nhầm hằng ngày.",
  );
  lines.push(
    "2. Cụm dài đứng TRƯỚC cụm ngắn trong `ROLE_PHRASES` - bảng khớp theo thứ tự. " +
      "Thêm `tt` mà đặt trên `tiên tri tập sự` là giết luôn cụm dài đó.",
  );
  lines.push(
    "3. Alias trùng với một từ thường gặp thì bỏ, kể cả khi tần suất cao: " +
      "tờ này đếm chỗ token ĐỨNG, nó không đọc được ý người nói.",
  );
  lines.push(
    "4. Alias chỉ thấy trong dữ liệu mồi thì chưa đủ căn cứ - đợi nó xuất hiện trong chat người thật.",
  );
  lines.push("");
  lines.push("## Top ứng viên");
  lines.push("");

  if (candidates.length === 0) {
    lines.push("_Không có ứng viên nào: mọi token sau neo đều đã nằm trong `ROLE_PHRASES`._");
    lines.push("");
  }

  for (const [index, candidate] of candidates.slice(0, options.top).entries()) {
    const forms = [...candidate.forms.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([form]) => `\`${form}\``)
      .join(", ");
    const anchors = [...candidate.anchors.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([anchor, count]) => `${anchor} (${count})`)
      .join(", ");
    const short = candidate.key.replace(/\s/g, "").length <= 2;
    lines.push(
      `### ${index + 1}. \`${candidate.key}\` — ${candidate.count} lần${short ? " ⚠️ ≤2 ký tự" : ""}`,
    );
    lines.push("");
    lines.push(`- Dạng đã gặp: ${forms}`);
    lines.push(`- Neo: ${anchors}`);
    if (short) lines.push("- ⚠️ Chỉ được khớp ngay sau neo tự nhận vai. Xem quy tắc 1.");
    lines.push("- Ví dụ:");
    for (const example of candidate.examples) {
      lines.push(`  - [${example.channel} v${example.round}] ${example.text.replace(/\n/g, " ")}`);
    }
    lines.push("");
  }

  lines.push("## Bảng hiện tại (để đối chiếu)");
  lines.push("");
  lines.push(`\`ROLE_PHRASES\` đang có ${ROLE_PHRASES.length} cụm, theo đúng thứ tự khớp:`);
  lines.push("");
  lines.push(ROLE_PHRASES.map(([phrase, role]) => `\`${phrase}\` → ${role}`).join(", "));
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const seeded = options.seed ? await seedIfEmpty() : 0;
  if (seeded > 0) console.log(`[mine-aliases] Bảng chat trống - đã nạp ${seeded} câu slang mồi.`);

  const rows = await prisma.matchChatMessage.findMany({
    select: { text: true, channel: true, round: true },
    orderBy: { createdAt: "desc" },
    take: options.limit,
  });

  const candidates = mineAliases(rows);
  const report = formatProposal(candidates, options, rows.length, seeded);

  const outPath = resolve(process.cwd(), options.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, "utf8");

  console.log(report);
  console.log(`\n[mine-aliases] Đã ghi ${options.out}`);
}

main()
  .catch((error) => {
    console.error("[mine-aliases]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
