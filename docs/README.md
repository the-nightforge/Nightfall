# Tài liệu

Bắt đầu từ mục **Đang dùng**. Các mục sau là hồ sơ lịch sử: đúng vào lúc
viết, không được cập nhật theo code.

## Đang dùng

| Tài liệu | Dùng khi |
|---|---|
| [operations-recovery.md](operations-recovery.md) | Backend restart giữa ván: ván được khôi phục thế nào, xử lý sự cố |
| [../deploy/README.md](../deploy/README.md) | Deploy, chờ ván, lùi bản, dựng lại VPS |
| [bot-tuning-workflow.md](bot-tuning-workflow.md) | Chỉnh bot: selfplay → trace → weights → so report |
| [BOT_SELF_LEARNING_TRAINING.md](BOT_SELF_LEARNING_TRAINING.md) | Train behavior cloning / PPO |
| [bot-communication-human-eval.md](bot-communication-human-eval.md) | Chấm hội thoại bot bằng người |
| [playtest-human-aware.md](playtest-human-aware.md) | Kịch bản playtest ngắn: bot có nghe người thật không |
| [screens/README.md](screens/README.md) | Ảnh chụp màn hình desktop/mobile |
| [fixtures/](fixtures/) | Mẫu nhỏ của selfplay, trace, đề xuất alias |

## Thiết kế và kế hoạch

Mỗi tính năng có một spec trong [superpowers/specs/](superpowers/specs/) và
một kế hoạch cùng tên trong [superpowers/plans/](superpowers/plans/), đặt tên
theo `YYYY-MM-DD-<tính-năng>`. Tìm theo tên tính năng, ví dụ `voice-chat`,
`game-state-recovery`, `multi-size-tables`. Ngoài ra còn
[case-file-design.md](case-file-design.md) và
[case-file-plan.md](case-file-plan.md) (hồ sơ vụ án).

## Audit và đặc tả nâng cấp bot (2026-09-08 → 09-09)

[BOT_AI_AUDIT.md](BOT_AI_AUDIT.md) ·
[BOT_AI_UPGRADE.md](BOT_AI_UPGRADE.md) ·
[BOT_AI_CONTINUOUS_IMPROVEMENT.md](BOT_AI_CONTINUOUS_IMPROVEMENT.md) ·
[BOT_AI_CONTINUE_UPGRADE.md](BOT_AI_CONTINUE_UPGRADE.md) ·
[BOT_COMMUNICATION_AUDIT.md](BOT_COMMUNICATION_AUDIT.md) ·
[BOT_SELF_LEARNING_AUDIT.md](BOT_SELF_LEARNING_AUDIT.md) ·
[bot-communication-learning.md](bot-communication-learning.md)

## Báo cáo nghiệm thu theo phase

- Bot AI: [1](bot-ai-phase-1-verification.md) · [2](bot-ai-phase-2-verification.md) · [3](bot-ai-phase-3-verification.md) · [4](bot-ai-phase-4-verification.md) · [5](bot-ai-phase-5-verification.md) · [6](bot-ai-phase-6-verification.md) · [7](bot-ai-phase-7-verification.md)
- Hội thoại bot: [1](bot-communication-phase-1-verification.md) · [2](bot-communication-phase-2-verification.md) · [3](bot-communication-phase-3-verification.md) · [4](bot-communication-phase-4-verification.md) · [5](bot-communication-phase-5-verification.md) · [6](bot-communication-phase-6-verification.md)
