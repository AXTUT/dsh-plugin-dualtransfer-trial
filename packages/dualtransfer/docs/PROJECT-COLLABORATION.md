# Git 项目协作

候选版本：`0.2.0-candidate.6.9.reboot.3.project.3`。基线是本机实际安装的 `market.3`，本轮在独立目录开发；现有 profile、已配对连接和用户工作项目保持原状。

## 选择协作方式

| 模式 | 两端各自在何处编辑 | 发布到哪里 |
| --- | --- | --- |
| 分支并行 parallel | 独立 worktree、独立工作分支 | 各自的工作分支，保留两个版本 |
| 共同基线 shared | 仍是独立 worktree、独立工作分支 | 同一个目标分支，经预览和合并汇总双方提交 |

共同版本指同一 Git 提交，不是两端编辑器的逐键同步。任务通信继续使用原有 DualTransfer 连接；项目文件通过登记的 Git origin 获取和发布，两者各自保留身份及权限检查。

## 首次登记

1. 两端分别取得同一个已有的、非 bare Git 项目，并配置好访问 origin 的 Git 凭据。
2. 在现有「Agent 协作」面板打开「项目」，填写本机项目绝对路径、目标分支、协作模式和本端名称。两端应选择同一目标分支；本端名称各不相同。
3. 在本机显式勾选当前会话的写权限，再登记。插件创建专门的协作 worktree，并显示它的绝对路径。后续编辑针对该 worktree。
4. 默认项目标识由规范化 origin 和目标分支派生。自定义标识时，两端填写同一值；核对远端身份、分支及模式后再交接。

登记及解绑只由本机用户界面发起。Agent 使用本机会话已经登记的项目。对端消息只携带项目和版本信息，不替本机选择路径或授予写权限。

原项目目录里的未提交文件、index、HEAD 和当前分支保持原状；fetch、创建 worktree 会正常更新仓库对象、远端 refs 和 worktree 登记，因此这不是 Git 元数据的零写入操作。

## 日常操作

- **状态、差异**：检查当前提交、修改文件、冲突和截断标记。输出有长度上限，完整内容仍可在显示的 worktree 查看。
- **提交 checkpoint**：填写提交说明并明确选择相对文件路径；使用状态返回的完整 HEAD 作为前提。非合并提交保留其它暂存文件。合并中的提交需要明确选择全部已暂存的合并内容，缺项时在 add/commit 前停止。
- **预览 preview**：fetch 已登记的 origin，显示指定分支或提交的差异、冲突和预览标识。传入提交哈希时，核实它属于所选远端分支。脏工作区只报告状态。
- **集成 integrate**：使用最新预览标识，重验本地 HEAD 和工作区。默认遇冲突停在预览阶段；显式选择进入冲突解决后，保留 Git 冲突标记及双方内容，手工解决，再 checkpoint。
- **发布 publish**：parallel 发布本端工作分支，shared 发布共同目标分支。始终普通 non-force push。远端先被另一端更新时，重新预览、集成，再发布；保留本端提交。
- **解绑 unbind**：撤销本机会话的项目映射，保留 worktree、修改、提交和冲突供用户处理，不自动清理。

提交使用项目现有 Git 身份配置。缺少身份或远端凭据时返回实际错误，原提交和工作区留存。

## 交接带版本的任务

先提交并发布，再填写任务与验收条件，选择「交接」。Host 会核对预期 HEAD，并 fetch 验证该提交已存在于登记的发布分支，然后通过原当前绑定的 task.request 发送。

任务 goal 的开头为 `DTPROJECT/1`，紧接规范化的项目卡片和正文；卡片包含 projectId、mode、remote、目标及工作分支、baseCommit 和精确 commit。原 Wire 结构和大小限制保持。

对端先在本机项目列表核对 projectId、origin、mode 和目标分支，再 preview 卡片的提交；parallel 使用发送端 workBranch，shared 使用 targetBranch。接收卡片本身不触发 clone、fetch、合并、执行或自动恢复 Goal。任务受理/传输 ACK 与实际业务完成分别显示。

Agent 工具 `dualtransfer_project` 提供 list、status、diff、checkpoint、preview、integrate、publish、handoff，与界面共用同一个核心。handoff 使用当前真实 session、Agent、绑定和 pair scope；排队等待后及持久化/发送边界继续核对 owner。

## 环境与限制

- Node.js 24+、Git 2.38+；本轮 Mac 实际 Git 为 2.50.1。Git 需支持 `merge-tree --write-tree`。project.3 在插件设置中增加本机 `projectGitExecutable`：留空使用 `git`，或填写已有 Git 可执行文件绝对路径。路径由本机用户设置，经 Host 传给同一个项目核心；Agent 工具和 RPC 操作参数不接受路径覆盖，不改 PATH，也不自动安装或发现 Git。该字段不是 volatile 绑定参数，修改时按宿主普通配置重载流程生效，文件安装与 fresh JS 生效仍须分别核实。
- Windows 若已有 GitHub Desktop，可在本机核实对应版本的 `resources/app/git/cmd/git.exe` 后填写完整路径，不硬编码另一台电脑的用户名或版本。测试 kit 的 `--git` 则只选择本轮验证所用的 Git，不替用户保存插件设置。project.1 的首次 Windows 验证停于 `git --version` 的 `ENOENT`，54 项均未开始；project.2 仍属未接通此正式 Host 设置的历史候选，其结果单独留存。
- project.2 保留 Git 的 `GIT_CONFIG_NOSYSTEM`、`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_SYSTEM` 三个配置文件选择变量，同时继续清除仓库重定位和临时命令配置注入；隔离测试只使用新建私有 HOME、global/system 配置，不读取真实用户或系统 Git 配置。生产仍使用用户原有的 Git 身份和凭据配置。
- Harness 声明范围沿用 `0.2.1-rc.2 || >=0.2.2-rc.1 <0.2.3-0`，六项 SDK peer 版本、Native 和试用条款沿用基线。
- GitHub HTTPS/SSH 使用已知等价身份规则；其它网络 origin 保留原路径及 `.git` 后缀。本地 bare remote 用于隔离定向测试。URL 内密码、令牌、query 和 fragment 不作为登记凭据；凭据由 Git 自身处理。
- 工作区、项目登记与预览有会话及实例边界；列表按本地 session 隔离。关闭会等待已接纳 Git 子进程的真实 close 和输出结束。
- 显式路径上限 200；输出及登记元数据有界。外部进程同时直接修改同一 index 不属于本功能的原子排他保证。
- 非开源 UNLICENSED 评估试用版，勿用于生产。项目工作目录可能包含秘密，发送任务和发布 Git 提交前请检查所选内容。

## 验证如何解读

本轮证据分别记录真实本地 Git、内存/私有存储桥接、纯 UI DTO/围栏及 Windows 同字节结果。纯 UI 测试不等于浏览器实机验收，替身传输不等于真实跨机传输或模型端到端验收。以随包验证报告的实际完成项为准；历史版本结果保留为历史结果。
