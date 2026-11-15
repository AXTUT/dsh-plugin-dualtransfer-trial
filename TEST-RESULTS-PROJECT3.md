# project.3 定向验证记录

本版功能是 Git 项目的分支并行、共同基线与带精确 commit 的任务交接。它不提供逐键实时协同编辑。

受测版本：`0.2.0-candidate.6.9.reboot.3.project.3`。macOS arm64 与 Windows 11 x64 的候选包检查均为 **60/60**；Windows 结果不是仅凭对端一句“通过”记账，原件已返回 Mac 做只读核验，没有重跑测试。

| 分组 | Mac | Windows |
| --- | --- | --- |
| Git 配置隔离 | 3/3 | 3/3 |
| Config → Host → bridge → Git 路径 | 3/3 | 3/3 |
| 真实本地 Git 协作 | 23/23 | 23/23 |
| 交接及 Host 桥接 | 13/13 | 13/13 |
| UI DTO 与过期围栏 | 13/13 | 13/13 |
| owner / requestOwned 交接链 | 5/5 | 5/5 |
| **合计** | **60/60** | **60/60** |

## 原始证据

Mac 原件 5,663 文件，记录 2,797 次真实 Git 子进程以及另列的配置测试与路径选择 actor。失败路径中预期的非零退出、信号退出和 ENOENT 原样保留，不把每个 Git 命令都说成成功。

Windows 返回的 ZIP 为 1,893,476 字节，SHA-256：

```text
3b5a944ef5c318024d5fec602d2b5a8a12bec7ede51103bf96e61b936e36d81a
```

本机核对了 5,760 条 manifest 记录、共 5,761 个普通文件；冻结 runner / manifest 与 Mac 一致，144 项输入映射一致。六组测试无失败、取消或跳过；外层 Node 和七条顶层命令的 exit、close、stdout / stderr EOF 均已检查。Windows Git 生命周期另有 2,845 行，包含 git.exe 与用于终止反例的 taskkill.exe；原始非零及信号结果保留。Mac 对 Windows 做的是原件数据核验，不是假称本机直接观测了远端 OS 进程。

project.1 的 Windows `spawn git ENOENT` 原件和未开始的 54 项记录保留。project.2 修复配置选择变量，project.3 再接通正式 Host 的本机 Git 路径；没有重写旧包或抹去旧失败。

## 公开包与受测包

为允许 npm 发布，公开包只移除 manifest 的 `private:true`，增加公开 registry / latest 的 `publishConfig`。版本、运行入口、engines、六个 peer 依赖、许可及其它 131 个文件保持不变。

受测候选 TGZ：385,729 字节，SHA-256：

```text
328ebadc0643ea3de83eff7cfa99de9da05566a7c3c8483376b44e46724f1cbc
```

公开 TGZ：382,373 字节，SHA-256：

```text
8d30dc8a109a8e1d25c1879eb820603956e057210068dd15aa9bbcf6ca134c3c
```

它们不是同一份压缩字节，不能混称“公开 TGZ 原封不动跑过 60 项”；通过的是封存候选，发布归一化后的文件等价性另行核对。

## 没有覆盖的内容

- 本版完整 Host 挂载 / 卸载、插件管理器安装与浏览器实际面板操作。
- 两台物理电脑同时操作同一个网络仓库，以及真实跨机传输、模型执行的端到端闭环。
- 原生 ownership 生命周期、真实 OS 重启、生产项目或现用安装。
- 新版 DSH 0.2.2-rc.1 的完整依赖安装与运行。此前限定 SDK 检查和声明范围不替代这些结果。

原始日志、209 文件源码快照与旧候选保留在开发者私有证据目录；公开只放摘要和运行包，不公开完整开发源码或用户会话。许可仍为 UNLICENSED 评估试用，勿用于生产。
