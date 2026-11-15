# DualTransfer 项目协作候选

版本：`0.2.0-candidate.6.9.reboot.3.project.3`。基线为当前实际安装的 `0.2.0-candidate.6.9.reboot.3.market.3`。

本候选增加两种 Git 协作方式：

- **分支并行**：两台电脑各用独立 worktree 和工作分支，同时保留两个版本。
- **共同基线**：两端仍各自编辑，经预览、三方合并及普通推送，把双方提交汇合到共同分支。

项目、精确提交与原有 Agent 任务交接关联。任务接收、传输 ACK 和业务完成分别处理；收到项目卡片后，由对端按本地已有权限核对并操作。

## 使用

安装候选后，在原「Agent 协作」面板的「项目」页登记已有 Git 项目。登记时由本机用户显式授予当前会话写权限，插件创建单独的协作 worktree；原目录里的未提交文件及暂存内容保留。然后使用状态、差异、提交、预览、集成、发布和交接。

完整步骤、冲突处理和限制见[项目协作说明](<docs/PROJECT-COLLABORATION.md>)。新 Agent 工具为 `dualtransfer_project`，与界面共用同一操作核心；项目登记和写权限选择由用户界面完成。

## 环境与分发

- Node.js 24+，Git 2.38+。插件设置中的 `projectGitExecutable` 可填写本机 Git 可执行文件绝对路径；留空使用 `git`。这项设置不修改 PATH，Agent 和对端消息均无权指定它。
- Harness 声明范围沿用 `0.2.1-rc.2 || >=0.2.2-rc.1 <0.2.3-0`。
- 六项精确 SDK peer、Native 资源、通信及所有权格式沿用基线；以[包清单](<package.json>)为准。
- 平台目标为 macOS arm64 与 Windows 11 x64 build 22621+；本候选的实际测试范围单列于随附报告，不把历史测试当作本轮验收。

本候选在独立目录构建，通过本地 TGZ 交付，`private: true`，本轮不发布 npm 或改动市场条目。安装使用官方插件管理器，替换现有包后的 fresh JS 生效情况与文件安装结果分别核实。

## 评估条款及验证

非开源（UNLICENSED 评估试用版，勿用于生产）；评估条款见[TRIAL-TERMS](<TRIAL-TERMS.md>)。

Not open source (UNLICENSED evaluation build, not for production); requires Node.js 24+ and Git 2.38+.

原有消息、绑定、历史、Native 和项目数据保持原状。本轮的本地真实 Git、受控桥接、纯 UI 与 Windows 同字节证据分别记录；不承诺逐键同步、完整模型端到端、无人值守可靠性、真实 OS 重启或掉电恢复。

项目与反馈：https://github.com/AXTUT/dsh-plugin-dualtransfer-trial
