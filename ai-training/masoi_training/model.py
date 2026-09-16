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
    """P0-1: `activation`/`norm`/`init` là opt-in; mặc định cũ byte-một.

    - `activation`: "relu" (cũ) | "silu".
    - `norm`: "none" (cũ) | "layernorm" (Linear → LN → Act mỗi block).
    - `init`: "default" (cũ, init mặc định của torch) | "orthogonal"
      (trunk trực giao, policy head N(0, 0.02) để residual xuất phát ≈ 0).

    `trunk[0]` luôn là Linear đầu; `trunk[2]` là Linear thứ hai khi
    `norm="none"`, và là LayerNorm khi `norm="layernorm"` — code đọc trọng
    số phải đi qua `trunk_linears()`, không qua chỉ số cứng.
    """

    def __init__(
        self,
        obs_size: int,
        action_size: int,
        hidden: int = 128,
        *,
        activation: str = "relu",
        norm: str = "none",
        init: str = "default",
    ) -> None:
        super().__init__()
        if activation == "relu":
            act1, act2 = nn.ReLU(), nn.ReLU()
        elif activation == "silu":
            act1, act2 = nn.SiLU(), nn.SiLU()
        else:
            raise ValueError(f"activation không hợp lệ: {activation!r} (có: relu, silu)")
        if norm not in ("none", "layernorm"):
            raise ValueError(f"norm không hợp lệ: {norm!r} (có: none, layernorm)")
        if init not in ("default", "orthogonal"):
            raise ValueError(f"init không hợp lệ: {init!r} (có: default, orthogonal)")
        self.activation = activation
        self.norm = norm
        fc1, fc2 = nn.Linear(obs_size, hidden), nn.Linear(hidden, hidden)
        if norm == "none":
            self.trunk = nn.Sequential(fc1, act1, fc2, act2)
        else:
            self.trunk = nn.Sequential(
                fc1, nn.LayerNorm(hidden), act1, fc2, nn.LayerNorm(hidden), act2
            )
        self.policy_head = nn.Linear(hidden, action_size)
        # tanh: giá trị là kỳ vọng của reward ±1, nên miền giá trị phải là (−1, 1).
        self.value_head = nn.Sequential(nn.Linear(hidden, 1), nn.Tanh())
        if init == "orthogonal":
            with torch.no_grad():
                for layer in (fc1, fc2):
                    nn.init.orthogonal_(layer.weight)
                    layer.bias.zero_()
                nn.init.normal_(self.policy_head.weight, std=0.02)
                self.policy_head.bias.zero_()

    def forward(self, features: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        latent = self.trunk(features)
        return self.policy_head(latent), self.value_head(latent).squeeze(-1)


def trunk_linears(model: PolicyValueNet) -> list[nn.Linear]:
    """Hai Linear của trunk, bất kể `norm` nào — thay cho `trunk[0]`/`trunk[2]` cứng."""
    linears = [m for m in model.trunk if isinstance(m, nn.Linear)]
    assert len(linears) == 2, f"trunk lạ: {[type(m).__name__ for m in model.trunk]}"
    return linears


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """§13: hành động bất hợp lệ có xác suất 0.

    Che ở CẢ lúc train chứ không chỉ lúc suy luận: nếu chỉ che khi chơi, model
    vẫn tiêu một phần sức chứa để học phân bố trên những nước nó không bao giờ
    được đi, và loss báo cáo sẽ không phải loss của bài toán thật.
    """
    return logits.masked_fill(~mask, MASK_FILL)
