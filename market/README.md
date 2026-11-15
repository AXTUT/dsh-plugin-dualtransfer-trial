# DualTransfer 安装与版本

当前 GitHub 项目协作版：`0.2.0-candidate.6.9.reboot.3.project.3`。

Not open source (UNLICENSED evaluation build, not for production); requires Node.js 24+, tested only on macOS arm64 and Windows 11 x64 build 22621+.

非开源（UNLICENSED 评估试用版，勿用于生产）；需要 Node.js 24+，仅在 macOS arm64 与 Windows 11 x64 build 22621+ 上测试。

## 安装入口

在 Harness 插件管理器中安装 [Release 的 TGZ](https://github.com/AXTUT/dsh-plugin-dualtransfer-trial/releases/tag/project.3)，或使用这个自托管索引：

```text
https://raw.githubusercontent.com/AXTUT/dsh-plugin-dualtransfer-trial/main/market/index.json
```

索引的新版本固定到不可变 Git commit，旧版本入口仍保留。公开源码树中的 `packages/dualtransfer` 是已构建运行包，不包含完整开发工程；请通过插件管理器操作，不手工修改 profile 或 node_modules。

既有 npm 包名是 `dsh-plugin-dualtransfer`。**本版 npm 仍待发布账号登录；目前不能把 registry 的 `latest` 当作项目协作版。** 本次不会替用户处理密码、验证码或 2FA。完成发布后将把这里更新成实际版本与链接。

目录入口和本地市场可能存在各自的更新周期。目录 PR 合并不等于当前客户端已经搜到；曾对本机旧客户端检查过，搜索未命中。请以当前客户端的真实结果为准。

## Git 项目协作准备

需要已有 Git，版本至少 **2.38**，以及两端都能访问的项目远端。不要把真实凭证、Token 或带密码的 URL 放进交接卡。

`projectGitExecutable` 是可选的**本机设置**：留空使用 PATH；若 Git 已安装但 Harness 的 PATH 找不到，可以填写这个现成可执行文件的绝对路径。它不会自动安装 Git、修改 PATH、发现用户目录，也不会把这个路径同步给对端。Windows 路径仅是示意，不代表你的实际安装位置：

```text
C:\Users\YOUR_NAME\AppData\Local\GitHubDesktop\app-VERSION\resources\app\git\cmd\git.exe
```

分支并行保留两个版本；共同基线模式先预览差异和冲突，再显式应用。冲突不会被静默覆盖。具体操作见 [项目协作说明](../packages/dualtransfer/docs/PROJECT-COLLABORATION.md)。

## 当前验证边界

| 项目 | 实际结果 |
| --- | --- |
| project.3 macOS arm64 定向检查 | 60/60；原始进程证据已核验 |
| project.3 Windows 11 x64 定向检查 | 60/60；原始 ZIP 已接回并独立核验 |
| 公开包与受测候选 | 132 文件中 131 文件逐字节相同；只改 npm 发布所需 manifest 元数据 |
| 本版真实双机同仓库协作 | 尚未实测，是发布后的下一步 |
| 新版宿主完整安装、挂载和模型运行 | 未验证；旧 SDK 限定检查不代替它 |

受测候选、公开发布包分别有自己的 SHA，不混称为同一 TGZ。原候选不重包、不覆盖，旧失败证据不删除。详见 [本版结果](../TEST-RESULTS-PROJECT3.md)。

## 兼容、权限与条款

DSH 范围：`0.2.1-rc.2 || >=0.2.2-rc.1 <0.2.3-0`；这不是未来版本全部 API 兼容的承诺。六个 peer 依赖版本未升级，新 SDK 的依赖安装兼容性也没有在本轮重新验收。

两端须先配对、绑定，并由接收端按本机既有授权处理任务。消息不会授予新权限或恢复 Goal。空闲监听无模型轮询，处理任务仍消耗 Token。当前实验评估版免费试用，许可仍为 `UNLICENSED`，完整源码仍为私有；不是开源或商用许可。详见 [评估条款](../TRIAL-TERMS.md)。

旧 market.1 的 Mac / Windows 各 8 项安装生命周期结果，以及以前的 SDK 限定检查，仅属于其原版本，不转记为本版的完整安装、运行或端到端通过。
