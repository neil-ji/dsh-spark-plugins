# 安全策略（SECURITY）

## 报告漏洞

请**不要**开公开 issue。用 GitHub 的私有报告渠道：

<https://github.com/neil-ji/dsh-spark-plugins/security/advisories/new>

请在报告里说明：受影响的包与版本、复现步骤、影响面（是否泄漏凭据 / 是否可被
远端触发）、以及你已知的缓解方式。首次回复目标为 7 天内。

## 本仓库的凭据处理约定

这些插件会接触真实的 API key 与 token（GitHub PAT、npm granular token、
DeepSeek API key）。约定如下：

- **凭据只走宿主 credential 层**（`ctx.credentials` 的 reference 机制），
  插件源码里不落任何明文密钥。
- **`cordis.patch.yml` 里只写 `apiKeyEnv` 之类的引用名**，绝不写密钥值。
  例：`apiKeyEnv: DEEPSEEK_API_KEY`。这是可提交的。
- **测试夹具里不许出现真密钥**。用明显伪造的值（如 `ghp_test0000…`）。
- 本地凭据文件（`.dev/home/.credentials.yaml`、`.env`）已在 `.gitignore` 中，
  但**新增任何放凭据的路径时，必须同步加进 `.gitignore`**。

## 如果你不慎提交了密钥

1. **立刻到对应平台吊销该密钥**（这比改历史重要得多 —— 历史可以重写，泄漏不可逆）。
2. 用 `git filter-repo` 或 GitHub 支持渠道清洗历史。
3. 检查该密钥的审计日志，确认没有被滥用。

> 本仓库历史上有过一次**未遂**：`.dev/home/.credentials.yaml`（含明文
> `DEEPSEEK_API_KEY`）存在于工作区，但一直未被 `git add`（`.dev/` 已 gitignore），
> 且 `git log -S` 确认从未进入任何 commit。**新增忽略规则时请保持这个性质。**

## 安装供应链

用户侧的安装路径对供应链完整性有明确设计，请勿绕过：

- 发布资产由 CI 从打了 tag 的 commit 构建，不由个人机器产出。
- `install.sh` / `install.ps1` / `install.cmd` 下载 `manifest.json` 后，
  **逐个校验每个 tarball 与安装器本身的 sha256**，不匹配即中止。
- 安装器本身也按 `manifest.installer.sha256` 校验后才执行。

## 支持范围

只保证与**最新发布版 dsh** 兼容，不做多版本安全矩阵。见
[docs/UPGRADE-PROTOCOL.md](./docs/UPGRADE-PROTOCOL.md)。