# 账单回归 fixture（A1）

来源：用户提供的 DeepSeek 官方用量账单 `usage_data_2026-08-18_2026-09-16.zip`（2026-09-16 导出）。

## 脱敏

只保留对账需要的列，**删除了 `user_id` / `wallet_type` / `api_key_name` / `api_key`**：

| 文件 | 列 |
|---|---|
| `amount.csv` | `start_time_iso, model, type, price, amount`（type 为 token 类型或 `request_count`；price 为该档单价 CNY/token） |
| `cost.csv` | `start_time_iso, model, cost, currency`（当日钱包实扣 CNY） |

## 用途

`tests/bill-regression.test.ts`（SPEC A1）用它断言：修复后的价格表**逐日重算 = 官方实扣**。
这是"价格表与账本都正确"的唯一端到端证据，也是后续改价格表的回归网。
