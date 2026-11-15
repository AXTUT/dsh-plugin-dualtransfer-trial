# DualTransfer：跨电脑 Agent 与 Git 项目协作

DualTransfer 是 DeepSeek Harness 的第三方实验插件。它让两台已配对、已绑定的电脑交换 Agent 消息、任务、进度和结果，并把项目的精确 Git commit 附在任务交接里。

**当前版本：`0.2.0-candidate.6.9.reboot.3.project.3`。**

Not open source (UNLICENSED evaluation build, not for production); requires Node.js 24+, tested only on macOS arm64 and Windows 11 x64 build 22621+.

非开源（UNLICENSED 评估试用版，勿用于生产）；需要 Node.js 24+，仅在 macOS arm64 与 Windows 11 x64 build 22621+ 上测试。

## 这版新增什么

- **分支并行**：两端在各自受管理的 worktree / 分支工作，保留两个版本，不自动覆盖对方工作区。
- **共同基线**：先获取对端提交、预览差异和冲突，再按显式操作汇入共同分支。存在冲突时停下来处理，不静默选择一方。
- **带版本的任务交接**：交接卡包含项目标识、模式、分支和精确 commit；接收端仍需自己的本机项目映射和既有授权。
- **本机 Git 路径**：设置中的 `projectGitExecutable` 可指定现有 Git 的本机绝对路径；留空时按 PATH 查找。不安装 Git、不修改 PATH，路径也不随任务发给另一端。

## 下载与安装

- [最新项目协作版 Release](https://github.com/AXTUT/dsh-plugin-dualtransfer-trial/releases/tag/project.3)
- [安装说明与市场索引](market/README.md)
- [当前包的项目协作说明](packages/dualtransfer/docs/PROJECT-COLLABORATION.md)
- [本版验证结果和边界](TEST-RESULTS-PROJECT3.md)
- [问题与反馈](https://github.com/AXTUT/dsh-plugin-dualtransfer-trial/issues)

npm 的既有频道为 [`dsh-plugin-dualtransfer`](https://www.npmjs.com/package/dsh-plugin-dualtransfer)。本版 npm 发布状态以 [安装说明](market/README.md) 和 registry 的实际版本为准；GitHub 发布不代表 npm 已同步。

## 已验证与未验证

本版候选在 macOS arm64、Windows 11 x64 上分别完成 **60/60 定向检查**，Windows 原始证据已取回并独立核验。检查使用真实本地 bare remote、clone、worktree，涵盖 Git 核心、桥接、UI、owner 交接、配置隔离和指定 Git 路径。

这不是完整 Host / 模型端到端验收，也不是两台物理电脑同时写同一个远程仓库的实测结果。公开包为 npm 发布移除了 `private:true` 并增加 `publishConfig`；其余 **131 个文件与受测候选逐字节相同**。没有用发布动作代替功能验收，旧候选和失败原件均保留。

DSH 声明范围是 `0.2.1-rc.2 || >=0.2.2-rc.1 <0.2.3-0`。此前对真实 0.2.2-rc.1 SDK 做过限定的版本门控、source-contract 和入口形状检查，未完成该宿主版本的完整安装、挂载及双机模型运行验收；六个 peer 依赖版本保持不变。

## 接续与许可

接收消息进入后续 Agent 回合，需要配对、绑定、已配置的收件动作以及接收端本机既有权限。远端消息不增加权限，也不自动恢复 Goal。空闲监听没有让模型反复轮询，但有本地计时器；真正处理任务仍消耗模型 Token。无人值守通知的可靠性尚未完成端到端验证。

当前实验评估版免费试用，插件本身不收费。这不等于开源、永久免费或商用授权；完整开发源码仍留在私库。公开包含运行所需的 JS、资源和原生辅助程序，具体约束见 [评估条款](TRIAL-TERMS.md)。请勿上传凭证、私有会话或敏感项目内容。

旧版结果保留在 [原验证记录](TEST-RESULTS.md) 和 [reboot.3 Windows 记录](TEST-RESULTS-REBOOT3-WINDOWS.md)，它们不替代本版或新版宿主验收。
