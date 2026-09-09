"""Policy + Value network (BOT_SELF_LEARNING §18/§19).

MLP nhỏ, đúng như §18 yêu cầu: bắt đầu bằng thứ đơn giản nhất chạy được, không
bằng Transformer và tuyệt đối không bằng LLM. Đổi sang kiến trúc lớn hơn chỉ khi
benchmark nói MLP không đủ — không phải khi loss trông chưa đẹp.

Một backbone dùng chung cho mọi vai (§32): vai đã nằm trong observation dưới
dạng one-hot, nên model tự học phần khác biệt. Tách head theo vai chỉ khi
benchmark chứng minh có lợi.
"""

from __future__ import annotations

import torch
from torch import nn

# Thay cho -inf: softmax của một hàng toàn -inf ra NaN, và NaN lan ra cả
# gradient. Số này đủ âm để xác suất là 0 trong float32 mà vẫn hữu hạn.
MASK_FILL = -1e9


class PolicyValueNet(nn.Module):
    def __init__(self, obs_size: int, action_size: int, hidden: int = 128) -> None:
        super().__init__()
        self.trunk = nn.Sequential(
            nn.Linear(obs_size, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
        )
        self.policy_head = nn.Linear(hidden, action_size)
        # tanh: giá trị là kỳ vọng của reward ±1, nên miền giá trị phải là (−1, 1).
        self.value_head = nn.Sequential(nn.Linear(hidden, 1), nn.Tanh())

    def forward(self, features: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        latent = self.trunk(features)
        return self.policy_head(latent), self.value_head(latent).squeeze(-1)


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """§13: hành động bất hợp lệ có xác suất 0.

    Che ở CẢ lúc train chứ không chỉ lúc suy luận: nếu chỉ che khi chơi, model
    vẫn tiêu một phần sức chứa để học phân bố trên những nước nó không bao giờ
    được đi, và loss báo cáo sẽ không phải loss của bài toán thật.
    """
    return logits.masked_fill(~mask, MASK_FILL)
